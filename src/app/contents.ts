// The Contents view: the book's chapters in reading order, their sections,
// and about how many words each has. Pure functions; Studio keeps each
// file's headings and words up to date.

import { headings, type Heading } from '../editor/outline';

export type FileContents = { headings: Heading[]; words: number };

/**
 * About how many words of prose a Typst file has: not its comments, code
 * lines (#set, #import, #let…), maths, labels, references or markup.
 */
export function countWords(text: string): number {
  const prose = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/^\s*#(set|show|import|include|let|bibliography|outline|pagebreak|v|h)\b.*$/gm, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/<[\w:.-]+>/g, ' ')
    .replace(/@[\w:.-]+/g, ' ');
  return (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** A Typst file's headings and words. */
export function fileContents(text: string): FileContents {
  return { headings: headings(text.split('\n'), 'typst'), words: countWords(text) };
}

/** The heading the cursor is under (the last at or above its line), if any. */
export function headingAt(list: Heading[], line: number): Heading | null {
  let at: Heading | null = null;
  for (const h of list) if (h.line <= line) at = h;
  return at;
}

/** What a fold hides: the main file's second-level headings, or a chapter's sections under its title. */
export function sections(c: FileContents, main: boolean): Heading[] {
  return main ? c.headings.filter((h) => h.level === 2) : c.headings.slice(1).filter((h) => h.level <= 2);
}

/** The headings a file has rows for: the main file's own (its sections only when open), or a chapter's title and its sections. */
export function listedHeadings(c: FileContents, main: boolean, open: boolean): Heading[] {
  if (main) return c.headings.filter((h) => h.level === 1 || (h.level === 2 && open));
  return [...c.headings.slice(0, 1), ...(open ? sections(c, false) : [])];
}

/** "2,140 words", "1 word": rounded, since it's only about. */
export function wordsLabel(n: number): string {
  if (n === 1) return '1 word';
  const rounded = n >= 1000 ? Math.round(n / 10) * 10 : n;
  return `${rounded.toLocaleString('en-US')} words`;
}
