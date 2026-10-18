import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { ChangedFileSection, ChangesModeSwitch, useChangesMode } from './HistoryChanges';

/** What changed in Git, in its own tab: uncommitted changes, or one commit; shown as History's are. */
export function GitChanges() {
  const view = useStore(studio.store, (s) => s.git.view);
  const [mode, setMode] = useChangesMode();
  if (!view) return null;
  return (
    <div className="changes-tab" aria-label="What changed">
      <div className="changes-header">
        <div className="changes-title">
          <h1 title={view.title}>{view.title}</h1>
          <div className="muted">{view.subtitle}</div>
        </div>
        <ChangesModeSwitch mode={mode} onChange={setMode} />
      </div>
      <div className="changes-body">
        {view.error && <p className="bad">{view.error}</p>}
        {!view.files && <p className="muted">Loading…</p>}
        {view.files?.map((f) => <ChangedFileSection key={f.path} file={f} mode={mode} latest={view.working} />)}
        {view.more > 0 && <p className="muted">…and {view.more} more files.</p>}
      </div>
    </div>
  );
}
