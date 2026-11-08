// The chapter preview (Settings ▸ General ▸ Preview, previewScope "chapter"):
// the book's main file with one chapter in it, so a change typesets that
// chapter and not the whole book, and the preview shows that chapter alone.
// What the main file sets up stays (its imports, definitions, set and show
// rules, counters), so the chapter looks as it does in the book; what makes
// pages of its own goes (the title page, the contents, parts, blank pages,
// the index), with the other chapters. Pure; studio.ts sends the text to
// Tinymist as the preview's main file.
import { scanImports, scanIncludes } from './includes';
import { labelsPut, prose } from './labels';
import { resolveRef } from './references';
import { closing, scanItems, type Item } from './typst-items';

/**
 * The file Tinymist previews, beside the main file so its relative paths read
 * the same. Its text comes from Foreword (on disk it's a stub: a missing main
 * file makes Tinymist typeset it over and over); the file list, History and
 * git leave it out.
 */
export const CHAPTER_PREVIEW_NAME = '.foreword-chapter.typ';

/** Where the chapter preview's file is, book-relative, for a main file at `entry`. */
export function chapterPreviewPath(entry: string): string {
  const slash = entry.lastIndexOf('/');
  return slash < 0 ? CHAPTER_PREVIEW_NAME : `${entry.slice(0, slash)}/${CHAPTER_PREVIEW_NAME}`;
}

/** A file's text (book-relative path), or null if there's none. */
export type ReadText = (path: string) => string | null;

/** A file and the files it includes, however deep (book-relative), itself first. */
export function includeTree(path: string, read: ReadText, root = '', seen = new Set<string>()): string[] {
  if (seen.has(path)) return [];
  seen.add(path);
  const text = read(path);
  const out = [path];
  if (text == null) return out;
  for (const { spec } of scanIncludes(text)) {
    const file = resolveRef(path, spec, root);
    if (file) out.push(...includeTree(file, read, root, seen));
  }
  return out;
}

/** The files a file imports, however deep (book-relative, not packages), itself first. */
export function importTree(path: string, read: ReadText, root = '', seen = new Set<string>()): string[] {
  if (seen.has(path)) return [];
  seen.add(path);
  const text = read(path);
  const out = [path];
  if (text == null) return out;
  for (const { spec } of scanImports(text)) {
    const file = resolveRef(path, spec, root);
    if (file) out.push(...importTree(file, read, root, seen));
  }
  return out;
}

/** The chapter (one of the main file's includes) that `path` is, or is included in; null if none. */
export function chapterOf(path: string, chapters: string[], read: ReadText, root = ''): string | null {
  if (chapters.includes(path)) return path;
  return chapters.find((c) => includeTree(c, read, root).includes(path)) ?? null;
}

const HEADING_LABEL = /^\s*=+\s+(.+?)\s*<([\p{L}_][\p{L}\p{N}_:.-]*)>\s*$/gmu;

