// Formatting rules of our own, applied after typstyle (which leaves these alone):
// blank lines around headings, and no more than one blank line in a row.
import type { LspRange, LspSymbol } from './lsp-convert';

/** LSP SymbolKind.Namespace: what Tinymist reports headings as. */
const HEADING = 3;

const LABEL = /^<[^<>\s]+>$/;
const blank = (line: string | undefined) => line !== undefined && !line.trim();
const comment = (line: string) => /^\s*\/\//.test(line);
/** A line that opens a block, call or code: what follows is its first line. */
const opens = (line: string) => /[[({]\s*$/.test(line);

/** Each heading's text (0-based, without its `=` marks), in order, from Tinymist's outline of the document. */
export function headingRanges(symbols: readonly LspSymbol[]): LspRange[] {
  const out: LspRange[] = [];
  const walk = (list: readonly LspSymbol[]) => {
    for (const s of list) {
      const range = s.range ?? s.location?.range;
      if (s.kind === HEADING && range) out.push(range);
      if (s.children) walk(s.children);
    }
  };
  walk(symbols);
  return out.sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character);
}

/**
 * A blank line above and below each heading, as Markdown's style rules want
 * (Typst renders it the same either way).
 * - Above: not at the top of the file or of a block. `//` comments right above
 *   a heading stay with it; the blank line goes above them.
 * - Below: a label on the next line stays with the heading; the blank line goes
 *   after the label. Not at the end of the file or of a block.
 * A heading that doesn't have its line to itself (`#block[= Title] text`) is left alone.
 */
export function blankLinesAroundHeadings(text: string, headings: readonly LspRange[]): string {
  const lines = text.split('\n');
  // Lines to put a blank line after.
  const after = new Set<number>();
  for (const { start, end } of headings) {
    if (/^\s*=+\s*$/.test(lines[start.line]?.slice(0, start.character) ?? '')) {
      let above = start.line - 1;
      while (above >= 0 && comment(lines[above])) above--;
      if (above >= 0 && !blank(lines[above]) && !opens(lines[above])) after.add(above);
    }
    let last = end.line;
    const rest = (lines[last] ?? '').slice(end.character).trim();
    if (rest && !LABEL.test(rest)) continue;
    if (LABEL.test(lines[last + 1]?.trim() ?? '')) last++;
    const next = lines[last + 1];
    if (next === undefined || blank(next) || /^\s*[\])}]/.test(next)) continue;
    after.add(last);
  }
  if (!after.size) return text;
  // The new line ends the way the line before it does (\r\n files stay \r\n).
  return lines.flatMap((l, i) => (after.has(i) ? [l, l.endsWith('\r') ? '\r' : ''] : [l])).join('\n');
}

/**
 * Where a line break is part of raw text or a block comment, which are kept as
 * written: `[from, to)` spans, by index. Escaped backticks and backticks in
 * `//` comments don't start raw text.
 */
function keptSpans(s: string): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < s.length; ) {
    const [c, d] = [s[i], s[i + 1]];
    if (c === '\\') i += 2;
    // In markup, the // of a link (https://…) isn't a comment.
    else if (c === '/' && d === '/' && s[i - 1] !== ':') i = s.indexOf('\n', i) < 0 ? s.length : s.indexOf('\n', i);
    else if (c === '/' && d === '*') {
      // Block comments nest.
      let depth = 0;
      let j = i;
      do {
        if (s.startsWith('/*', j)) (depth++, (j += 2));
        else if (s.startsWith('*/', j)) (depth--, (j += 2));
        else j++;
      } while (depth > 0 && j < s.length);
      spans.push([i, j]);
      i = j;
    } else if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      if (n === 2) {
        i += 2;
        continue;
      }
      const close = s.indexOf('`'.repeat(n), i + n);
      const end = close < 0 ? s.length : close + n;
      spans.push([i, end]);
      i = end;
    } else i++;
  }
  return spans;
}

/**
 * One blank line at most between things, as typstyle keeps code but not
 * markup (Typst renders any number of blank lines as one paragraph break),
 * and none at the start or end of the file. Raw text and block comments are
 * kept as written.
 */
export function singleBlankLines(text: string): string {
  const lines = text.split('\n');
  const endsWithBreak = lines.length > 1 && lines[lines.length - 1] === '';
  if (endsWithBreak) lines.pop();
  const spans = keptSpans(text);
  // Whether line i starts inside raw text or a comment (the break before it is part of one).
  let at = 0;
  let k = 0;
  const kept = lines.map((l) => {
    const breakBefore = at - 1;
    at += l.length + 1;
    while (k < spans.length && spans[k][1] <= breakBefore) k++;
    return breakBefore >= 0 && k < spans.length && spans[k][0] <= breakBefore;
  });
  const blankAt = (i: number) => !kept[i] && blank(lines[i]);
  let last = lines.length - 1;
  while (last >= 0 && blankAt(last)) last--;
  const out: string[] = [];
  for (let i = 0; i <= last; i++) {
    if (blankAt(i) && (out.length === 0 || blankAt(i - 1))) continue;
    out.push(lines[i]);
  }
  const joined = out.join('\n');
  return endsWithBreak && out.length ? `${joined}\n` : joined;
}
