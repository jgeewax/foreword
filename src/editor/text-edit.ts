import { diff, type Run } from '../lib/diff';

/** Smallest single edit turning `a` into `b` (keeps cursor/scroll stable on reload). */
export function minimalEdit(a: string, b: string): { start: number; end: number; text: string } | null {
  if (a === b) return null;
  let prefix = 0;
  const max = Math.min(a.length, b.length);
  while (prefix < max && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)) suffix++;
  return { start: prefix, end: a.length - suffix, text: b.slice(prefix, b.length - suffix) };
}

export type OffsetEdit = { start: number; end: number; text: string };

/** Lines with their line breaks, so joining them gives back the text exactly. */
const linesWithBreaks = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const starts = (parts: readonly string[]) => {
  const out = [0];
  for (const p of parts) out.push(out[out.length - 1] + p.length);
  return out;
};

/** Runs of changes between equal runs: [a0, a1) in `before` became [b0, b1) in `after`. */
function* hunks(runs: Run[], lenA: number, lenB: number) {
  for (let i = 0; i < runs.length; ) {
    if (runs[i].type === 'equal') {
      i++;
      continue;
    }
    const { a: a0, b: b0 } = runs[i];
    while (i < runs.length && runs[i].type !== 'equal') i++;
    yield { a0, b0, a1: runs[i]?.a ?? lenA, b1: runs[i]?.b ?? lenB };
  }
}

const isLow = (s: string, i: number) => i > 0 && i < s.length && (s.charCodeAt(i) & 0xfc00) === 0xdc00;

/**
 * Past this many changed lines (a whole long file reformatted at once) the diff
 * stops looking for the smallest edits: its memory grows with the square.
 */
const MAX_LINE_EDITS = 2000;
const MAX_CHAR_EDITS = 500;

/** The changes within one line, character by character (never splitting a surrogate pair). */
function lineEdits(x: string, y: string, base: number, out: OffsetEdit[]) {
  for (let { a0, a1, b0, b1 } of hunks(diff(x.split(''), y.split(''), Object.is, MAX_CHAR_EDITS), x.length, y.length)) {
    // Either side of a hunk is unchanged text, so both sides widen together.
    if (isLow(x, a0)) {
      a0--;
      b0--;
    }
    if (isLow(x, a1)) {
      a1++;
      b1++;
    }
    out.push({ start: base + a0, end: base + a1, text: y.slice(b0, b1) });
  }
}

/**
 * Small edits turning `before` into `after`, in order and not overlapping (as
 * VS Code reduces a formatter's edits): a whole-file replacement would move
 * the cursor and scroll position; these leave both where the text didn't change.
 * Changed lines that pair up are compared character by character.
 */
export function smallEdits(before: string, after: string): OffsetEdit[] {
  if (before === after) return [];
  const A = linesWithBreaks(before);
  const B = linesWithBreaks(after);
  const offA = starts(A);
  const offB = starts(B);
  const out: OffsetEdit[] = [];
  for (const { a0, a1, b0, b1 } of hunks(diff(A, B, Object.is, MAX_LINE_EDITS), A.length, B.length)) {
    if (a1 - a0 === b1 - b0) {
      for (let k = 0; k < a1 - a0; k++) lineEdits(A[a0 + k], B[b0 + k], offA[a0 + k], out);
      continue;
    }
    const e = minimalEdit(before.slice(offA[a0], offA[a1]), after.slice(offB[b0], offB[b1]));
    if (e) out.push({ start: offA[a0] + e.start, end: offA[a0] + e.end, text: e.text });
  }
  return out;
}
