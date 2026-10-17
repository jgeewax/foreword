import { useEffect, useRef, useState } from 'react';
import { wordPieces } from '../app/prose-diff';
import type { ReviewComment } from '../app/review';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';

/** Writing a new comment, under the passage it's about. Enter saves; Shift+Enter is a new line; Esc cancels. */
export function CommentComposer({ quote }: { quote: string }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => ref.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="comment-card composer" onMouseDown={(e) => e.stopPropagation()}>
      <div className="comment-quote">“{quote.replace(/\s+/g, ' ').slice(0, 120)}{quote.length > 120 ? '…' : ''}”</div>
      <textarea
        ref={ref}
        rows={2}
        value={text}
        placeholder="What should change here?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') studio.cancelComment();
          else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void studio.saveDraftComment(text);
          }
        }}
      />
      <div className="comment-actions">
        <span className="muted comment-hint">⏎ to add · ⇧⏎ new line · Esc to cancel</span>
        <span className="spacer" />
        <button className="small" onClick={() => studio.cancelComment()}>
          Cancel
        </button>
        <button className="small primary" disabled={!text.trim()} onClick={() => void studio.saveDraftComment(text)}>
          Comment
        </button>
      </div>
    </div>
  );
}

/** The change the assistant made for a comment, word by word. */
export function ChangeView({ before, after }: { before: string; after: string }) {
  return (
    <div className="comment-change">
      {wordPieces(before, after).map((p, i) => (p.kind === 'add' ? <ins key={i}>{p.text}</ins> : p.kind === 'del' ? <del key={i}>{p.text}</del> : <span key={i}>{p.text}</span>))}
    </div>
  );
}

/** A comment in place: its text, what the assistant did, and what you can do next. */
export function CommentCard({ comment: c }: { comment: ReviewComment }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.text);
  const busy = useStore(studio.store, (s) => s.review.busy.includes(c.id));
  const canAsk = useStore(studio.store, (s) => s.agent.status === 'ready' && !s.agent.running && !s.review.busy.length);
  return (
    <div className={`comment-card ${c.status}`} onMouseDown={(e) => e.stopPropagation()}>
      <div className="comment-head">
        <span className="comment-id">{c.status === 'addressed' ? 'Changed — check it' : c.status === 'resolved' ? 'Resolved' : 'Comment'}</span>
        {busy && (
          <span className="comment-busy">
            <span className="tool-spinner" /> the assistant is on it
          </span>
        )}
      </div>
      {editing ? (
        <textarea
          rows={2}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') setEditing(false);
            else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void studio.editComment(c.id, draft).then(() => setEditing(false));
            }
          }}
        />
      ) : (
        <div className="comment-text">{c.text}</div>
      )}
      {c.outcome?.kind === 'declined' && (
        <div className="comment-outcome declined">
          <span className="comment-who">✦ Declined:</span> {c.outcome.note || 'no reason given'}
        </div>
      )}
      {c.status === 'addressed' && c.outcome && (
        <div className="comment-outcome changed">
          <span className="comment-who">✦ {c.outcome.note || 'Changed the passage.'}</span>
          {c.outcome.change && <ChangeView before={c.outcome.change.before} after={c.outcome.change.after} />}
        </div>
      )}
      <div className="comment-actions">
        {c.status === 'addressed' ? (
          <>
            <button className="small primary" title="Keep the change; the comment is resolved" onClick={() => void studio.keepChange(c.id)}>
              Keep
            </button>
            {c.outcome?.change && (
              <button className="small" title="Put the passage back as it was, and reopen the comment" onClick={() => void studio.undoCommentChange(c.id)}>
                Undo change
              </button>
            )}
          </>
        ) : c.status === 'open' ? (
          <>
            <button className="small primary" disabled={!canAsk} title="Ask the assistant to make this change" onClick={() => void studio.addressComments([c.id])}>
              Fix with assistant
            </button>
            <button className="small" onClick={() => void studio.setCommentStatus(c.id, 'resolved')}>
              Resolve
            </button>
          </>
        ) : (
          <button className="small" onClick={() => void studio.setCommentStatus(c.id, 'open')}>
            Reopen
          </button>
        )}
        <span className="spacer" />
        {editing ? (
          <button className="small" onClick={() => void studio.editComment(c.id, draft).then(() => setEditing(false))}>
            Save
          </button>
        ) : (
          <button className="link" onClick={() => (setDraft(c.text), setEditing(true))}>
            Edit
          </button>
        )}
        <button className="link" onClick={() => void studio.deleteComment(c.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
