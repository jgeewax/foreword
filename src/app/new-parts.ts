// The Files pane's +: a new part of the book in a file of its own, where the
// writer is. A chapter goes after the last one (chapters.ts); a section goes
// at the end of the chapter or section the cursor is under, in a new file the
// heading's file #includes there. What each level is called (a book's
// chapters and sections, a paper's sections and subsections), where the new
// file goes and what it starts with. Pure; Studio does the file work.

import { headings, type Heading } from '../editor/outline';
import { escapeMarkup, includePath, nextChapterPath, slugify } from './chapters';
import { scanImports, scanIncludes } from './includes';
import { resolveRef } from './references';

/** A book is in chapters; a paper (an article, a thesis chapter on its own) is in sections. */
export type BookKind = 'book' | 'paper';

/** A heading a new part can go in: the file it's written in, and the heading. */
export type PartPlace = { file: string; heading: Heading };

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const stemOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');

/** The files a file includes (book-relative), each with the 1-based line its include is on. */
export function includeLines(text: string, file: string, root = ''): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  let line = 1;
  let at = 0;
  for (const { spec, start } of scanIncludes(text)) {
    for (; at < start; at++) if (text[at] === '\n') line++;
    const target = resolveRef(file, spec, root);
    if (target) out.push({ file: target, line });
  }
  return out;
}

/**
 * The headings over a place in the book, outermost first, from the headings
 * over it in each file down from the outermost (the chapter's over the
 * #include of a section's file, then the section file's own): a heading at
 * a level the next file's headings take again isn't over it any more.
 */
export function placesOver(chains: readonly PartPlace[][]): PartPlace[] {
  const out: PartPlace[] = [];
  for (const chain of chains)
    for (const p of chain) {
      while (out.length && out[out.length - 1].heading.level >= p.heading.level) out.pop();
      out.push(p);
    }
  return out;
}

/** What a new heading at `level` is called: a book's chapter (=), section (==) and subsection (=== and deeper); a paper's section (=) and subsection. */
export function partName(level: number, kind: BookKind): string {
  const names = kind === 'book' ? ['chapter', 'section'] : ['section'];
  return names[level - 1] ?? 'subsection';
}

/** "Section", for a menu or a dialog's title. */
export const partTitle = (level: number, kind: BookKind) => {
  const name = partName(level, kind);
  return name[0].toUpperCase() + name.slice(1);
};

/** The folder most of these files are in (the last such, on a tie); null for none. */
export function commonFolder(files: readonly string[]): string | null {
  const count = new Map<string, number>();
  for (const f of files) count.set(dirOf(f), (count.get(dirOf(f)) ?? 0) + 1);
  let best: string | null = null;
  for (const [dir, n] of count) if (best === null || n >= count.get(best)!) best = dir;
  return best;
}

/**
 * Whether the book reads as a book or a paper: by the folder the main file's
 * parts are in ("chapters", "sections"), else, when it includes nothing, by
 * whether it writes its own top-level headings, as a paper in one file does.
 */
export function bookKind(mainHeadings: readonly Heading[], included: readonly string[]): BookKind {
  const folder = commonFolder(included)?.split('/').pop() ?? '';
  if (/chapter/i.test(folder)) return 'book';
  if (/section/i.test(folder)) return 'paper';
  if (!included.length && mainHeadings.some((h) => h.level === 1)) return 'paper';
  return 'book';
}

/**
 * The folder top-level parts go in: the one the main file's includes are
 * mostly in, unless that's the main file's own folder; else "chapters" (a
 * book) or "sections" (a paper) beside the main file.
 */
export function topFolder(entry: string | null, included: readonly string[], kind: BookKind): string {
  const home = entry ? dirOf(entry) : '';
  const folder = commonFolder(included);
  if (folder !== null && folder !== home) return folder;
  return join(home, kind === 'book' ? 'chapters' : 'sections');
}

/** `path`, or "-2", "-3"… before its extension until it's not one of `files`. */
function unused(files: readonly string[], path: string): string {
  const taken = new Set(files);
  let out = path;
  for (let i = 2; taken.has(out); i++) out = path.replace(/\.typ$/, `-${i}.typ`);
  return out;
}

const NUMBERED = /^[a-z]*\d+[-_ ]/i;

/**
 * Where a new part's file goes, given the files `from` (the file that will
 * include it) already includes in the same section (sectionIncludes): beside them, named as they are, numbered
 * after them if they're numbered ("chapters/02-methods/03-sampling.typ").
 * With none: in a folder named after `from` ("chapters/02-methods/sampling.typ"),
 * or in "sections" beside the main file.
 */
export function partPath(files: readonly string[], from: string, siblings: readonly string[], title: string, entry: string | null): string {
  const slug = slugify(title, 'section');
  const folder = commonFolder(siblings);
  if (folder !== null) {
    const like = siblings.filter((f) => dirOf(f) === folder);
    const numbered = like.filter((f) => NUMBERED.test(f.slice(f.lastIndexOf('/') + 1)));
    if (numbered.length) return unused(files, nextChapterPath(numbered, title, folder));
    return unused(files, join(folder, `${slug}.typ`));
  }
  const dir = from === entry ? join(dirOf(from), 'sections') : join(dirOf(from), stemOf(from));
  return unused(files, join(dir, `${slug}.typ`));
}

