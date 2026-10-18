import { documentDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { AUTHOR_KEY, NEW_BOOK_PARENT, studio } from '../app/studio';
import { errorMessage } from '../lib/ipc';
import { tildePath as tilde } from '../lib/paths';
import { bookFolderName, PAPER_TEMPLATES, sizesByRegion, TEMPLATES, typstLength } from '../templates';

const stored = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

export function NewBookDialog() {
  const [kind, setKind] = useState<'book' | 'paper'>('book');
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const [paperId, setPaperId] = useState(PAPER_TEMPLATES[0].id);
  const chosen = TEMPLATES.find((t) => t.id === template)!;
  const paper = PAPER_TEMPLATES.find((t) => t.id === paperId)!;
  // Index into the template's sizes, or -1 for a custom size.
  const [sizeIndex, setSizeIndex] = useState(chosen.defaultSize);
  const [custom, setCustom] = useState({ width: '', height: '', unit: 'in' });
  useEffect(() => setSizeIndex(chosen.defaultSize), [chosen]);
  const customSize = { width: typstLength(`${custom.width}${custom.unit}`), height: typstLength(`${custom.height}${custom.unit}`) };
  const size = sizeIndex >= 0 ? chosen.sizes[sizeIndex] : customSize.width && customSize.height ? { width: customSize.width, height: customSize.height } : null;
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
      if (kind === 'paper') await studio.createBook(paper.id, { title: title.trim(), author: author.trim() }, parent);
      else await studio.createBook(template, { title: title.trim(), author: author.trim(), size: size ?? undefined }, parent);
    } catch (e) {
      setError(errorMessage(e));
      setCreating(false);
    }
  };

  const folder = bookFolderName(title);
  const ready = !!title.trim() && !!parent && (kind === 'paper' || !!size) && !creating;
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
          <h1>{kind === 'paper' ? 'New paper' : 'New book'}</h1>
          <div className="kind-switch" role="tablist">
            <button type="button" role="tab" aria-selected={kind === 'book'} className={kind === 'book' ? 'active' : ''} onClick={() => setKind('book')}>
              Books
            </button>
            <button type="button" role="tab" aria-selected={kind === 'paper'} className={kind === 'paper' ? 'active' : ''} onClick={() => setKind('paper')}>
              Research papers
            </button>
          </div>
          <span className="spacer" />
          <button type="button" className="icon" aria-label="Close" disabled={creating} onClick={() => studio.closeNewBook()}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {kind === 'paper' ? (
            <div className="template-grid papers" role="radiogroup" aria-label="Paper template">
              {PAPER_TEMPLATES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  role="radio"
                  aria-checked={paperId === t.id}
                  className={`template-card${paperId === t.id ? ' selected' : ''}`}
                  title={`${t.package.name} ${t.package.version} from Typst Universe`}
                  onClick={() => setPaperId(t.id)}
                >
                  <span className="template-name">{t.name}</span>
                  <span className="template-description">{t.description}</span>
                </button>
              ))}
            </div>
          ) : (
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
          )}
          {kind === 'paper' ? (
            <p className="settings-help">
              Uses the official <strong>{paper.package.name}</strong> template from Typst Universe (downloaded now from packages.typst.org). The venue sets the page size and
              layout. After it opens, the assistant can put your title and names in.
              {paper.fonts?.length ? ` Looks best with ${paper.fonts.map((f) => f.name).join(' and ')} (free fonts).` : ''}
            </p>
          ) : (
          <div className="field">
            <span>Page size</span>
            <div className="field-row">
              <select value={sizeIndex} aria-label="Page size" onChange={(e) => setSizeIndex(Number(e.target.value))}>
                {sizesByRegion(chosen.sizes).map(([region, sizes]) => (
                  <optgroup key={region} label={region}>
                    {sizes.map(({ size: s, index }) => (
                      <option key={s.label} value={index}>
                        {s.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={-1}>Custom…</option>
              </select>
              {sizeIndex < 0 && (
                <span className="custom-size">
                  <input aria-label="Width" inputMode="decimal" placeholder="width" value={custom.width} onChange={(e) => setCustom({ ...custom, width: e.target.value })} />
                  ×
                  <input aria-label="Height" inputMode="decimal" placeholder="height" value={custom.height} onChange={(e) => setCustom({ ...custom, height: e.target.value })} />
                  <select aria-label="Unit" value={custom.unit} onChange={(e) => setCustom({ ...custom, unit: e.target.value })}>
                    <option value="in">in</option>
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                  </select>
                </span>
              )}
            </div>
            <span className="field-note">You can change it later in main.typ. Printers list the sizes they offer as "trim sizes"; names and exact sizes vary a little between them.</span>
          </div>
          )}
          <label className="field">
            <span>Title</span>
            <input autoFocus value={title} placeholder={kind === 'paper' ? 'The title of your paper' : 'The name of your book'} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>{kind === 'paper' ? 'Authors' : 'Author'}</span>
            <input
              value={author}
              placeholder={kind === 'paper' ? 'e.g. Ada Lovelace and Charles Babbage' : 'Your name, as it should appear on the title page'}
              onChange={(e) => setAuthor(e.target.value)}
            />
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
          <p className="settings-help" hidden={kind === 'paper'}>
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
            {creating ? (kind === 'paper' ? 'Downloading the template…' : 'Creating…') : kind === 'paper' ? 'Create paper' : 'Create book'}
          </button>
        </div>
      </form>
    </div>
  );
}
