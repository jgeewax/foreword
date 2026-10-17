import { useEffect } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { Passage } from './HistoryChanges';

/** What changed in Git: uncommitted changes, or one commit; the same view as History's. */
export function GitChanges() {
  const view = useStore(studio.store, (s) => s.git.view);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && studio.git.closeView();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!view) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.git.closeView()}>
      <div className="modal history-changes" role="dialog" aria-label="What changed">
        <div className="modal-header">
          <div className="changes-title">
            <h1 title={view.title}>{view.title}</h1>
            <div className="muted">{view.subtitle}</div>
          </div>
          <span className="spacer" />
          <button className="icon" aria-label="Close" onClick={() => studio.git.closeView()}>
            ✕
          </button>
        </div>
        <div className="modal-body changes-body">
          {view.error && <p className="bad">{view.error}</p>}
          {!view.files && <p className="muted">Loading…</p>}
          {view.files?.map((f) => (
            <section key={f.path} className="change-file">
              <header>
                <span className="history-path">{f.path}</span>
                {f.status === 'A' && <span className="pill">new</span>}
                {f.status === 'D' && <span className="pill bad">deleted</span>}
                {f.diff && (
                  <span className="history-counts" title="Words added and removed">
                    <span className="add-n">+{f.diff.added}</span> <span className="del-n">−{f.diff.removed}</span> words
                  </span>
                )}
              </header>
              {f.note && <div className="muted">{f.note}</div>}
              {f.diff && !f.diff.hunks.length && <div className="muted">Only spacing or line endings changed.</div>}
              {f.diff?.hunks.map((h, i) => <Passage key={i} hunk={h} path={f.path} latest={view.working} onOpen={() => studio.git.closeView()} />)}
            </section>
          ))}
          {view.more > 0 && <p className="muted">…and {view.more} more files.</p>}
        </div>
      </div>
    </div>
  );
}
