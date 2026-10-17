import { useEffect, useState } from 'react';
import { studio } from '../app/studio';
import type { ReviewComment } from '../app/review';
import { useStore } from '../lib/store';
import { ChangeView } from './CommentCard';

/**
 * Review comments, by what they need: changes to check (keep or undo), open
 * comments (fix with the assistant, resolve), and resolved ones.
 */
export function ReviewPanel() {
  const review = useStore(studio.store, (s) => s.review);
  const canAsk = useStore(studio.store, (s) => s.agent.status === 'ready' && !s.agent.running && !s.review.busy.length);
  const files = useStore(studio.store, (s) => s.workspace?.files);
  const [showResolved, setShowResolved] = useState(false);
  // Where each comment's passage is now (line), or null when its text changed.
  const [lines, setLines] = useState<Record<string, number | null>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, number | null> = {};
      for (const c of review.comments) next[c.id] = (await studio.locateComment(c))?.line ?? null;
      if (!cancelled) setLines(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [review.comments, files]);

  const open = review.comments.filter((c) => c.status === 'open');
  const toCheck = review.comments.filter((c) => c.status === 'addressed');
  const resolved = review.comments.filter((c) => c.status === 'resolved');
  const order = (a: ReviewComment, b: ReviewComment) => a.path.localeCompare(b.path) || (lines[a.id] ?? a.line) - (lines[b.id] ?? b.line);
  const where = (c: ReviewComment) => (lines[c.id] != null ? `line ${lines[c.id]}` : c.outcome?.change ? `line ${c.outcome.change.line}` : 'text changed');
  const names = useStore(studio.store, (s) => s.names);
  /** A group's comments under their files' names (in file order, then by line). */
  const byFile = (list: ReviewComment[]) =>
    [...new Set([...list].sort(order).map((c) => c.path))].map((path) => (
      <div key={path} className="review-file">
        <button className="review-file-name" title={path} onClick={() => void studio.openFile(path)}>
          <span>{names.titles[path] ?? path.split('/').pop()}</span>
          {names.titles[path] && <span className="muted"> · {path.split('/').pop()}</span>}
        </button>
        {[...list.filter((c) => c.path === path)].sort(order).map(item)}
      </div>
    ));

  const item = (c: ReviewComment) => (
    <div key={c.id} className={`review-item ${c.status}`} role="button" tabIndex={0} onClick={() => void studio.goToComment(c)}>
      <div className="review-quote">
        “{c.quote.replace(/\s+/g, ' ').slice(0, 90)}
        {c.quote.length > 90 ? '…' : ''}”<span className="review-where">{where(c)}</span>
      </div>
      <div className="review-text">{c.text}</div>
      {c.outcome && (
        <div className={`review-outcome ${c.outcome.kind}`}>
          ✦ {c.outcome.kind === 'declined' ? `Declined: ${c.outcome.note || 'no reason given'}` : c.outcome.note || 'Changed the passage.'}
        </div>
      )}
      {c.status === 'addressed' && c.outcome?.change && <ChangeView before={c.outcome.change.before} after={c.outcome.change.after} />}
      {review.busy.includes(c.id) && (
        <div className="review-outcome">
          <span className="tool-spinner" /> the assistant is on it
        </div>
      )}
      <div className="review-item-actions" onClick={(e) => e.stopPropagation()}>
        {c.status === 'addressed' && (
          <>
            <button className="small primary" onClick={() => void studio.keepChange(c.id)}>
              Keep
            </button>
            {c.outcome?.change && (
              <button className="small" onClick={() => void studio.undoCommentChange(c.id)}>
                Undo change
              </button>
            )}
          </>
        )}
        {c.status === 'open' && (
          <>
            <button className="link" disabled={!canAsk} onClick={() => void studio.addressComments([c.id])}>
              Fix with assistant
            </button>
            <button className="link" onClick={() => void studio.setCommentStatus(c.id, 'resolved')}>
              Resolve
            </button>
          </>
        )}
        {c.status === 'resolved' && (
          <button className="link" onClick={() => void studio.setCommentStatus(c.id, 'open')}>
            Reopen
          </button>
        )}
        <button className="link" onClick={() => void studio.deleteComment(c.id)}>
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <div className="review-panel">
      <div className="review-actions">
        <button className="primary" disabled={!open.length || !canAsk} title="The assistant makes every open comment’s change, then you check each one" onClick={() => void studio.addressComments()}>
          {open.length > 1 ? `Fix all ${open.length} with the assistant` : 'Fix with the assistant'}
        </button>
      </div>
      {!review.comments.length && (
        <div className="review-empty muted">
          <p>
            Select a passage (in the editor or the preview) and press <kbd>⌥⌘M</kbd>, click <strong>Comment</strong> by the selection, or right-click →
            Add Comment.
          </p>
          <p>Comments sit beside the text, not in it. The assistant can fix one or all of them; you check each change and keep or undo it.</p>
        </div>
      )}
      {toCheck.length > 0 && <div className="review-group">To check · {toCheck.length}</div>}
      {byFile(toCheck)}
      {open.length > 0 && <div className="review-group">Open · {open.length}</div>}
      {byFile(open)}
      {resolved.length > 0 && (
        <div className="review-footer">
          <label>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved ({resolved.length})
          </label>
          <button className="link" onClick={() => void studio.clearResolved()}>
            Remove resolved
          </button>
        </div>
      )}
      {showResolved && byFile(resolved)}
    </div>
  );
}
