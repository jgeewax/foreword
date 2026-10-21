import { useEffect, useState } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';

/** A text question: one line (New Chapter, New File, Rename…) or a few (Revise the style guide). */
export function PromptDialog() {
  const request = useStore(studio.store, (s) => s.prompt);
  const [value, setValue] = useState('');
  useEffect(() => setValue(request?.value ?? ''), [request]);
  if (!request) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.answerPrompt(null)}>
      <form
        className="modal prompt"
        role="dialog"
        aria-label={request.title}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) studio.answerPrompt(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            studio.answerPrompt(null);
          }
        }}
      >
        <div className="modal-header">
          <h1>{request.title}</h1>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>{request.label}</span>
            {request.multiline ? (
              <textarea
                autoFocus
                rows={4}
                value={value}
                placeholder={request.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  // Return sends, as in the chat; Shift-Return is a new line.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && value.trim()) {
                    e.preventDefault();
                    studio.answerPrompt(value);
                  }
                }}
              />
            ) : (
              <input
                autoFocus
                value={value}
                placeholder={request.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onFocus={(e) => {
                  // Select the name without the extension, like Finder.
                  const dot = e.currentTarget.value.lastIndexOf('.');
                  e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
                }}
              />
            )}
          </label>
          {request.help && <p className="settings-help">{request.help}</p>}
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button type="button" onClick={() => studio.answerPrompt(null)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!value.trim()}>
            {request.okLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
