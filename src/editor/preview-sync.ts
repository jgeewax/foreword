// Source → preview sync helpers.
//
// Tinymist's `scrollPreview`/`panelScrollTo` only jumps when a position maps to
// rendered content, and failures are silent. Measured: column 0 never maps;
// positions inside words of running text almost always do; code (`#figure(…)`),
// labels and some math don't. Rendered text can also appear twice (a heading in
// the table of contents and in the body), and the preview then picks the copy
// nearest the page currently shown.
//
// The caller tries candidates one at a time, best first, and stops at the first
// one the preview actually jumps to (the preview webview reports jumps).

export type Pos = { line: number; character: number };

const WORD = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;
const LINES_AROUND = 3;
const WORDS_PER_LINE = 4;

const isBlank = (t: string | null) => !t || !t.trim();
const isHeading = (t: string) => /^\s*=+\s/.test(t);

/** Positions just inside up to `max` words, spread across the line (never column 0). */
function wordPositions(text: string, max: number): number[] {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (LETTER.test(text[i]) && (i === 0 || !WORD.test(text[i - 1]))) starts.push(i + 1);
  }
  if (starts.length <= max) return starts;
  if (max === 1) return [starts[0]];
  const step = (starts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, k) => starts[Math.round(k * step)]);
}

const byDistance = (positions: number[], column: number) =>
  [...positions].sort((a, b) => Math.abs(a - column) - Math.abs(b - column));

/**
 * Candidate positions (0-based) for jumping the preview to `line`/`character`,
 * best first. `lineAt(n)` returns line n's text, or null outside the file.
 *
 * 1. The cursor's own line (cursor first, then other words by distance) —
 *    unless it's a heading, whose words may also match the table of contents;
 *    then the first content line below the heading.
 * 2. The nearest non-heading text lines above (end of line first).
 * 3. If nothing above (top of file / blank start), the next content line below.
 */
export function jumpCandidates(lineAt: (n: number) => string | null, line: number, character: number): Pos[] {
  const out: Pos[] = [];
  const push = (l: number, cols: number[]) => cols.forEach((c) => out.push({ line: l, character: c }));
  const nextContent = () => {
    for (let l = line + 1; l <= line + 1 + LINES_AROUND; l++) {
      const t = lineAt(l);
      if (t === null) return;
      if (isBlank(t) || isHeading(t)) continue;
      push(l, wordPositions(t, 2));
      return;
    }
  };

  const text = lineAt(line);
  if (text !== null && !isBlank(text)) {
    if (isHeading(text)) {
      nextContent();
    } else {
      const cursor = Math.max(1, Math.min(character, text.length));
      push(line, byDistance([...new Set([cursor, ...wordPositions(text, WORDS_PER_LINE)])], cursor));
    }
  }

  let above = 0;
  for (let l = line - 1; l >= 0 && above < LINES_AROUND; l--) {
    const t = lineAt(l);
    if (t === null) break;
    if (isBlank(t) || isHeading(t)) continue;
    push(l, byDistance(wordPositions(t, WORDS_PER_LINE), t.length));
    above++;
  }

  if (out.length === 0) nextContent();

  // Drop duplicates, keeping the first (best) occurrence.
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${p.line}:${p.character}`;
    return !seen.has(k) && (seen.add(k), true);
  });
}
