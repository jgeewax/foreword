import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import type { ChangedFile } from '../app/history';
import { changedFormulas, changeStart, type Hunk } from '../app/prose-diff';
import { studio } from '../app/studio';
import { HISTORY_TAB } from '../app/view-tabs';
import { useStore } from '../lib/store';
import { DiffEditor } from './DiffEditor';
import { FileIcon, Icon, type IconName } from './icons';
import { TypstSnippet } from './TypstSnippet';

const KIND_TITLE: Record<string, string> = {
  opened: 'Opened in Typst Studio',
  save: 'Your edits',
  agent: 'Changes by the assistant',
  milestone: 'Named version',
  restore: 'Restore',
};

/** Long passages (a whole new file) are cut here until "Show all". */
const PASSAGE_LIMIT = 1600;

/**
 * One changed passage, word by word; its line opens the file there. Clicking
 * the passage scrolls the preview to it (`text`: the newer text it's in).
 */
export function Passage({ hunk, path, latest, text: newer }: { hunk: Hunk; path: string; latest: boolean; text?: string | null }) {
  const [full, setFull] = useState(false);
  let budget = full ? Infinity : PASSAGE_LIMIT;
  const pieces = hunk.pieces.map((p, i) => {
    if (budget <= 0) return null;
    const text = p.text.length > budget ? `${p.text.slice(0, budget)}…` : p.text;
    budget -= text.length;
    return p.kind === 'add' ? <ins key={i}>{text}</ins> : p.kind === 'del' ? <del key={i}>{text}</del> : <span key={i}>{text}</span>;
  });
  const cut = !full && hunk.pieces.reduce((n, p) => n + p.text.length, 0) > PASSAGE_LIMIT;
  const preview = (e: MouseEvent) => {
    if (newer == null || (e.target as HTMLElement).closest('button')) return;
    const at = changeStart(hunk);
    studio.previewDiffAt(path, newer, at.line, at.column);
  };
  return (
    <div className="change-passage">
      <button
        className="change-line link"
        title={latest ? 'Open the file here' : 'Open the file (the line may have moved since)'}
        onClick={() => void studio.openAt(path, hunk.line)}
      >
        line {hunk.line}
      </button>
      <div className="change-text" onClick={preview}>
        {hunk.before.map((l, i) => (
          <div key={`b${i}`} className="change-context">
            {l || ' '}
          </div>
        ))}
        <div className="change-body">{pieces}</div>
        {hunk.after.map((l, i) => (
          <div key={`a${i}`} className="change-context">
            {l || ' '}
          </div>
        ))}
        {cut && (
          <button className="link" onClick={() => setFull(true)}>
            Show all
          </button>
        )}
        <Formulas hunk={hunk} />
      </div>
    </div>
  );
}

/** Formulas the passage changed, drawn: what it was, and what it is now. */
function Formulas({ hunk }: { hunk: Hunk }) {
  const pairs = changedFormulas(hunk);
  if (!pairs.length) return null;
  const draw = (f: string | null, kind: 'was' | 'now') =>
    f ? (
      <span className={`change-formula-${kind}`}>
        <TypstSnippet source={f} inline fallback={<code>{f}</code>} />
      </span>
    ) : (
      <span className="muted">{kind === 'was' ? 'new' : 'removed'}</span>
    );
  return (
    <div className="change-formulas">
      {pairs.map((p, i) => (
        <div key={i} className="change-formula">
          {draw(p.before, 'was')}
          <span className="muted" aria-label="became">
            →
          </span>
          {draw(p.after, 'now')}
        </div>
      ))}
    </div>
  );
}

/** How a "what changed" tab shows changes: the diff editor (lines), or word by word. */
export type ChangesMode = 'lines' | 'words';
const MODE_KEY = 'studio.changesMode';

/** The way changes are shown, remembered (a convenience: lines if it can't be read). */
export function useChangesMode(): [ChangesMode, (mode: ChangesMode) => void] {
  const [mode, setMode] = useState<ChangesMode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'words' ? 'words' : 'lines';
    } catch {
      return 'lines';
    }
  });
  const choose = (next: ChangesMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Only a convenience.
    }
  };
  return [mode, choose];
}

export function ChangesModeSwitch({ mode, onChange }: { mode: ChangesMode; onChange: (mode: ChangesMode) => void }) {
  const option = (value: ChangesMode, label: string, title: string) => (
    <button role="radio" aria-checked={mode === value} className={mode === value ? 'on' : ''} title={title} onClick={() => onChange(value)}>
      {label}
    </button>
  );
  return (
    <div className="changes-mode" role="radiogroup" aria-label="Show changes as">
      {option('lines', 'Lines', "The text before and after: side by side when there's room, one above the other when not")}
      {option('words', 'Words', 'What changed, word by word, with formulas drawn')}
    </div>
  );
}

