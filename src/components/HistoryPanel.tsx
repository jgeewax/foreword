import { useState, type KeyboardEvent } from 'react';
import { studio } from '../app/studio';
import type { Version } from '../lib/ipc';
import { onContextMenu } from '../lib/context-menu';
import { tildePath } from '../lib/paths';
import { useStore } from '../lib/store';
import { FileIcon, Icon } from './icons';

/** ⏎ or space on a row that acts as a button. */
const onActivate = (run: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  run();
};

const KIND: Record<string, { icon: string; title: string }> = {
  opened: { icon: '○', title: 'Opened in Typst Studio' },
  save: { icon: '✎', title: 'Your edits' },
  agent: { icon: '✦', title: 'Changes by the agent' },
  milestone: { icon: '◆', title: 'Named version' },
  restore: { icon: '↺', title: 'Restore' },
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

function Stats({ v }: { v: Version }) {
  if (!v.files) return <span>no changes</span>;
  return (
    <span title="Files changed, and lines added and removed (a paragraph is one line)">
      {v.files} file{v.files > 1 ? 's' : ''} <span className="add-n">+{v.added}</span> <span className="del-n">−{v.deleted}</span>
    </span>
  );
}

function VersionRow({ v, latest }: { v: Version; latest: boolean }) {
  const open = useStore(studio.store, (s) => (s.history.open?.id === v.id ? s.history.open : null));
  const busy = useStore(studio.store, (s) => s.history.busy);
  const kind = KIND[v.kind] ?? { icon: '•', title: v.kind };
  const toggle = () => void studio.history.toggle(v.id);
  return (
    <div className={`history-item kind-${v.kind}${open ? ' open' : ''}`}>
      {/* A chevron, as the file tree's folders: the row folds out to the files it changed. */}
      <div
        className="history-row"
        role="button"
        tabIndex={0}
        aria-expanded={!!open}
        aria-label={`${kind.title}: ${v.label}`}
        title={open ? 'Fold it up again' : v.files ? 'Show the files it changed, and what you can do with this version' : 'Show what you can do with this version'}
        onClick={toggle}
        onKeyDown={onActivate(toggle)}
        onContextMenu={onContextMenu(() => [
          { label: 'What Changed', action: () => void studio.history.showChanges(v) },
          !latest && { label: 'Compare with Now', action: () => void studio.history.compareWithNow(v) },
          'separator',
          v.kind === 'agent' && !!v.parent && { label: 'Undo These Changes…', enabled: !busy, action: () => void studio.history.undoVersion(v) },
          !latest && { label: 'Restore This Version…', enabled: !busy, action: () => void studio.history.restoreVersion(v) },
        ])}
      >
        <span className={`twisty${open ? ' open' : ''}`}>
          <Icon name="chevronRight" size={16} />
        </span>
        <span className="history-icon" title={kind.title}>
          {kind.icon}
        </span>
        <span className="history-main">
          <span className="history-label">{v.label}</span>
          <span className="history-meta">
            {timeLabel(v.time)} · <Stats v={v} />
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
              <div key={c.path} className="history-file" role="button" tabIndex={0} title={`What changed in ${c.path}, in its own tab`} onClick={show} onKeyDown={onActivate(show)}>
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
                {/* What a click does: the changes open in a tab. */}
                <span className="history-open" aria-hidden>
                  <Icon name="openChanges" size={14} />
                </span>
              </div>
            );
          })}
          <div className="history-buttons">
            <button className="primary" onClick={() => void studio.history.showChanges(v)}>
              What changed
            </button>
            {!latest && (
              <button title="Everything that changed from this version until now" onClick={() => void studio.history.compareWithNow(v)}>
                Compare with now
              </button>
            )}
            {v.kind === 'agent' && v.parent && (
              <button disabled={busy} title="Put back what these files looked like before the agent changed them" onClick={() => void studio.history.undoVersion(v)}>
                Undo these changes
              </button>
            )}
            {!latest && (
              <button disabled={busy} title="Put the whole book back as it was at this point" onClick={() => void studio.history.restoreVersion(v)}>
                Restore this version
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Single-quoted for a shell, for the Git command the author can copy. */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** What History is, where it's kept, and how to go back: one line, more on request. */
function HistoryAbout() {
  const repo = useStore(studio.store, (s) => s.history.repo);
  const root = useStore(studio.store, (s) => s.workspace?.root);
  const [open, setOpen] = useState(false);
  return (
    <div className="history-help muted">
      Versions are saved automatically as you work and around every assistant change.{' '}
      <button className="link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Less' : 'How does this work?'}
      </button>
      {open && (
        <div className="history-about">
          <p>
            <b>Where:</b> in a Git repository Typst Studio keeps for this book, in its own data folder rather than in the book folder
            {repo && (
              <>
                {' '}
                (<code className="selectable">{tildePath(repo.gitDir)}</code>)
              </>
            )}
            . History never touches your own Git repository, if the book has one: that's Source Control, where you commit, pull and push yourself.
          </p>
          <p>
            <b>Going back:</b> click a version (<b>›</b>) to fold out the files it changed, then a file, or <b>What changed</b>, to see the changes line by line in a tab.{' '}
            <b>◀ Older</b> and <b>Newer ▶</b> there step through the versions one at a time; <b>Compare with now</b> shows everything since. You can undo just what the assistant changed, or put the whole book back as it was. Restoring adds a new version, so you can always go
            forward again.
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

function NameVersion() {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  if (!naming) {
    return (
      <button title="Mark this point, e.g. “Draft sent to editor”" onClick={() => setNaming(true)}>
        Name this version…
      </button>
    );
  }
  const save = async () => {
    await studio.history.saveNamed(name);
    setName('');
    setNaming(false);
  };
  return (
    <form
      className="history-name"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input autoFocus value={name} placeholder="e.g. Draft 2 sent to editor" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} />
      <button className="primary" type="submit" disabled={!name.trim()}>
        Save
      </button>
    </form>
  );
}

export function HistoryPanel() {
  const history = useStore(studio.store, (s) => s.history);
  if (history.status === 'unavailable') {
    return <div className="history-empty bad">History is off: {history.error}</div>;
  }
  if (history.status !== 'ready') return <div className="history-empty muted">Starting history…</div>;
  let lastDay = '';
  return (
    <div className="history">
      <div className="history-actions">
        <NameVersion />
      </div>
      {history.filter ? (
        <div className="history-filter">
          <span>
            Only <code>{history.filter}</code>
          </span>
          <button className="icon" title="Show every version" aria-label="Show every version" onClick={() => void studio.history.setFilter(null)}>
            ✕
          </button>
        </div>
      ) : (
        <HistoryAbout />
      )}
      {history.filter && !history.versions.length && <div className="history-empty muted">No versions changed this file yet.</div>}
      <div className="history-list">
        {history.versions.map((v, i) => {
          const day = dayLabel(v.time);
          const header = day !== lastDay;
          lastDay = day;
          return (
            <div key={v.id}>
              {header && <div className="history-day">{day}</div>}
              <VersionRow v={v} latest={i === 0} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