/** The labels a text puts on things, each with its heading's words when it labels a heading (null otherwise). */
function labelsIn(text: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const s = prose(text);
  for (const l of labelsPut(s)) out.set(l.name, null);
  for (const m of s.matchAll(HEADING_LABEL)) out.set(m[2], m[1].replace(/[*_`$#\\]/g, '').replace(/\s+/g, ' ').trim() || null);
  return out;
}

/** How many numbered top-level headings a text has: the steps it gives the heading counter (an unnumbered heading gives none). */
export function numberedChapters(text: string): number {
  const s = prose(text);
  // Heading numbers turned off before the first heading, as a preface does.
  const first = s.search(/^[ \t]*=[ \t]|#heading\(/m);
  if (/\bset\s+heading\s*\([^)]*\bnumbering\s*:\s*none/.test(first < 0 ? s : s.slice(0, first))) return 0;
  const marks = s.match(/^[ \t]*=[ \t]/gm)?.length ?? 0;
  const calls = [...s.matchAll(/#heading\(([^)]*)\)/g)].filter(([, args]) => !/\blevel\s*:\s*[2-9]/.test(args) && !/\bnumbering\s*:\s*none\b/.test(args)).length;
  return marks + calls;
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * References to what's only in the chapters taken out would stop the preview
 * (Typst errors on a label the document doesn't have): around the chapter, they
 * show in grey (the heading's words, else the label), and such a link keeps
 * its text. Code to put in the block around the chapter's include.
 */
function guard(gone: Map<string, string | null>): string {
  if (!gone.size) return '';
  const dict = `(${[...gone].sort(([a], [b]) => (a < b ? -1 : 1)).map(([l, t]) => `${quote(l)}: ${t == null ? 'none' : quote(t)}`).join(', ')})`;
  return (
    `let gone = ${dict}; ` +
    'show ref: it => if str(it.target) in gone { let t = gone.at(str(it.target)); text(fill: luma(150))[#if t == none { str(it.target) } else { t }] } else { it }; ' +
    'show link: it => if type(it.dest) == label and str(it.dest) in gone { it.body } else { it }; '
  );
}

/** A function the book defines at the top level of the main file or a file it imports: its text, its parameters, and its body. */
type Definition = { text: string; params: string[]; body: { start: number; end: number } };

function definitions(entry: string, read: ReadText, root: string): Map<string, Definition> {
  const out = new Map<string, Definition>();
  for (const file of importTree(entry, read, root)) {
    const text = read(file) ?? '';
    for (const item of scanItems(text, 0, text.length, 'markup')) {
      const head = item.keyword === 'let' && /^#let\s+([\p{L}_][\p{L}\p{N}_-]*)\(/u.exec(text.slice(item.start, item.start + 200));
      if (!head || out.has(head[1])) continue;
      const open = item.start + head[0].length - 1;
      const close = closing(text, open);
      const eq = /^\s*=\s*/.exec(text.slice(close, item.end));
      if (!eq) continue;
      const params = text
        .slice(open + 1, close - 1)
        .split(',')
        .map((p) => p.trim())
        .filter((p) => /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(p));
      out.set(head[1], { text, params, body: { start: close + eq[0].length, end: item.end } });
    }
  }
  return out;
}

/** The items of a function's body: a block's inside, or the one expression. */
function bodyItems({ text, body }: Definition): Item[] {
  const items = scanItems(text, body.start, body.end, 'code');
  const [only] = items;
  return items.length === 1 && only.inner ? scanItems(text, only.inner.start, only.inner.end, only.kind as 'code' | 'markup') : items;
}

// What's only text: whitespace, comments and labels.
const blank = (s: string) => !s.replace(/\/\/.*|\/\*[\s\S]*?\*\/|<[\p{L}_][\p{L}\p{N}_:.-]*>/gu, '').trim();

/**
 * Which of the book's calls make nothing to see: they set counters and state,
 * put metadata, or break the page only if it isn't new (`weak: true`), as a
 * `#start-body()` does; such a call outside the chapter stays, for its
 * counters. Anything else (a page, the contents, a part's title) goes.
 */
function quietCalls(defs: Map<string, Definition>) {
  const known = new Map<string, boolean>();
  const quiet = (text: string, item: Item): boolean => {
    if (item.kind === 'statement') return ['let', 'set', 'show', 'import'].includes(item.keyword!);
    if (item.kind === 'text') return blank(text.slice(item.start, item.end));
    if (item.kind === 'code' || item.kind === 'markup') return scanItems(text, item.inner!.start, item.inner!.end, item.kind).every((i) => quiet(text, i));
    if (item.kind !== 'call') return false;
    const names = item.names!;
    const last = names[names.length - 1];
    if (names.length > 1) return last === 'update' || last === 'step';
    if (names[0] === 'metadata') return true;
    if (names[0] === 'pagebreak') return item.args!.some((a) => /\bweak\s*:\s*true\b/.test(text.slice(a.start, a.end)));
    const def = defs.get(names[0]);
    if (!def) return false;
    if (!known.has(names[0])) {
      known.set(names[0], false);
      known.set(names[0], bodyItems(def).every((i) => quiet(def.text, i)));
    }
    return known.get(names[0])!;
  };
  return quiet;
}

/**
 * Whether a function only puts blank pages and page breaks before (or after)
 * what it's given, as a `#book-chapter(include "…")` that starts each chapter
 * on a right-hand page does. The chapter's call to it goes: blank pages ahead
 * of the chapter would be all the preview opens on.
 */
function blankWrapper(def: Definition): boolean {
  const [param] = def.params;
  const { text } = def;
  const pages = (item: Item, scoped: boolean): boolean => {
    if (item.kind === 'text') return blank(text.slice(item.start, item.end));
    if (item.kind === 'statement') return scoped && (item.keyword === 'set' || item.keyword === 'show');
    if (item.kind === 'code' || item.kind === 'markup') return !holds(item) && scanItems(text, item.inner!.start, item.inner!.end, item.kind).every((i) => pages(i, true));
    if (item.kind !== 'call' || item.names!.length > 1) return false;
    if (item.names![0] === 'pagebreak') return true;
    return item.names![0] === 'page' && item.bodies!.every((b) => blank(text.slice(b.start, b.end))) && item.args!.every((a) => !/[[\]"]/.test(text.slice(a.start, a.end)));
  };
  const given = (item: Item) => item.kind === 'call' && item.names!.length === 1 && item.names![0] === param && !item.args!.length && !item.bodies!.length;
  const holds = (item: Item): boolean => given(item) || (!!item.inner && scanItems(text, item.inner.start, item.inner.end, item.kind as 'code' | 'markup').some(holds));
  const items = bodyItems(def);
  return !!param && items.some(given) && items.every((i) => given(i) || pages(i, false));
}

/** A `set heading(numbering: …)`: whether heading numbers are off after it (`none`, as they were before it). */
function numberingAfter(statement: string, none: boolean): boolean {
  const set = /^#?set\s+heading\s*\(([\s\S]*)\)/.exec(statement);
  if (!set || !/\bnumbering\s*:/.test(set[1])) return none;
  return /\bnumbering\s*:\s*none\b/.test(set[1]);
}

const CITE = /(?:^|[^\\\p{L}\p{N}_])@([\p{L}_][\p{L}\p{N}_:.-]*)|\bcite\s*\(/gu;

/**
 * The main file's text for previewing one chapter (book-relative `chapter`,
 * one of the files `main`, at `entry`, includes). Outside the chapter:
 * - what sets things up stays: imports, `let`, `set` and `show`, and calls
 *   that only set counters or state (`#counter(page).update(1)`, `#start-body()`);
 * - the other chapters go, and in their place the steps they gave the heading
 *   counter, so the chapter keeps its number (and its figures theirs);
 * - everything else goes: text, headings, and calls that make pages (`#outline()`,
 *   `#part("…")`, `#pagebreak()`), the other chapters in them counted;
 * - the bibliography stays if the chapter cites something.
 * The chapter's own call goes if it only puts blank pages around it. Lines
 * stay where they are, so Typst's errors and Tinymist's jumps in this text are
 * at the same lines in the main file.
 */
export function chapterPreviewText(main: string, entry: string, chapter: string, read: ReadText, root = ''): string {
  const includes = scanIncludes(main).flatMap((inc) => {
    const file = resolveRef(entry, inc.spec, root);
    return file ? [{ ...inc, file }] : [];
  });
  const trees = new Map<string, string[]>();
  const tree = (file: string) => trees.get(file) ?? trees.set(file, includeTree(file, read, root)).get(file)!;
  const steps = (inc: (typeof includes)[number]) => (inc.unnumbered ? 0 : tree(inc.file).reduce((n, f) => n + numberedChapters(read(f) ?? ''), 0));

  // Every label in the book, and whether the chapter cites: an @ that's no label, or a cite().
  const labels = labelsIn(main);
  for (const { file } of includes) for (const f of tree(file)) for (const [l, t] of labelsIn(read(f) ?? '')) if (!labels.has(l) || t != null) labels.set(l, t);
  const cites = tree(chapter).some((f) => [...prose(read(f) ?? '').matchAll(CITE)].some((m) => !m[1] || !labels.has(m[1].replace(/[.:]+$/, ''))));
  const bibliographies = new Map<string, boolean>();
  const bibliography = (file: string) =>
    bibliographies.get(file) ?? bibliographies.set(file, tree(file).some((f) => /\bbibliography\s*\(/.test(prose(read(f) ?? '')))).get(file)!;
  const kept = (file: string) => file === chapter || (cites && bibliography(file));

  const defs = definitions(entry, (path) => (path === entry ? main : read(path)), root);
  const quiet = quietCalls(defs);
  const GUARD = '\u0000';
  const edits: { start: number; end: number; text: string }[] = [];
  const lines = (from: number, to: number) => '\n'.repeat(main.slice(from, to).split('\n').length - 1);
  const counted = (n: number, inMarkup: boolean) =>
    n ? `${inMarkup ? '#' : ''}{ for _ in range(${n}) { counter(heading).step(); counter(heading.where(level: 1)).step() } }` : inMarkup ? '' : 'none';
  const chapterIn = (inc: (typeof includes)[number]) => {
    edits.push({ start: inc.start, end: inc.start, text: `{ ${GUARD}` }, { start: inc.end, end: inc.end, text: ' }' });
  };
  // An item that goes: its headings and the chapters in it counted, its lines kept.
  const drop = (item: Item, inMarkup: boolean, none: boolean, inside: typeof includes) => {
    const text = main.slice(item.start, item.end);
    const headings = none ? 0 : numberedChapters(item.names?.[0] === 'heading' && !inMarkup ? `#${text}` : text);
    edits.push({ start: item.start, end: item.end, text: counted(headings + inside.reduce((n, inc) => n + steps(inc), 0), inMarkup) + lines(item.start, item.end) });
  };

  const walk = (from: number, to: number, mode: 'markup' | 'code', none: boolean) => {
    const inMarkup = mode === 'markup';
    for (const item of scanItems(main, from, to, mode)) {
      const inside = includes.filter((inc) => inc.start >= item.start && inc.start < item.end);
      if (item.kind === 'code' || item.kind === 'markup') {
        walk(item.inner!.start, item.inner!.end, item.kind, none);
      } else if (item.kind === 'statement' && ['let', 'set', 'show', 'import'].includes(item.keyword!)) {
        if (item.keyword === 'set') none = numberingAfter(main.slice(item.start, item.end), none);
      } else if (inside.some((inc) => kept(inc.file))) {
        // The chapter's call, unless it only puts blank pages around it; or what holds the chapter or the bibliography.
        const [only] = inside;
        const arg = item.kind === 'call' && item.names!.length === 1 && item.args!.length === 1 && !item.bodies!.length && inside.length === 1 && item.args![0];
        const wrapper = arg && only.file === chapter && /^\(\s*include\s+"[^"\n]*"\s*\)$/.test(main.slice(arg.start, arg.end)) && defs.get(item.names![0]);
        if (wrapper && blankWrapper(wrapper)) {
          const include = main.slice(only.start, only.end);
          edits.push({ start: item.start, end: item.end, text: `${inMarkup ? '#' : ''}{ ${GUARD}${include} }${lines(item.start, item.end)}` });
          continue;
        }
        for (const inc of inside) {
          if (inc.file === chapter) chapterIn(inc);
          else if (!kept(inc.file)) edits.push({ start: inc.start, end: inc.end, text: counted(steps(inc), false) });
        }
      } else if (item.kind === 'call' && (quiet(main, item) || (cites && item.names!.length === 1 && item.names![0] === 'bibliography'))) {
        // Counters and state, or the bibliography the chapter cites.
      } else if (item.kind !== 'text' || !/^\s*$/.test(main.slice(item.start, item.end))) {
        drop(item, inMarkup, none, inside);
      }
    }
  };
  walk(0, main.length, 'markup', false);

  let out = main;
  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  // What the chapter can refer to: labels in what's left of the main file, and in the files still included.
  const here = new Set(labelsIn(out).keys());
  for (const { file } of includes) if (kept(file)) for (const f of tree(file)) for (const l of labelsIn(read(f) ?? '').keys()) here.add(l);
  const gone = new Map([...labels].filter(([l]) => !here.has(l)));
  return `/* Foreword's chapter preview: ${entry} with only ${chapter}. Foreword writes this; changes here are lost. */${out.replace(GUARD, guard(gone))}`;
}