/** A file's action in a "what changed" tab: an icon and a word, quiet until hovered, on one line. */
export function ChangeAction({ icon, label, title, disabled, onClick }: { icon: IconName; label: string; title: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button className="change-action" title={title} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

/**
 * One file in a "what changed" tab: its name, folder and counts, its actions
 * (below the name when the tab is narrow), then its changes as lines or words.
 */
export function ChangedFileSection({ file, mode, latest, actions }: { file: ChangedFile; mode: ChangesMode; latest: boolean; actions?: ReactNode }) {
  const d = file.diff;
  const slash = file.path.lastIndexOf('/');
  return (
    <section className="change-file">
      <header>
        <FileIcon path={file.path} />
        {/* The name first, then its folder: a narrow tab cuts the folder, not the name. */}
        <span className="history-path" title={file.path}>
          {file.path.slice(slash + 1)}
          {slash > 0 && <span className="history-folder"> {file.path.slice(0, slash)}</span>}
        </span>
        {file.status === 'A' && <span className="pill">new</span>}
        {file.status === 'D' && <span className="pill bad">deleted</span>}
        {d && (
          <span className="history-counts" title="Words added and removed">
            <span className="add-n">+{d.added}</span> <span className="del-n">−{d.removed}</span> words
          </span>
        )}
        <span className="change-actions">
          {latest && file.status !== 'D' && <ChangeAction icon="goToFile" label="Open" title="Open the file" onClick={() => void studio.openFile(file.path)} />}
          {actions}
        </span>
      </header>
      {file.note && <div className="muted">{file.note}</div>}
      {d && !d.hunks.length && <div className="muted">Only spacing or line endings changed.</div>}
      {d && d.hunks.length > 0 && mode === 'lines' && file.before !== undefined ? (
        <DiffEditor path={file.path} before={file.before} after={file.after ?? null} />
      ) : (
        d?.hunks.map((h, i) => <Passage key={i} hunk={h} path={file.path} latest={latest} text={file.after} />)
      )}
    </section>
  );
}

/**
 * What one version changed (or everything since it), in its own tab: each
 * file in the diff editor, or word by word.
 */
export function HistoryChanges() {
  const view = useStore(studio.store, (s) => s.history.changes);
  const versions = useStore(studio.store, (s) => s.history.versions);
  const busy = useStore(studio.store, (s) => s.history.busy);
  const [mode, setMode] = useChangesMode();

  // ⌥← / ⌥→: the version before or after, while this tab is in front (and not while typing).
  useEffect(() => {
    if (!view || view.mode !== 'version') return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || studio.state.viewTab !== HISTORY_TAB) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"], .monaco-editor')) return;
      if (e.key === 'ArrowLeft') void studio.history.stepChanges(1);
      else if (e.key === 'ArrowRight') void studio.history.stepChanges(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  if (!view) return null;
  const v = view.version;
  const index = versions.findIndex((x) => x.id === v.id);
  const when = new Date(v.time * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const files = view.files;
  const words = files?.reduce((acc, f) => ({ added: acc.added + (f.diff?.added ?? 0), removed: acc.removed + (f.diff?.removed ?? 0) }), { added: 0, removed: 0 });
  // Lines only point at today's text for the latest version, or when comparing with now.
  const latest = view.mode === 'now' || index === 0;
  return (
    <div className="changes-tab" aria-label="What changed">
      <div className="changes-header">
        {view.mode === 'version' && (
          <button className="small" disabled={index < 0 || index >= versions.length - 1} title="The version before this one (⌥←)" onClick={() => void studio.history.stepChanges(1)}>
            ◀ Older
          </button>
        )}
        <div className="changes-title">
          <h1 title={v.label}>{view.mode === 'now' ? `Since “${v.label}”` : v.label}</h1>
          <div className="muted">
            {view.mode === 'now' ? `Everything that changed from ${when} until now` : `${KIND_TITLE[v.kind] ?? v.kind} · ${when}`}
            {files && words && ` · ${files.length + view.more} file${files.length + view.more === 1 ? '' : 's'}, `}
            {files && words && (
              <>
                <span className="add-n">+{words.added}</span> <span className="del-n">−{words.removed}</span> words
              </>
            )}
          </div>
        </div>
        {view.mode === 'version' && (
          <button className="small" disabled={index <= 0} title="The version after this one (⌥→)" onClick={() => void studio.history.stepChanges(-1)}>
            Newer ▶
          </button>
        )}
        <ChangesModeSwitch mode={mode} onChange={setMode} />
        {view.mode === 'version' && v.kind === 'agent' && v.parent && (
          <button className="small" disabled={busy} title="Put back what these files looked like before the assistant changed them" onClick={() => void studio.history.undoVersion(v)}>
            Undo these changes
          </button>
        )}
        {index > 0 && (
          <button className="small" disabled={busy} title="Put the whole book back as it was at this point" onClick={() => void studio.history.restoreVersion(v)}>
            Restore this version
          </button>
        )}
      </div>
      <div className="changes-body">
        {view.error && <p className="bad">{view.error}</p>}
        {!files && <p className="muted">Loading…</p>}
        {files && !files.length && !view.error && <p className="muted">{view.mode === 'now' ? 'Nothing has changed since this version.' : 'This version changed no files.'}</p>}
        {files?.map((f) => (
          <ChangedFileSection
            key={f.path}
            file={f}
            mode={mode}
            latest={latest}
            actions={
              view.mode === 'version' && (
                <>
                  {mode === 'words' && f.diff && <ChangeAction icon="sideBySide" label="Side by side" title="This file's change side by side, in its own tab" onClick={() => void studio.history.showDiff(v, f.path)} />}
                  {f.status !== 'D' && <ChangeAction icon="undo" label="Restore" disabled={busy} title="Write this file back as it was right after this version" onClick={() => void studio.history.restoreFile(v, f.path)} />}
                </>
              )
            }
          />
        ))}
        {view.more > 0 && <p className="muted">…and {view.more} more files.</p>}
      </div>
    </div>
  );
}
