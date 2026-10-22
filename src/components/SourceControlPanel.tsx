import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { studio } from '../app/studio';
import { onContextMenu, showContextMenu } from '../lib/context-menu';
import { layoutGraph, type GraphRow } from '../lib/git-graph';
import type { GitCommit, GitFile, GitRef, GitStatus } from '../lib/ipc';
import { useStore } from '../lib/store';
import { FileIcon, Icon, type IconName } from './icons';

const STATUS: Record<GitFile['status'], { letter: string; title: string }> = {
  M: { letter: 'M', title: 'Modified' },
  A: { letter: 'A', title: 'Added' },
  '?': { letter: 'U', title: 'Untracked: new, not in Git yet' },
  D: { letter: 'D', title: 'Deleted' },
  R: { letter: 'R', title: 'Renamed' },
  U: { letter: '!', title: 'Conflict: both sides changed it' },
};

/** Whether a section is open, remembered between launches. */
function useOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(`studio-scm-${key}`) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(`studio-scm-${key}`, open ? 'closed' : 'open');
    } catch {}
  };
  return [open, toggle];
}

/** A section's title bar, as VS Code's: click to fold it; its actions on the right. */
function SectionHeader({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
  return (
    <div className="scm-section-header" role="button" aria-expanded={open} onClick={onToggle}>
      <span className={`twisty${open ? ' open' : ''}`}>
        <Icon name="chevronRight" size={16} />
      </span>
      <span className="scm-section-title" title={title}>
        {title}
      </span>
      <span className="spacer" />
      <span className="scm-actions" onClick={(e) => e.stopPropagation()}>
        {children}
      </span>
    </div>
  );
}

/**
 * Source Control, as VS Code's: the book's own Git repository. A message and
 * Commit, the changed files, and the Graph of commits with Pull and Push.
 * Files and commits open What changed, in words.
 */
export function SourceControlPanel() {
  const git = useStore(studio.store, (s) => s.git);
  const [message, setMessage] = useState(() => studio.git.message);
  const [changesOpen, toggleChanges] = useOpen('changes');
  const [graphOpen, toggleGraph] = useOpen('graph');
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'studio-scm', storage: localStorage });
  const repo = git.repo;
  if (git.status === 'loading' || git.status === 'off') return <div className="history-empty muted">Looking for a Git repository…</div>;
  if (!repo) return <div className="history-empty muted">This book isn’t in a Git repository.</div>;
  const write = (text: string) => {
    studio.git.message = text;
    setMessage(text);
  };
  const busy = git.busy;
  const changes = (
    <div className={`scm-section${changesOpen ? ' open' : ''}`}>
      <SectionHeader title={repo.root.slice(repo.root.lastIndexOf('/') + 1)} open={changesOpen} onToggle={toggleChanges}>
        <span className="scm-branch" title={`${repo.branch ? `On the branch ${repo.branch}` : 'No branch (a detached commit)'}${repo.upstream ? `, which follows ${repo.upstream}` : ', not on a remote yet'}`}>
          <Icon name="branch" size={14} />
          {repo.branch ?? 'detached'}
        </span>
      </SectionHeader>
      {changesOpen && <Changes repo={repo} message={message} setMessage={write} />}
    </div>
  );
  const graph = (
    <div className={`scm-section scm-graph-section${graphOpen ? ' open' : ''}`}>
      <SectionHeader title="Graph" open={graphOpen} onToggle={toggleGraph}>
        {repo.upstream && (
          <button
            className={`icon scm-action${busy === 'pull' ? ' running' : ''}`}
            disabled={!!busy}
            title={`Pull: bring in commits from ${repo.upstream}${repo.behind ? ` (${repo.behind} new)` : ''}, only when no merge is needed`}
            aria-label="Pull"
            onClick={() => void studio.git.pull()}
          >
            <Icon name="pull" size={16} />
            {repo.behind > 0 && <span className="scm-action-count">{repo.behind}</span>}
          </button>
        )}
        <button
          className={`icon scm-action${busy === 'push' ? ' running' : ''}`}
          disabled={!!busy || (!!repo.upstream && repo.ahead === 0)}
          title={repo.upstream ? `Push: send ${repo.ahead || 'no'} commit${repo.ahead === 1 ? '' : 's'} to ${repo.upstream}` : 'Push: send this branch to the remote (origin) for the first time'}
          aria-label="Push"
          onClick={() => void studio.git.push()}
        >
          <Icon name="push" size={16} />
          {repo.ahead > 0 && <span className="scm-action-count">{repo.ahead}</span>}
        </button>
      </SectionHeader>
      {graphOpen && <Graph repo={repo} log={git.log} more={git.log.length >= git.limit} />}
    </div>
  );
  return (
    <div className="scm">
      {changesOpen && graphOpen ? (
        <Group className="scm-split" orientation="vertical" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
          <Panel id="changes" minSize="90px">
            {changes}
          </Panel>
          <Separator className="separator separator-h" />
          <Panel id="graph" defaultSize="45%" minSize="66px">
            {graph}
          </Panel>
        </Group>
      ) : (
        <>
          {changes}
          {graph}
        </>
      )}
    </div>
  );
}

