import { useEffect, useState } from 'react';
import { studio } from '../app/studio';
import type { ReviewComment } from '../app/review';
import { useStore } from '../lib/store';

/** Review comments: go to, edit, resolve, delete; address all of them with the assistant. */
export function ReviewPanel() {
  const review = useStore(studio.store, (s) => s.review);
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready' && !s.agent.running);
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
  const shown = review.comments.filter((c) => showResolved || c.status === 'open');
  const byFile = [...new Set(shown.map((c) => c.path))];
  const order = (a: ReviewComment, b: ReviewComment) => (lines[a.id] ?? a.line) - (lines[b.id] ?? b.line);

  return (
    <div className="review-panel">
      <div className="review-actions">
        <button className="primary" disabled={!open.length || !ready} title="Send every open comment to the assistant in one message" onClick={() => void studio.addressComments()}>
          Address {open.length || ''} with the assistant
        </button>
        <button className={review.mode ? 'on' : ''} title="Read-only editor; select text to comment" onClick={() => studio.setReviewMode(!review.mode)}>
          {review.mode ? 'Stop reviewing' : 'Review mode'}
        </button>
      </div>
      {!review.comments.length && (
        <p className="review-empty muted">
          Select text and press <kbd>⌥⌘M</kbd> (or right-click → Add Comment) to leave a note. Comments stay beside the text, then the assistant can address them all
          at once.
        </p>
      )}
      {byFile.map((path) => (
        <div key={path}>
          <div className="code-file-name">{path}</div>
          {shown
            .filter((c) => c.path === path)
            .sort(order)
            .map((c) => (
              <div key={c.id} className={`review-item ${c.status}`} role="button" tabIndex={0} onClick={() => void studio.goToComment(c)}>
                <div className="review-quote">
                  “{c.quote.replace(/\s+/g, ' ').slice(0, 90)}
                  {c.quote.length > 90 ? '…' : ''}”
                  <span className="review-where">{lines[c.id] === null ? 'text changed' : `line ${lines[c.id] ?? c.line}`}</span>
                </div>
                <div className="review-text">{c.text}</div>
                <div className="review-item-actions" onClick={(e) => e.stopPropagation()}>
                  {c.status === 'open' ? (
                    <button className="link" onClick={() => void studio.setCommentStatus(c.id, 'resolved')}>
                      Resolve
                    </button>
                  ) : (
                    <button className="link" onClick={() => void studio.setCommentStatus(c.id, 'open')}>
                      Reopen
                    </button>
                  )}
                  <button className="link" onClick={() => void studio.editComment(c.id)}>
                    Edit
                  </button>
                  <button className="link" onClick={() => void studio.deleteComment(c.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
        </div>
      ))}
      {review.comments.some((c) => c.status === 'resolved') && (
        <div className="review-footer">
          <label>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved
          </label>
          <button className="link" onClick={() => void studio.clearResolved()}>
            Remove resolved
          </button>
        </div>
      )}
    </div>
  );
}
