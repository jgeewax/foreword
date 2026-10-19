import { describe, expect, it } from 'vitest';
import { jumpCandidates, jumpScrollTop } from './preview-sync';

const doc = [
  '= Eigenvalues <ch-eigen>', // 0
  '', // 1
  'Let $A$ be an $n times n$ matrix.', // 2
  '', // 3
  '#figure(image("span.svg"), caption: [Two vectors.]) <fig-span>', // 4
  '', // 5
  'The roots of its characteristic polynomial', // 6
];
const lineAt = (n: number) => (n >= 0 && n < doc.length ? doc[n] : null);
const at = (line: number, character: number) => jumpCandidates(lineAt, line, character);

describe('jumpCandidates (best first)', () => {
  it('tries the cursor first, never column 0', () => {
    expect(at(6, 20)[0]).toEqual({ line: 6, character: 20 });
    expect(at(6, 0)[0]).toEqual({ line: 6, character: 1 });
    expect(at(6, 0).every((p) => p.character >= 1)).toBe(true);
  });

  it('then other words on the line by distance, then the text lines above (nearest first)', () => {
    const lines = at(6, 20).map((p) => p.line);
    expect(lines.lastIndexOf(6)).toBeLessThan(lines.indexOf(4));
    expect(lines.lastIndexOf(4)).toBeLessThan(lines.indexOf(2));
  });

  it('includes words spread across a code line (a #figure caption renders, its code does not)', () => {
    const cols = at(4, doc[4].length).filter((p) => p.line === 4).map((p) => p.character);
    expect(cols.length).toBeGreaterThan(2);
    expect(Math.max(...cols)).toBeGreaterThan(doc[4].indexOf('caption'));
  });

  it('on a heading, starts with the content below it and never uses heading words', () => {
    const c = at(0, 4);
    expect(c[0]).toEqual({ line: 2, character: 1 });
    expect(c.some((p) => p.line === 0)).toBe(false);
  });

  it('skips headings among the fallback lines above', () => {
    expect(at(2, 5).some((p) => p.line === 0)).toBe(false);
  });

  it('on a blank line uses the text above; at the top of a file, the text below', () => {
    expect(at(5, 0)[0].line).toBe(4);
    const top = ['', '', 'First words here'];
    expect(jumpCandidates((n) => (n >= 0 && n < top.length ? top[n] : null), 0, 0)[0]).toEqual({ line: 2, character: 1 });
  });

  it('handles empty documents and clamps past the end of the line', () => {
    expect(jumpCandidates(() => null, 0, 0)).toEqual([]);
    expect(at(6, 999)[0]).toEqual({ line: 6, character: doc[6].length });
  });
});

describe('jumpScrollTop: preview → source puts the text near the top', () => {
  it('scrolls text below the view to 15% down, not to the middle', () => {
    // A 1000 px editor at the top; the text is at 3000–3018 px.
    expect(jumpScrollTop(3000, 3018, 0, 1000)).toBe(2850);
  });
  it('and text above the view too', () => {
    expect(jumpScrollTop(200, 218, 2000, 1000)).toBe(50);
  });
  it('never above the start', () => {
    expect(jumpScrollTop(40, 58, 2000, 1000)).toBe(0);
  });
  it('leaves text that’s in view alone, unless it’s down in the last 15%', () => {
    expect(jumpScrollTop(1400, 1418, 1000, 1000)).toBeNull();
    expect(jumpScrollTop(1900, 1918, 1000, 1000)).toBe(1750);
    // Starting above the view (cut off at the top): scrolled.
    expect(jumpScrollTop(990, 1100, 1000, 1000)).toBe(840);
  });
});
