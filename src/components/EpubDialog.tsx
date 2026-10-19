import { useEffect, useState } from 'react';
import { studio, type EpubResult } from '../app/studio';
import { errorMessage } from '../lib/ipc';
import { tildePath } from '../lib/paths';
import { ActivityGlyph } from './Trace';

type Choice = 'auto' | 'reflow' | 'fixed';

const CHOICES: { id: Choice; name: string; description: string }[] = [
  {
    id: 'auto',
    name: 'Best for this book',
    description: 'Typst Studio picks: fixed layout for a picture book, a paper, or a book with math on most pages; reflowing text for the rest.',
  },
  {
    id: 'reflow',
    name: 'Reflowing text',
    description:
      'The reader picks the type size, and the text flows to fit any screen: right for novels and most prose. Math, figures and grids are drawn as pictures; some layout (page breaks, centring, space set by hand) is left out.',
  },
  {
    id: 'fixed',
    name: 'Fixed layout',
    description: 'Every page exactly as typeset: fonts, math, pictures. It doesn’t reflow, so it’s small on a phone and fine on a tablet, and readers can’t search it or read it aloud.',
  },
];

const KIND_NAMES = { reflow: 'reflowing text', fixed: 'fixed layout' } as const;

/** Export EPUB: which kind, then what was made, why, and what didn't carry over. */
export function EpubDialog() {
  const [choice, setChoice] = useState<Choice>('auto');
  const [phase, setPhase] = useState<'choose' | 'working' | 'done' | 'error'>('choose');
  const [result, setResult] = useState<EpubResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && phase !== 'working' && studio.closeEpubDialog();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const run = async () => {
    const target = await studio.pickEpubPath(await studio.defaultEpubPath());
    if (!target) return;
    setPhase('working');
    try {
      setResult(await studio.exportEpub(choice, target));
      setPhase('done');
    } catch (e) {
      setError(errorMessage(e));
      setPhase('error');
    }
  };
  const name = result ? result.path.slice(result.path.lastIndexOf('/') + 1) : '';
  const folder = result ? tildePath(result.path.slice(0, result.path.lastIndexOf('/'))) : '';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && phase !== 'working' && studio.closeEpubDialog()}>
      <div className="modal epub-dialog" role="dialog" aria-label="Export EPUB">
        <div className="modal-header">
          <h1>Export EPUB</h1>
          <span className="spacer" />
          <button className="icon modal-close" aria-label="Close" disabled={phase === 'working'} onClick={() => studio.closeEpubDialog()}>
            ✕
          </button>
        </div>
        <div className="modal-body epub-body">
          {phase === 'choose' && (
            <>
              <div className="epub-choices" role="radiogroup" aria-label="Kind of EPUB">
                {CHOICES.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={choice === c.id} className={`template-card epub-choice${choice === c.id ? ' selected' : ''}`} onClick={() => setChoice(c.id)}>
                    <span className="template-name">
                      {c.name}
                      {c.id === 'auto' && <span className="ask-badge">Recommended</span>}
                    </span>
                    <span className="template-description">{c.description}</span>
                  </button>
                ))}
              </div>
              <p className="muted epub-note">Kindle (Send to Kindle and KDP), Apple Books, Kobo and Google Play all take EPUB. MOBI is no longer used: Amazon stopped taking it.</p>
            </>
          )}
          {phase === 'working' && (
            <div className="epub-working">
              <ActivityGlyph phase="writing" />
              <span className="shimmer">Making the EPUB…</span>
            </div>
          )}
          {phase === 'done' && result && (
            <div className="epub-done">
              <p>
                <strong>Made “{name}”</strong> in {folder}: {KIND_NAMES[result.kind]}, {result.chapters} {result.kind === 'fixed' ? `contents entr${result.chapters === 1 ? 'y' : 'ies'}` : `part${result.chapters === 1 ? '' : 's'}`}, because {result.why}.
              </p>
              {result.kind === 'reflow' &&
                (result.lost.length ? (
                  <>
                    <p className="epub-lost-head">Didn’t carry over (an e-reader lays these out itself):</p>
                    <ul className="epub-lost">
                      {result.lost.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>Everything carried over.</p>
                ))}
              {result.kind === 'fixed' && <p className="muted">Each page is a picture of the typeset page: readers can’t change the type size, search it or read it aloud.</p>}
            </div>
          )}
          {phase === 'error' && <p className="bad">The EPUB couldn’t be made: {error}</p>}
        </div>
        <div className="modal-footer">
          {phase === 'done' && result && (
            <>
              <button onClick={() => void studio.revealEpub(result.path)}>Show in Finder</button>
              <button title="Opens it in Books (or whatever opens EPUBs on this Mac), which adds it to your library" onClick={() => void studio.revealEpub(result.path, true)}>
                Open in Books
              </button>
            </>
          )}
          <span className="spacer" />
          {phase === 'choose' && (
            <>
              <button onClick={() => studio.closeEpubDialog()}>Cancel</button>
              <button className="primary" onClick={() => void run()}>
                Export…
              </button>
            </>
          )}
          {phase === 'error' && <button onClick={() => setPhase('choose')}>Back</button>}
          {(phase === 'done' || phase === 'error') && (
            <button className="primary" onClick={() => studio.closeEpubDialog()}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
