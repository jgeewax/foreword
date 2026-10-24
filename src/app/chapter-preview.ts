// The chapter preview (Settings ▸ General ▸ Preview, previewScope "chapter"):
// the book's main file with every include but one chapter's taken out, so a
// change typesets that chapter and not the whole book. Everything else in the
// main file stays as written (its setup, show rules, counters, parts, the
// contents), so the chapter looks as it does in the book. Pure; studio.ts
// sends the text to Tinymist as the preview's main file.
import { scanIncludes } from './includes';
import { labelsPut, prose } from './labels';
import { resolveRef } from './references';

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

// A line that's only a call wrapping one include, as `#book-chapter(include "…")`.
const WRAPPED = /^([ \t]*)#[\p{L}_][\p{L}\p{N}_.-]*\(\s*include\s+"[^"\n]+"\s*\)[ \t]*(\/\/.*)?$/u;

/**
 * The main file's text for previewing one chapter (book-relative `chapter`,
 * one of the files `main`, at `entry`, includes). Every other include is
 * taken out:
 * - in its place, the steps it gave the heading counter, so the chapter keeps
 *   its number (and its figures theirs);
 * - a line that only wraps it in a call (`#book-chapter(include "…")`) goes
 *   whole, with the pages that call makes (a blank verso, say);
 * - one with a bibliography stays, for the chapter's citations.
 * Lines stay where they are, so Typst's errors and Tinymist's jumps in this
 * text are at the same lines in the main file.
 */
export function chapterPreviewText(main: string, entry: string, chapter: string, read: ReadText, root = ''): string {
  const includes = scanIncludes(main).map((inc) => ({ ...inc, file: resolveRef(entry, inc.spec, root) }));
  const trees = new Map<string, string[]>();
  const tree = (file: string) => trees.get(file) ?? trees.set(file, includeTree(file, read, root)).get(file)!;
  const cites = (file: string) => tree(file).some((f) => /\bbibliography\s*\(/.test(prose(read(f) ?? '')));
  const kept = (file: string) => file === chapter || cites(file);

  const here = new Set(labelsIn(main).keys());
  const gone = new Map<string, string | null>();
  for (const { file } of includes) {
    if (!file) continue;
    for (const f of tree(file)) {
      const labels = labelsIn(read(f) ?? '');
      if (kept(file)) for (const l of labels.keys()) here.add(l);
      else for (const [l, t] of labels) if (!gone.has(l) || t != null) gone.set(l, t);
    }
  }
  for (const l of here) gone.delete(l);

  let out = main;
  for (const inc of [...includes].reverse()) {
    if (!inc.file || (inc.file !== chapter && kept(inc.file))) continue;
    if (inc.file === chapter) {
      out = `${out.slice(0, inc.start)}{ ${guard(gone)}${out.slice(inc.start, inc.end)} }${out.slice(inc.end)}`;
      continue;
    }
    const steps = inc.unnumbered ? 0 : tree(inc.file).reduce((n, f) => n + numberedChapters(read(f) ?? ''), 0);
    const stand = steps ? `{ for _ in range(${steps}) { counter(heading).step(); counter(heading.where(level: 1)).step() } }` : 'none';
    const lineStart = out.lastIndexOf('\n', inc.start - 1) + 1;
    const lineEnd = out.indexOf('\n', inc.end) < 0 ? out.length : out.indexOf('\n', inc.end);
    const wrapped = inc.code && WRAPPED.exec(out.slice(lineStart, lineEnd));
    out = wrapped
      ? `${out.slice(0, lineStart)}${wrapped[1]}${steps ? `#${stand}` : ''}${out.slice(lineEnd)}`
      : `${out.slice(0, inc.start)}${stand}${out.slice(inc.end)}`;
  }
  return `/* Foreword's chapter preview: ${entry} with only ${chapter}. Foreword writes this; changes here are lost. */${out}`;
}
