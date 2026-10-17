import { useEffect, useState } from 'react';
import type { ChangedFile } from '../app/history';
import { changedFormulas, type Hunk } from '../app/prose-diff';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
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

/** One changed passage, word by word; its line opens the file there (Source Control's dialog uses it too). */
export function Passage({ hunk, path, latest, onOpen }: { hunk: Hunk; path: string; latest: boolean; onOpen?: () => void }) {
  const [full, setFull] = useState(false);
  let budget = full ? Infinity : PASSAGE_LIMIT;
  const pieces = hunk.pieces.map((p, i) => {
    if (budget <= 0) return null;
    const text = p.text.length > budget ? `${p.text.slice(0, budget)}…` : p.text;
    budget -= text.length;
    return p.kind === 'add' ? <ins key={i}>{text}</ins> : p.kind === 'del' ? <del key={i}>{text}</del> : <span key={i}>{text}</span>;
  });
  const cut = !full && hunk.pieces.reduce((n, p) => n + p.text.length, 0) > PASSAGE_LIMIT;
  return (
    <div className="change-passage">
      <button
        className="change-line link"
        title={latest ? 'Open the file here' : 'Open the file (the line may have moved since)'}
        onClick={() => {
          (onOpen ?? (() => studio.history.closeChanges()))();
          void studio.openAt(path, hunk.line);
        }}
      >
        line {hunk.line}
      </button>
      <div className="change-text">
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

function FileChanges({ file, latest }: { file: ChangedFile; latest: boolean }) {
  const view = useStore(studio.store, (s) => s.history.changes)!;
  const busy = useStore(studio.store, (s) => s.history.busy);
  const d = file.diff;
  return (
    <section className="change-file">
      <header>
        <span className="history-path">{file.path}</span>
        {file.status === 'A' && <span className="pill">new</span>}
        {file.status === 'D' && <span className="pill bad">deleted</span>}
        {d && (
          <span className="history-counts" title="Words added and removed">
            <span className="add-n">+{d.added}</span> <span className="del-n">−{d.removed}</span> words
          </span>
        )}
        <span className="spacer" />
        {view.mode === 'version' && file.diff && (
          <button className="small" onClick={() => void studio.history.showDiff(view.version, file.path)}>
            Side by side
          </button>
        )}
        {view.mode === 'version' && file.status !== 'D' && (
          <button className="small" disabled={busy} title="Write this file back as it was right after this version" onClick={() => void studio.history.restoreFile(view.version, file.path)}>
            Restore file
          </button>
        )}
      </header>
      {file.note && <div className="muted">{file.note}</div>}
      {d && !d.hunks.length && <div className="muted">Only spacing or line endings changed.</div>}
      {d?.hunks.map((h, i) => <Passage key={i} hunk={h} path={file.path} latest={latest} />)}
    </section>
  );
}

/** What one version changed (or everything since it), as readable text with the changed words marked. */
export function HistoryChanges() {
  const view = useStore(studio.store, (s) => s.history.changes);
  const versions = useStore(studio.store, (s) => s.history.versions);
  const diffOpen = useStore(studio.store, (s) => !!s.history.diff);
  const busy = useStore(studio.store, (s) => s.history.busy);

  useEffect(() => {
    if (!view || diffOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') studio.history.closeChanges();
      else if (e.key === 'ArrowLeft' && e.altKey) void studio.history.stepChanges(1);
      else if (e.key === 'ArrowRight' && e.altKey) void studio.history.stepChanges(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, diffOpen]);

  if (!view) return null;
  const v = view.version;
  const index = versions.findIndex((x) => x.id === v.id);
  const when = new Date(v.time * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const files = view.files;
  const words = files?.reduce((acc, f) => ({ added: acc.added + (f.diff?.added ?? 0), removed: acc.removed + (f.diff?.removed ?? 0) }), { added: 0, removed: 0 });
  // Lines only point at today's text for the latest version, or when comparing with now.
  const latest = view.mode === 'now' || index === 0;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.history.closeChanges()}>
      <div className="modal history-changes" role="dialog" aria-label="What changed">
        <div className="modal-header">
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
          <button className="icon" aria-label="Close" onClick={() => studio.history.closeChanges()}>
            ✕
          </button>
        </div>
        <div className="modal-body changes-body">
          {view.error && <p className="bad">{view.error}</p>}
          {!files && <p className="muted">Loading…</p>}
          {files && !files.length && !view.error && <p className="muted">{view.mode === 'now' ? 'Nothing has changed since this version.' : 'This version changed no files.'}</p>}
          {files?.map((f) => <FileChanges key={f.path} file={f} latest={latest} />)}
          {view.more > 0 && <p className="muted">…and {view.more} more files.</p>}
        </div>
        <div className="modal-footer">
          <span className="muted legend">
            <ins>added</ins> <del>removed</del>
          </span>
          <span className="spacer" />
          {view.mode === 'version' && v.kind === 'agent' && v.parent && (
            <button disabled={busy} title="Put back what these files looked like before the assistant changed them" onClick={() => void studio.history.undoVersion(v)}>
              Undo these changes
            </button>
          )}
          {index > 0 && (
            <button disabled={busy} title="Put the whole book back as it was at this point" onClick={() => void studio.history.restoreVersion(v)}>
              Restore this version
            </button>
          )}
          <button onClick={() => studio.history.closeChanges()}>Close</button>
        </div>
      </div>
    </div>
  );
}
