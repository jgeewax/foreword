import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { studio } from '../app/studio';
import type { Version } from '../lib/ipc';
import { onContextMenu } from '../lib/context-menu';
import { tildePath } from '../lib/paths';
import { useStore } from '../lib/store';
import { FileIcon, Icon, type IconName } from './icons';

/** ⏎ or space on a row that acts as a button. */
const onActivate = (run: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  run();
};

/** Each kind of version, as its node on the timeline says it: in the editor's colours for the assistant. */
const KIND: Record<string, { title: string; glyph?: IconName }> = {
  opened: { title: 'When Foreword started keeping this book’s history' },
  save: { title: 'Your edits' },
  agent: { title: 'Changes by the assistant', glyph: 'sparkle' },
  milestone: { title: 'A version you named' },
  restore: { title: 'Put back from an earlier version', glyph: 'undo' },
};

function dayLabel(t: number) {
  const d = new Date(t * 1000);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const timeLabel = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** How much a version changed, as five blocks: green for lines added, red for removed, grey for a small change. */
function ChangeBar({ added, deleted }: { added: number; deleted: number }) {
  const total = added + deleted;
  if (!total) return null;
  const coloured = Math.min(5, total);
  let green = Math.round((added / total) * coloured);
  if (added && !green) green = 1;
  if (deleted && green === coloured) green = coloured - 1;
  return (
    <span className="change-bar" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < green ? 'a' : i < coloured ? 'd' : ''} />
      ))}
    </span>
  );
}

