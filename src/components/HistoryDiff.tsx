import { useEffect, useRef } from 'react';
import { studio } from '../app/studio';
import { languageFor, monaco } from '../editor/monaco';
import { useStore } from '../lib/store';

/** What one version changed in one file, in Monaco's diff editor (read-only). */
export function HistoryDiff() {
  const diff = useStore(studio.store, (s) => s.history.diff);
  const busy = useStore(studio.store, (s) => s.history.busy);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!diff || diff.error || !host.current) return;
    const language = languageFor(diff.path);
    const original = monaco.editor.createModel(diff.before ?? '', language);
    const modified = monaco.editor.createModel(diff.after ?? '', language);
    const editor = monaco.editor.createDiffEditor(host.current, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: host.current.clientWidth > 900,
      wordWrap: 'on',
      diffWordWrap: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
    });
    editor.setModel({ original, modified });
    return () => {
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [diff]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && studio.history.closeDiff();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!diff) return null;
  const when = new Date(diff.version.time * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.history.closeDiff()}>
      <div className="modal history-diff" role="dialog" aria-label={`Changes to ${diff.path}`}>
        <div className="modal-header">
          <div>
            <h1>{diff.path}</h1>
            <div className="muted">
              {diff.version.label} · {when}
              {diff.before === null && ' · new file'}
              {diff.after === null && ' · deleted'}
            </div>
          </div>
          <button className="icon" aria-label="Close" onClick={() => studio.history.closeDiff()}>
            ✕
          </button>
        </div>
        {diff.error ? <div className="modal-body bad">{diff.error}</div> : <div className="history-diff-editor" ref={host} />}
        <div className="modal-footer">
          <span className="muted">Left: before · Right: after this version</span>
          <span className="spacer" />
          <button
            className="primary"
            disabled={busy || diff.after === null || !!diff.error}
            title="Write this file back as it was right after this version (your current text is saved in History first)"
            onClick={() => void studio.history.restoreFile(diff.version, diff.path)}
          >
            Restore this file
          </button>
          <button onClick={() => studio.history.closeDiff()}>Close</button>
        </div>
      </div>
    </div>
  );
}
