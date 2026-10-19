import { ASSISTANT_NAMES } from '../app/settings';
import { studio } from '../app/studio';
import type { MergeQuestion } from '../editor/documents';
import { useStore } from '../lib/store';
import { ChangeView } from './CommentCard';

/** A passage changed two ways at once, under it in the editor: the editor has the author's; the other version, to take or leave. */
export function MergeCard({ path, question: q }: { path: string; question: MergeQuestion }) {
  const assistant = useStore(studio.store, (s) => ASSISTANT_NAMES[s.settings.assistant]);
  const canAsk = useStore(studio.store, (s) => s.agent.status === 'ready');
  const head =
    q.kind === 'kept' ? (q.by ? `${q.by}’s version didn’t have your change` : 'The new version on disk didn’t have your change') : q.by ? `${q.by} changed this too` : 'This changed on disk too';
  const note =
    q.kind === 'kept'
      ? `${q.by ? 'It wrote' : 'It came'} from a copy older than your save, so yours stays, in the file too. Use theirs makes these changes:`
      : 'The editor has yours. Use theirs makes these changes:';
  return (
    <div className="comment-card merge" onMouseDown={(e) => e.stopPropagation()}>
      <div className="comment-head">
        <span className="comment-id">{head}</span>
      </div>
      <div className="merge-note">{note}</div>
      <ChangeView before={q.mine} after={q.theirs} />
      <div className="comment-actions">
        <button className="small" title="Leave the passage as it is in the editor" onClick={() => studio.keepMine(path, q.id)}>
          Keep mine
        </button>
        <button className="small" title="Put the other version in the editor (⌘Z undoes it)" onClick={() => studio.useTheirs(path, q.id)}>
          Use theirs
        </button>
        <button className="small" disabled={!canAsk} title={`Ask ${assistant} to combine both versions in the file`} onClick={() => void studio.resolveWithAssistant(path, q.id)}>
          Resolve with {assistant}
        </button>
      </div>
    </div>
  );
}