/** The message, Commit, and what's changed since the last commit: Staged Changes, then Changes. */
function Changes({ repo, message, setMessage }: { repo: GitStatus; message: string; setMessage: (text: string) => void }) {
  const busy = useStore(studio.store, (s) => s.git.busy);
  const [nudge, setNudge] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // The box grows with what's written, as VS Code's (the placeholder stays on one line).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = '';
    if (message) el.style.height = `${Math.min(el.scrollHeight + 2, 180)}px`;
  }, [message]);
  const staged = repo.staged.length > 0;
  const commit = async (push = false) => {
    if (!message.trim()) {
      setNudge(true);
      box.current?.focus();
      return;
    }
    if (await studio.git.commit(message, push)) setMessage('');
  };
  const canCommit = (staged || repo.files.length > 0) && !busy;
  return (
    <div className="scm-body">
      <div className="git-commit">
        <textarea
          ref={box}
          className={nudge ? 'invalid' : undefined}
          value={message}
          rows={1}
          placeholder={nudge ? 'Write a message for the commit first' : `Message (⌘⏎ to commit${repo.branch ? ` on “${repo.branch}”` : ''})`}
          aria-label="Commit message"
          disabled={!!busy}
          onChange={(e) => {
            setNudge(false);
            setMessage(e.target.value);
          }}
          onBlur={() => setNudge(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey) {
              e.preventDefault();
              if (canCommit) void commit();
            }
          }}
        />
        <div className="scm-commit-button">
          <button
            className="primary"
            disabled={!canCommit}
            title={staged ? 'Commit the staged changes (⌘⏎)' : repo.files.length ? 'Nothing is staged: commit every change in the book (⌘⏎)' : 'Nothing to commit'}
            onClick={() => void commit()}
          >
            <Icon name="check" size={16} />
            {busy === 'commit' ? 'Committing…' : 'Commit'}
          </button>
          <button
            className="primary scm-commit-more"
            disabled={!canCommit}
            title="More ways to commit"
            aria-label="More ways to commit"
            onClick={() =>
              void showContextMenu([
                { label: 'Commit', action: () => void commit() },
                { label: 'Commit & Push', action: () => void commit(true) },
              ])
            }
          >
            <Icon name="chevronDown" size={16} />
          </button>
        </div>
      </div>
      {staged && <FileGroup files={repo.staged} staged />}
      {repo.files.length > 0 && <FileGroup files={repo.files} staged={false} />}
      {!staged && !repo.files.length && <div className="scm-empty muted">Everything is committed.</div>}
    </div>
  );
}

