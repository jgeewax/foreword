import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { DiffEditor } from './DiffEditor';
import { FileIcon } from './icons';

/** What one version changed in one file, in its own tab: the diff editor (read-only). */
export function HistoryDiff() {
  const diff = useStore(studio.store, (s) => s.history.diff);
  const busy = useStore(studio.store, (s) => s.history.busy);
  if (!diff) return null;
  const when = new Date(diff.version.time * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="changes-tab" aria-label={`Changes to ${diff.path}`}>
      <div className="changes-header">
        <div className="changes-title">
          <h1 className="changes-path" title={diff.path}>
            <FileIcon path={diff.path} />
            {diff.path}
          </h1>
          <div className="muted">
            {diff.version.label} · {when}
            {diff.before === null && ' · new file'}
            {diff.after === null && ' · deleted'}
          </div>
        </div>
        <button
          className="small"
          disabled={busy || diff.after === null || !!diff.error}
          title="Write this file back as it was right after this version (your current text is saved in History first)"
          onClick={() => void studio.history.restoreFile(diff.version, diff.path)}
        >
          Restore this file
        </button>
      </div>
      <div className="changes-body">{diff.error ? <p className="bad">{diff.error}</p> : <DiffEditor path={diff.path} before={diff.before} after={diff.after} />}</div>
    </div>
  );
}