/**
 * A file's top-level #import lines, pointing at the same files from `path`
 * (`#import "../style.typ": *` in chapters/one.typ is `#import "../../style.typ": *`
 * in chapters/one/part.typ). Packages and root paths ("/style.typ") as written.
 * Included files don't see what the file including them imports, so a new
 * part needs its own.
 */
export function importsFor(sampleText: string, samplePath: string, path: string, root = ''): string[] {
  const out: string[] = [];
  for (const { spec, rest } of scanImports(sampleText)) {
    if (spec.startsWith('@') || spec.startsWith('/')) out.push(`#import "${spec}"${rest}`);
    else {
      const target = resolveRef(samplePath, spec, root);
      if (target) out.push(`#import "${includePath(path, target)}"${rest}`);
    }
  }
  return [...new Set(out)];
}

/** A new part's file: its imports, then its heading at `level`. */
export function partText(title: string, level: number, imports: readonly string[]): string {
  return `${imports.length ? `${imports.join('\n')}\n\n` : ''}${'='.repeat(level)} ${escapeMarkup(title)}\n\n`;
}

const isInclude = (line: string | undefined) => !!line && /^\s*#include\s+"/.test(line);

/**
 * Where an #include at the end of a section goes (a 0-based line index): after
 * its last line that isn't blank, before the next heading at its level or
 * above, or before the bibliography when it runs to the end of the file.
 */
export function sectionEnd(lines: readonly string[], all: readonly Heading[], heading: Heading): number {
  const next = all.find((h) => h.line > heading.line && h.level <= heading.level);
  let end = next ? next.line - 1 : lines.length;
  if (!next) {
    const bib = lines.findIndex((l, i) => i >= heading.line && /^\s*#bibliography\(/.test(l));
    if (bib >= 0) end = bib;
  }
  while (end > heading.line && !lines[end - 1].trim()) end--;
  return end;
}

/**
 * The text with `line` put in before line `at` (0-based), a blank line either
 * side unless what's there is blank or another #include (a list of includes
 * stays a list). Also the 0-based line it's on.
 */
export function insertLine(text: string, at: number, line: string): { text: string; line: number } {
  const lines = text.split('\n');
  const before = lines[at - 1];
  const after = lines[at];
  const space = (l: string | undefined) => l !== undefined && !!l.trim() && !isInclude(l);
  const add = [...(space(before) ? [''] : []), line, ...(space(after) ? [''] : [])];
  lines.splice(at, 0, ...add);
  return { text: lines.join('\n'), line: at + (space(before) ? 1 : 0) };
}

/** The files included inside a heading's section (book-relative, in order); the whole file's for none. */
export function sectionIncludes(text: string, file: string, heading: Heading | null, root = ''): string[] {
  const lines = text.split('\n');
  const end = heading ? sectionEnd(lines, headings(lines, 'typst'), heading) : lines.length;
  return includeLines(text, file, root)
    .filter((x) => !heading || (x.line > heading.line && x.line <= end))
    .map((x) => x.file);
}

/**
 * The heading a passage starting on `line` (1-based) is in, for moving it to
 * a file: the last one above it at a level above `level` (the passage's own
 * first heading's), or the last one above it when the passage has none.
 */
export function headingOver(all: readonly Heading[], line: number, level: number | null): Heading | null {
  let at: Heading | null = null;
  for (const h of all) if (h.line < line && (level == null || h.level < level)) at = h;
  return at;
}

/** The selection's whole lines (1-based, inclusive): a selection ending at a line's very start leaves that line out. */
export function wholeLines(start: { lineNumber: number }, end: { lineNumber: number; column: number }): { from: number; to: number } {
  const to = end.column === 1 && end.lineNumber > start.lineNumber ? end.lineNumber - 1 : end.lineNumber;
  return { from: start.lineNumber, to };
}

/** What takes a moved passage's place: the #include, with the blank lines the passage started and ended with, so it stays a paragraph of its own. */
export function includeInPlace(passage: string, include: string): string {
  const lines = passage.split('\n');
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;
  let end = lines.length;
  while (end > start && !lines[end - 1].trim()) end--;
  return [...lines.slice(0, start), include, ...lines.slice(end)].join('\n');
}

/** A moved passage's new file: the imports it needs, then the passage. */
export function movedText(passage: string, imports: readonly string[]): string {
  const body = passage.replace(/^\s*\n/, '').replace(/\s+$/, '');
  const own = new Set(passage.split('\n').map((l) => l.trim()));
  const needed = imports.filter((l) => !own.has(l.trim()));
  return `${needed.length ? `${needed.join('\n')}\n\n` : ''}${body}\n`;
}
