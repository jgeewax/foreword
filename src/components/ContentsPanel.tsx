import { useEffect, useLayoutEffect, useRef } from 'react';
import { headingAt, wordsLabel, type FileContents } from '../app/contents';
import { studio } from '../app/studio';
import { chapterNumber } from '../app/tool-labels';
import type { Heading } from '../editor/outline';
import { Store, useStore } from '../lib/store';
import { Icon } from './icons';

// The files whose sections are folded away: shared by the list and its title
// bar's Collapse All, and kept while another view shows.
const folds = new Store<{ folded: ReadonlySet<string> }>({ folded: new Set() });

/** The files the contents list, the main file first, then each chapter it includes, in order. */
function useBook() {
  const names = useStore(studio.store, (s) => s.names);
  const contents = useStore(studio.store, (s) => s.contents);
  const files = [...(names.entry ? [names.entry] : []), ...names.chapters.filter((c) => c !== names.entry)].filter((f) => contents[f]);
  return { names, contents, files };
}

/** What a fold hides: the main file's second-level headings, or a chapter's sections under its title. */
function sections(c: FileContents, main: boolean): Heading[] {
  return main ? c.headings.filter((h) => h.level === 2) : c.headings.slice(1).filter((h) => h.level <= 2);
}

/** Scrolls the list so its lit row is in the middle, once per opening, and only while it shows. */
function reveal(list: HTMLElement | null, done: { current: boolean }) {
  if (!list || done.current || !list.clientWidth || !list.clientHeight) return;
  done.current = true;
  const lit = list.querySelector<HTMLElement>('.contents-row.here');
  if (!lit) return;
  const box = list.getBoundingClientRect();
  const row = lit.getBoundingClientRect();
  list.scrollTop += row.top - box.top - (box.height - row.height) / 2;
}

/** The Contents title bar's action: fold every chapter to just its title, or open them all again. */
export function ContentsActions() {
  const { names, contents, files } = useBook();
  const folded = useStore(folds, (s) => s.folded);
  const foldable = files.filter((f) => sections(contents[f], f === names.entry).length);
  const all = foldable.length > 0 && foldable.every((f) => folded.has(f));
  return (
    <button
      className="icon pane-action"
      title={all ? 'Expand all (every section)' : 'Collapse all (just the chapters)'}
      aria-label={all ? 'Expand all' : 'Collapse all'}
      disabled={!foldable.length}
      onClick={() => folds.set({ folded: new Set(all ? [] : foldable) })}
    >
      <Icon name={all ? 'expandAll' : 'collapseAll'} size={16} />
    </button>
  );
}

/**
 * The book's contents: the main file's own headings, then each chapter it
 * includes, in order, numbered as the book numbers them, with its sections
 * and about how many words it has. A click goes there; the place the cursor
 * is under is lit, as VS Code's Outline follows the cursor.
 */
export function ContentsPanel() {
  const { names, contents, files } = useBook();
  const active = useStore(studio.store, (s) => s.active);
  const cursorLine = useStore(studio.store, (s) => s.cursor?.line ?? 1);
  const folded = useStore(folds, (s) => s.folded);
  // Opened (the view picked, or the sidebar shown again), the list scrolls to
  // the place the cursor is under, once the cursor's chapter is in it.
  const panel = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);
  const ready = useRef(false);
  ready.current = files.length > 0 && (!active || !(active === names.entry || names.chapters.includes(active)) || !!contents[active]);
  useLayoutEffect(() => {
    if (ready.current) reveal(panel.current, revealed);
  });
  const listed = files.length > 0;
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // A collapsed sidebar keeps the list mounted: showing it again is opening it.
    const watch = new ResizeObserver(() => {
      if (!el.clientWidth || !el.clientHeight) revealed.current = false;
      else if (ready.current) reveal(el, revealed);
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [listed]);
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
    <div className="contents-panel" ref={panel}>
      <div className="contents-total muted">
        {chapters} chapter{chapters === 1 ? '' : 's'} · about {wordsLabel(total)}
      </div>
      {files.map((path) => {
        const c = contents[path];
        const main = path === names.entry;
        const open = !folded.has(path);
        // The main file's own headings stand alone (a preface, an appendix); a chapter is its first heading, sections under it.
        if (main) return c.headings.filter((h) => h.level === 1 || (h.level === 2 && open)).map((h) => row(path, h, h.title, h.level === 1 ? 0 : 1));
        const first = c.headings[0];
        const n = chapterNumber(path, names);
        const title = names.titles[path] ?? first?.title ?? path.slice(path.lastIndexOf('/') + 1);
        const under = sections(c, false);
        const current = path === active;
        return (
          <section key={path} className={`contents-chapter${current ? ' current' : ''}`}>
            {/* Folded, the chapter is lit wherever in it the cursor is. */}
            <div className={`contents-row depth-0 chapter${current && (!open || !here || here.line === first?.line) ? ' here' : ''}`}>
              <button
                className={`icon contents-fold${open ? ' open' : ''}`}
                aria-label={open ? 'Fold up its sections' : 'Show its sections'}
                aria-expanded={open}
                disabled={!under.length}
                onClick={() =>
                  folds.set(({ folded: f }) => {
                    const next = new Set(f);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return { folded: next };
                  })
                }
              >
                {under.length > 0 && <Icon name="chevronRight" size={14} />}
              </button>
              <button className="contents-go" title={`${path}${first ? `, line ${first.line}` : ''}`} onClick={() => void studio.openAt(path, first?.line ?? 1)}>
                {n && <span className="contents-number">{n}</span>}
                <span className="contents-title">{title}</span>
                <span className="contents-words" title={`About ${wordsLabel(c.words)}`}>
                  {c.words >= 1000 ? `${(c.words / 1000).toFixed(1)}k` : c.words}
                </span>
              </button>
            </div>
            {open && under.map((h) => row(path, h, h.title, 1))}
          </section>
        );
      })}
    </div>
  );
}
