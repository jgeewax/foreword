import { useEffect, useState } from 'react';
import { studio } from '../app/studio';
import { COVER_STYLES, PAPERS, spineMm } from '../cover';
import { errorMessage } from '../lib/ipc';
import { typstLength } from '../templates';

/** Design Cover: pick a style, check the measurements, create cover/. */
export function CoverDialog() {
  const [style, setStyle] = useState(COVER_STYLES[0].id);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [pages, setPages] = useState('');
  const [pagesKnown, setPagesKnown] = useState(true);
  // The spine: from a paper's thickness per page, or exactly as the printer gives it.
  const [spineFrom, setSpineFrom] = useState<'paper' | 'exact'>('paper');
  const [paper, setPaper] = useState<string>(PAPERS[0].id);
  const [exact, setExact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void studio.bookMeasurements().then((b) => {
      setTitle((t) => t || b.title || '');
      setAuthor((a) => a || b.author || '');
      setWidth((w) => w || b.width || '6in');
      setHeight((h) => h || b.height || '9in');
      setPages((p) => p || String(b.pages ?? 200));
      setPagesKnown(b.pages != null);
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !creating && studio.closeCoverDialog();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating]);

  const thickness = PAPERS.find((p) => p.id === paper)!.thickness;
  const pageCount = Number(pages);
  const exactLength = typstLength(exact.trim());
  const sizeOk = !!typstLength(width.trim()) && !!typstLength(height.trim());
  const pagesOk = Number.isInteger(pageCount) && pageCount > 0 && pageCount < 10000;
  const spineOk = spineFrom === 'paper' || !!exactLength;
  const spine = spineFrom === 'exact' ? exactLength : pagesOk ? `${spineMm(pageCount, thickness)}mm` : null;
  const ready = !!title.trim() && sizeOk && pagesOk && spineOk && !creating;

  const create = async () => {
    setError(null);
    setCreating(true);
    try {
      await studio.designCover(style, {
        title: title.trim(),
        author: author.trim(),
        width: width.trim(),
        height: height.trim(),
        pages: pageCount,
        paper: thickness,
        spineWidth: spineFrom === 'exact' ? exactLength : null,
      });
    } catch (e) {
      setError(errorMessage(e));
      setCreating(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !creating && studio.closeCoverDialog()}>
      <form
        className="modal new-book"
        role="dialog"
        aria-label="Design cover"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void create();
        }}
      >
        <div className="modal-header">
          <h1>Design a cover</h1>
          <span className="spacer" />
          <button type="button" className="icon" aria-label="Close" disabled={creating} onClick={() => studio.closeCoverDialog()}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="template-grid" role="radiogroup" aria-label="Cover style">
            {COVER_STYLES.map((s) => (
              <button
                type="button"
                key={s.id}
                role="radio"
                aria-checked={style === s.id}
                className={`template-card${style === s.id ? ' selected' : ''}`}
                onClick={() => setStyle(s.id)}
              >
                <span className="template-name">{s.name}</span>
                <span className="template-description">{s.description}</span>
              </button>
            ))}
          </div>
          <label className="field">
            <span>Title</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Author</span>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <div className="field">
            <span>Trim size</span>
            <div className="field-row">
              <span className="custom-size">
                <input aria-label="Width" value={width} onChange={(e) => setWidth(e.target.value)} />
                ×
                <input aria-label="Height" value={height} onChange={(e) => setHeight(e.target.value)} />
              </span>
            </div>
            <span className="field-note">The book’s page size, from main.typ. Lengths like 6in or 148mm.</span>
          </div>
          <label className="field">
            <span>Pages</span>
            <input aria-label="Pages" inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} />
            <span className="field-note">
              {pagesKnown ? 'From the book as it is now.' : 'A guess: show the book in the preview first to use its page count.'} The spine grows with it; use Update from
              book once the book is final.
            </span>
          </label>
          <div className="field">
            <span>Spine</span>
            <div className="field-row">
              <select aria-label="Spine from" value={spineFrom} onChange={(e) => setSpineFrom(e.target.value as 'paper' | 'exact')}>
                <option value="paper">From the paper</option>
                <option value="exact">Exact width from my printer</option>
              </select>
              {spineFrom === 'paper' ? (
                <select aria-label="Paper" value={paper} onChange={(e) => setPaper(e.target.value)}>
                  {PAPERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input aria-label="Spine width" placeholder="e.g. 15.2mm" value={exact} onChange={(e) => setExact(e.target.value)} />
              )}
            </div>
            <span className="field-note">
              {spine ? `Spine: ${spine}. ` : ''}Printers publish a spine calculator; their number for your page count and paper is the one to trust.
            </span>
          </div>
          <p className="settings-help">
            Creates a <code>cover</code> folder: <code>design.typ</code> (yours to edit), <code>spec.typ</code> (the measurements), and <code>cover.typ</code> for
            printing. The preview shows the whole wrap (back, spine, front) with the trim, bleed and safe areas marked; the exported PDF has no guides.
          </p>
          {error && <p className="bad">{error}</p>}
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button type="button" disabled={creating} onClick={() => studio.closeCoverDialog()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ready}>
            {creating ? 'Creating…' : 'Create cover'}
          </button>
        </div>
      </form>
    </div>
  );
}
