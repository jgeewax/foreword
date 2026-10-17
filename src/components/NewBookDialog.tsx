import { documentDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { AUTHOR_KEY, NEW_BOOK_PARENT, studio } from '../app/studio';
import { errorMessage } from '../lib/ipc';
import { bookFolderName, TEMPLATES } from '../templates';

const stored = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

/** Shortens /Users/<name>/… to ~/… for display. */
const tilde = (path: string) => path.replace(/^\/Users\/[^/]+/, '~');

export function NewBookDialog() {
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState(() => stored(AUTHOR_KEY));
  const [parent, setParent] = useState(() => stored(NEW_BOOK_PARENT));
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!parent) documentDir().then((d) => setParent((p) => p || d.replace(/\/$/, '')), () => {});
  }, [parent]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !creating && studio.closeNewBook();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating]);

  const chooseParent = async () => {
    const picked = await openDialog({ directory: true, multiple: false, defaultPath: parent || undefined, title: 'Where should the book folder go?' });
    if (typeof picked === 'string') setParent(picked);
  };

  const create = async () => {
    setError(null);
    setCreating(true);
    try {
      await studio.createBook(template, { title: title.trim(), author: author.trim() }, parent);
    } catch (e) {
      setError(errorMessage(e));
      setCreating(false);
    }
  };

  const folder = bookFolderName(title);
  const ready = !!title.trim() && !!parent && !creating;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !creating && studio.closeNewBook()}>
      <form
        className="modal new-book"
        role="dialog"
        aria-label="New book"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void create();
        }}
      >
        <div className="modal-header">
          <h1>New book</h1>
          <button type="button" className="icon" aria-label="Close" disabled={creating} onClick={() => studio.closeNewBook()}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="template-grid" role="radiogroup" aria-label="Template">
            {TEMPLATES.map((t) => (
              <button
                type="button"
                key={t.id}
                role="radio"
                aria-checked={template === t.id}
                className={`template-card${template === t.id ? ' selected' : ''}`}
                onClick={() => setTemplate(t.id)}
              >
                <span className="template-name">{t.name}</span>
                <span className="template-description">{t.description}</span>
                <span className="template-details">{t.details}</span>
              </button>
            ))}
          </div>
          <label className="field">
            <span>Title</span>
            <input autoFocus value={title} placeholder="The name of your book" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Author</span>
            <input value={author} placeholder="Your name, as it should appear on the title page" onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <div className="field">
            <span>Location</span>
            <div className="field-row">
              <code className="path" title={parent}>
                {parent ? `${tilde(parent)}/${folder}` : 'Choose a folder…'}
              </code>
              <button type="button" onClick={() => void chooseParent()}>
                Change…
              </button>
            </div>
          </div>
          <p className="settings-help">
            Creates a folder with the book’s files, a writing style guide to fill in (WRITING_STYLE.md), and an <code>export</code> folder setting for PDFs. You can
            change the title and author later in <code>main.typ</code>.
          </p>
          {error && <p className="bad">{error}</p>}
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button type="button" disabled={creating} onClick={() => studio.closeNewBook()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ready}>
            {creating ? 'Creating…' : 'Create book'}
          </button>
        </div>
      </form>
    </div>
  );
}