/** A quiet action under the selected version: an icon and words, on one line. */
function VersionAction({ icon, label, title, disabled, onClick }: { icon: IconName; label: string; title: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button className="change-action" title={title} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

/**
 * One version on the timeline: its node, what it was, when, how much it
 * changed. A click shows what it changed in a tab (◀ Older and Newer ▶
 * there step through), and folds out its files and what you can do with it
 * here; a click on it again folds them up.
 */
function VersionRow({ v, latest, edge }: { v: Version; latest: boolean; edge: string }) {
  const open = useStore(studio.store, (s) => (s.history.open?.id === v.id ? s.history.open : null));
  const shown = useStore(studio.store, (s) => s.history.changes?.mode === 'version' && s.history.changes.version.id === v.id);
  const busy = useStore(studio.store, (s) => s.history.busy);
  const kind = KIND[v.kind] ?? { title: v.kind };
  // The node says it was the assistant: its words are enough.
  const label = v.kind === 'agent' ? v.label.replace(/^Agent:\s*/, '') : v.label;
  const select = () => {
    if (open) return void studio.history.toggle(v.id);
    void studio.history.toggle(v.id);
    void studio.history.showChanges(v);
  };
  return (
    <div className={`history-item kind-${v.kind}${open ? ' open' : ''}${shown ? ' selected' : ''}${edge}`}>
      <div
        className="history-row"
        role="button"
        tabIndex={0}
        aria-expanded={!!open}
        aria-label={`${kind.title}: ${label}, ${timeLabel(v.time)}`}
        title={open ? 'Fold up its files' : 'What it changed, in a tab, and its files here'}
        onClick={select}
        onKeyDown={onActivate(select)}
        onContextMenu={onContextMenu(() => [
          { label: 'What Changed', action: () => void studio.history.showChanges(v) },
          !latest && { label: 'Compare with Now', action: () => void studio.history.compareWithNow(v) },
          'separator',
          v.kind === 'agent' && !!v.parent && { label: 'Undo These Changes…', enabled: !busy, action: () => void studio.history.undoVersion(v) },
          !latest && { label: 'Restore This Version…', enabled: !busy, action: () => void studio.history.restoreVersion(v) },
        ])}
      >
        <span className="history-node" title={kind.title}>
          {kind.glyph && <Icon name={kind.glyph} size={11} />}
        </span>
        <span className="history-body">
          <span className="history-label">{label}</span>
          <span className="history-meta">
            <span className="history-time">{timeLabel(v.time)}</span>
            <span aria-hidden>·</span>
            {v.files ? (
              <>
                {v.files} file{v.files > 1 ? 's' : ''} <span className="add-n">+{v.added}</span> <span className="del-n">−{v.deleted}</span>
                <ChangeBar added={v.added} deleted={v.deleted} />
              </>
            ) : (
              'no changes'
            )}
          </span>
        </span>
      </div>
      {open && (
        <div className="history-detail">
          {open.changes === null && <div className="muted history-loading">Finding the files it changed…</div>}
          {open.changes?.map((c) => {
            const show = () => void studio.history.showDiff(v, c.path);
            const slash = c.path.lastIndexOf('/');
            return (
              <div key={c.path} className="history-file" role="button" tabIndex={0} title={`What changed in ${c.path}, side by side`} onClick={show} onKeyDown={onActivate(show)}>
                <FileIcon path={c.path} />
                {/* The name first, then its folder (as Source Control): a narrow pane cuts the folder, not the name. */}
                <span className="history-path">
                  {c.path.slice(slash + 1)}
                  {slash > 0 && <span className="history-folder"> {c.path.slice(0, slash)}</span>}
                </span>
                {c.status !== 'M' && <span className={`history-status status-${c.status}`}>{c.status === 'A' ? 'new' : c.status === 'D' ? 'deleted' : ''}</span>}
                {c.added !== null && (
                  <span className="history-counts">
                    <span className="add-n">+{c.added}</span> <span className="del-n">−{c.deleted}</span>
                  </span>
                )}
              </div>
            );
          })}
          {(!latest || (v.kind === 'agent' && v.parent)) && (
            <div className="history-version-actions">
              {!latest && <VersionAction icon="sideBySide" label="Compare with now" title="Everything that changed from this version until now, in a tab" onClick={() => void studio.history.compareWithNow(v)} />}
              {v.kind === 'agent' && v.parent && (
                <VersionAction icon="undo" label="Undo these changes" disabled={busy} title="Put back what these files looked like before the assistant changed them" onClick={() => void studio.history.undoVersion(v)} />
              )}
              {!latest && <VersionAction icon="retry" label="Restore this version" disabled={busy} title="Put the whole book back as it was at this point (a new version: you can go forward again)" onClick={() => void studio.history.restoreVersion(v)} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Single-quoted for a shell, for the Git command the author can copy. */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** What History is, where it's kept, and how to go back: one line at the end of the timeline, more on request. */
function HistoryAbout() {
  const repo = useStore(studio.store, (s) => s.history.repo);
  const root = useStore(studio.store, (s) => s.workspace?.root);
  const [open, setOpen] = useState(false);
  return (
    <div className="history-help muted">
      Versions are saved as you work and around every change the assistant makes.{' '}
      <button className="link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Less' : 'How does this work?'}
      </button>
      {open && (
        <div className="history-about">
          <p>
            <b>Where:</b> in a Git repository Foreword keeps for this book, in its own data folder rather than in the book folder
            {repo && (
              <>
                {' '}
                (<code className="selectable">{tildePath(repo.gitDir)}</code>)
              </>
            )}
            . History never touches your own Git repository, if the book has one: that's Source Control, where you commit, pull and push yourself.
          </p>
          <p>
            <b>Going back:</b> click a version to see what it changed, line by line or word by word, in a tab, with its files listed under it here; a file shows its own changes side by side.{' '}
            <b>◀ Older</b> and <b>Newer ▶</b> in the tab step through the versions one at a time; <b>Compare with now</b> shows everything since. You can undo just what the assistant changed, or put the whole book back as it was.
            Restoring adds a new version, so you can always go forward again.
          </p>
          <p>
            <b>Marking points:</b> <i>Name this version…</i> keeps a point like “Draft sent to editor” easy to find.
          </p>
          {repo && root && (
            <div className="history-about-actions">
              <button onClick={() => void studio.history.reveal()}>Show in Finder</button>
              <button
                title="A Git command that lists every version with its changes, for Terminal"
                onClick={() => studio.copy(`git --git-dir=${shellQuote(repo.gitDir)} --work-tree=${shellQuote(root)} log -p`, 'Git command copied')}
              >
                Copy Git command
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The top of the timeline: now, where a name marks this point. */
function NowRow() {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const save = async () => {
    await studio.history.saveNamed(name);
    setName('');
    setNaming(false);
  };
  return (
    <div className="history-now first">
      <span className="history-node" aria-hidden />
      <div className="history-now-body">
        <span className="history-now-label">Now</span>
        {naming ? (
          <form
            className="history-name"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input autoFocus value={name} placeholder="e.g. Draft 2 sent to editor" aria-label="Name for this version" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} />
            <button className="primary" type="submit" disabled={!name.trim()}>
              Save
            </button>
          </form>
        ) : (
          <VersionAction icon="tag" label="Name this version…" title="Mark this point, e.g. “Draft sent to editor”, so it's easy to find" onClick={() => setNaming(true)} />
        )}
      </div>
    </div>
  );
}

/**
 * History: the book's versions as a timeline, newest first, from now down to
 * when Foreword started keeping them. Each version's node says who made
 * it (you, the assistant, a name you gave it, a restore); a click shows what
 * it changed.
 */
export function HistoryPanel() {
  const history = useStore(studio.store, (s) => s.history);
  if (history.status === 'unavailable') {
    return <div className="history-empty bad">History is off: {history.error}</div>;
  }
  if (history.status !== 'ready') return <div className="history-empty muted">Starting history…</div>;
  const rows: ReactNode[] = [];
  let lastDay = '';
  history.versions.forEach((v, i) => {
    const day = dayLabel(v.time);
    if (day !== lastDay) rows.push(<div key={`day-${day}`} className={`history-day${!rows.length && history.filter ? ' first' : ''}`}>{day}</div>);
    lastDay = day;
    rows.push(<VersionRow key={v.id} v={v} latest={i === 0} edge={i === history.versions.length - 1 ? ' last' : ''} />);
  });
  return (
    <div className="history">
      {history.filter && (
        <div className="history-filter">
          <span>
            Only <code>{history.filter}</code>
          </span>
          <button className="icon" title="Show every version" aria-label="Show every version" onClick={() => void studio.history.setFilter(null)}>
            ✕
          </button>
        </div>
      )}
      <div className="history-list">
        {!history.filter && <NowRow />}
        {history.filter && !history.versions.length && <div className="history-empty muted">No versions changed this file yet.</div>}
        {rows}
        <HistoryAbout />
      </div>
    </div>
  );
}
