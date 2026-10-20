import { useState } from 'react';
import { headingAt, wordsLabel } from '../app/contents';
import { studio } from '../app/studio';
import { chapterNumber } from '../app/tool-labels';
import type { Heading } from '../editor/outline';
import { useStore } from '../lib/store';
import { Icon } from './icons';

/**
 * The book's contents: the main file's own headings, then each chapter it
 * includes, in order, numbered as the book numbers them, with its sections
 * and about how many words it has. A click goes there; the place the cursor
 * is under is lit, as VS Code's Outline follows the cursor.
 */
export function ContentsPanel() {
  const names = useStore(studio.store, (s) => s.names);
  const contents = useStore(studio.store, (s) => s.contents);
  const active = useStore(studio.store, (s) => s.active);
  const cursorLine = useStore(studio.store, (s) => s.cursor?.line ?? 1);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const files = [...(names.entry ? [names.entry] : []), ...names.chapters.filter((c) => c !== names.entry)].filter((f) => contents[f]);
  if (!files.length) return <div className="history-empty muted">{names.entry ? 'Reading the chapters…' : 'This book has no main file, so no chapters in order yet.'}</div>;
  const here = active && contents[active] ? headingAt(contents[active].headings, cursorLine) : null;
  const total = files.reduce((n, f) => n + contents[f].words, 0);
  // The chapters the book numbers, not its title page or preface; every included file if it numbers none.
  const included = files.filter((f) => f !== names.entry);
  const chapters = included.filter((f) => chapterNumber(f, names)).length || included.length;

  const row = (path: string, h: Heading, label: string, depth: number) => (
    <button
      key={`${path}:${h.line}`}
      className={`contents-row depth-${depth}${path === active && here?.line === h.line ? ' here' : ''}`}
      title={`${path}, line ${h.line}`}
      onClick={() => void studio.openAt(path, h.line)}
    >
      <span className="contents-title">{label}</span>
    </button>
  );

  return (
    <div className="contents-panel">
      <div className="contents-total muted">
        {chapters} chapter{chapters === 1 ? '' : 's'} · about {wordsLabel(total)}
      </div>
      {files.map((path) => {
        const c = contents[path];
        const main = path === names.entry;
        // The main file's own headings stand alone (a preface, an appendix); a chapter is its first heading, sections under it.
        if (main) return c.headings.filter((h) => h.level <= 2).map((h) => row(path, h, h.title, h.level === 1 ? 0 : 1));
        const [first, ...rest] = c.headings;
        const n = chapterNumber(path, names);
        const title = names.titles[path] ?? first?.title ?? path.slice(path.lastIndexOf('/') + 1);
        const open = !folded.has(path);
        const sections = rest.filter((h) => h.level <= 2);
        const current = path === active;
        return (
          <section key={path} className={`contents-chapter${current ? ' current' : ''}`}>
            <div className={`contents-row depth-0 chapter${current && (!here || here.line === first?.line) ? ' here' : ''}`}>
              <button
                className={`icon contents-fold${open ? ' open' : ''}`}
                aria-label={open ? 'Fold up its sections' : 'Show its sections'}
                aria-expanded={open}
                disabled={!sections.length}
                onClick={() =>
                  setFolded((f) => {
                    const next = new Set(f);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
              >
                {sections.length > 0 && <Icon name="chevronRight" size={14} />}
              </button>
              <button className="contents-go" title={`${path}${first ? `, line ${first.line}` : ''}`} onClick={() => void studio.openAt(path, first?.line ?? 1)}>
                {n && <span className="contents-number">{n}</span>}
                <span className="contents-title">{title}</span>
                <span className="contents-words" title={`About ${wordsLabel(c.words)}`}>
                  {c.words >= 1000 ? `${(c.words / 1000).toFixed(1)}k` : c.words}
                </span>
              </button>
            </div>
            {open && sections.map((h) => row(path, h, h.title, 1))}
          </section>
        );
      })}
    </div>
  );
}
