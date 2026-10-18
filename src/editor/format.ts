// Formatting rules of our own, applied after typstyle (which leaves these alone).
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