/** A button on a row, shown on hover, as VS Code's inline actions. */
function RowAction({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      className="icon scm-hover"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

/** Staged Changes (− takes a file back out) or Changes (+ stages it); a click shows what changed. */
function FileGroup({ files, staged }: { files: GitFile[]; staged: boolean }) {
  const titles = useStore(studio.store, (s) => s.names.titles);
  const [open, toggle] = useOpen(staged ? 'staged-list' : 'changes-list');
  const move = (paths: string[]) => void (staged ? studio.git.unstage(paths) : studio.git.stage(paths));
  const moveLabel = staged ? 'Unstage Changes' : 'Stage Changes';
  return (
    <>
      <div className="scm-group" role="button" aria-expanded={open} onClick={toggle}>
        <span className={`twisty${open ? ' open' : ''}`}>
          <Icon name="chevronRight" size={16} />
        </span>
        <span>{staged ? 'Staged Changes' : 'Changes'}</span>
        <span className="spacer" />
        <RowAction icon="openChanges" label="What changed in all of them" onClick={() => void studio.git.showWorking(undefined, staged)} />
        <RowAction icon={staged ? 'minus' : 'plus'} label={staged ? 'Unstage All Changes' : 'Stage All Changes'} onClick={() => move(['.'])} />
        <span className="scm-count">{files.length}</span>
      </div>
      {open &&
        files.map((f) => {
          const name = f.path.slice(f.path.lastIndexOf('/') + 1);
          const folder = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
          return (
            <div
              key={f.path}
              role="button"
              className={`git-file s-${f.status === '?' ? 'new' : f.status}`}
              title={`${titles[f.path] ? `${titles[f.path]}\n` : ''}${f.path} · ${STATUS[f.status].title}${staged ? ' (staged)' : ''}`}
              onClick={() => void studio.git.showWorking(f.path, staged)}
              onContextMenu={onContextMenu(() => [
                { label: 'What Changed', action: () => void studio.git.showWorking(f.path, staged) },
                f.status !== 'D' && { label: 'Open File', action: () => void studio.openFile(f.path) },
                'separator',
                { label: moveLabel, action: () => move([f.path]) },
                'separator',
                { label: 'Copy Relative Path', action: () => studio.copy(f.path, 'Path copied') },
              ])}
            >
              <FileIcon path={f.path} />
              <span className="git-label">
                <span className="git-name">{name}</span>
                {folder && <span className="git-folder">{folder}</span>}
              </span>
              {f.status !== 'D' && <RowAction icon="goToFile" label="Open File" onClick={() => void studio.openFile(f.path)} />}
              <RowAction icon={staged ? 'minus' : 'plus'} label={moveLabel} onClick={() => move([f.path])} />
              <span className="git-status">{STATUS[f.status].letter}</span>
            </div>
          );
        })}
    </>
  );
}

/** Lanes are this far apart; rows this tall (the lines meet across rows). */
const LANE = 11;
const ROW = 22;
const LANE_COLORS = ['var(--accent)', 'var(--lane-2)', 'var(--lane-3)', 'var(--lane-4)', 'var(--lane-5)'];
const laneColor = (j: number) => LANE_COLORS[j % LANE_COLORS.length];

function GraphCell({ row, width, head }: { row: GraphRow; width: number; head: boolean }) {
  const x = (j: number) => 8 + j * LANE;
  const mid = ROW / 2;
  return (
    <svg className="scm-lanes" width={x(width - 1) + 8} height={ROW} fill="none" strokeWidth="1.5" aria-hidden>
      {row.top.map(([a, b], i) => (
        <path key={`t${i}`} d={a === b ? `M${x(a)} 0V${mid}` : `M${x(a)} 0Q${x(a)} ${mid} ${x(b)} ${mid}`} stroke={laneColor(a)} />
      ))}
      {row.bottom.map(([a, b], i) => (
        <path key={`b${i}`} d={a === b ? `M${x(a)} ${mid}V${ROW}` : `M${x(a)} ${mid}Q${x(b)} ${mid} ${x(b)} ${ROW}`} stroke={laneColor(b)} />
      ))}
      <circle className={head ? 'scm-dot-head' : undefined} cx={x(row.lane)} cy={mid} r={head ? 4 : 3.5} stroke={laneColor(row.lane)} strokeWidth={head ? 2 : 0} fill={head ? undefined : laneColor(row.lane)} />
    </svg>
  );
}

const REF_ORDER: GitRef['kind'][] = ['head', 'branch', 'remote', 'tag'];

/** A commit's branches and tags; the branch's remote joins it when they're at the same commit, as in VS Code. */
function Refs({ refs, upstream }: { refs: GitRef[]; upstream: string | null }) {
  const synced = refs.some((r) => r.kind === 'head') && refs.some((r) => r.kind === 'remote' && r.name === upstream);
  const shown = refs.filter((r) => !(synced && r.kind === 'remote' && r.name === upstream)).sort((a, b) => REF_ORDER.indexOf(a.kind) - REF_ORDER.indexOf(b.kind));
  return (
    <>
      {shown.map((r) => (
        <span
          key={`${r.kind}:${r.name}`}
          className={`scm-ref ref-${r.kind}`}
          title={r.kind === 'head' ? `The branch you're on${synced ? `, the same as ${upstream}` : ''}` : r.kind === 'remote' ? `${r.name}: the remote's branch` : r.kind === 'tag' ? `Tag ${r.name}` : `Branch ${r.name}`}
        >
          <Icon name={r.kind === 'tag' ? 'tag' : r.kind === 'remote' ? 'cloud' : 'target'} size={12} />
          {r.kind === 'head' && synced && <Icon name="cloud" size={12} />}
          <span className="scm-ref-name">{r.name}</span>
        </span>
      ))}
    </>
  );
}

/** The commits that touched the book, newest first, with their graph. */
function Graph({ repo, log, more }: { repo: GitStatus; log: GitCommit[]; more: boolean }) {
  const { rows, width } = useMemo(() => layoutGraph(log), [log]);
  if (!log.length) return <div className="scm-body scm-empty muted">No commits yet.</div>;
  return (
    <div className="scm-body scm-graph">
      {log.map((c, i) => (
        <div
          key={c.hash}
          role="button"
          className={`scm-commit${c.head ? ' head' : ''}`}
          title={`${c.subject}\n${c.short} · ${c.author} · ${new Date(c.time * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
          onClick={() => void studio.git.showCommit(c)}
          onContextMenu={onContextMenu(() => [
            { label: 'What Changed', action: () => void studio.git.showCommit(c) },
            'separator',
            { label: 'Copy Commit ID', action: () => studio.copy(c.hash, 'Commit ID copied') },
            { label: 'Copy Commit Message', action: () => studio.copy(c.subject, 'Commit message copied') },
          ])}
        >
          <GraphCell row={rows[i]} width={width} head={c.head} />
          <span className="scm-subject">{c.subject}</span>
          {/* A row with branches or tags leaves the author out (it's in the tooltip), as in VS Code. */}
          {c.refs.length ? <Refs refs={c.refs} upstream={repo.upstream} /> : <span className="scm-author">{c.author}</span>}
        </div>
      ))}
      {more && (
        <div className="scm-more" role="button" onClick={() => void studio.git.loadMore()}>
          Load More…
        </div>
      )}
    </div>
  );
}
