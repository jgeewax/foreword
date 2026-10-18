import { describe, expect, it } from 'vitest';
import { fuzzyMatch, wordMatch } from './fuzzy';

const rank = (query: string, items: string[]) =>
  items
    .map((t) => ({ t, m: fuzzyMatch(query, t) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .map((x) => x.t);

describe('fuzzy matching', () => {
  it('matches characters in order, and nothing else', () => {
    expect(fuzzyMatch('ch2', 'chapters/ch2-eigenvalues.typ')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'main.typ')).toBeNull();
    expect(fuzzyMatch('', 'main.typ')).toEqual({ score: 0, positions: [] });
  });

  it('ranks word starts, runs and file names first', () => {
    const files = ['chapters/ch1-vectors.typ', 'chapters/ch2-eigenvalues.typ', 'main.typ', 'figures/eigen-plot.typ', 'refs.bib', 'style.typ'];
    expect(rank('eig', files).slice(0, 2)).toEqual(['figures/eigen-plot.typ', 'chapters/ch2-eigenvalues.typ']);
    expect(rank('main', files)[0]).toBe('main.typ');
    expect(rank('ch1', files)[0]).toBe('chapters/ch1-vectors.typ');
    expect(rank('sty', files)[0]).toBe('style.typ');
  });

  it('treats spaces, slashes, dashes and dots as word breaks (not letters)', () => {
    // "s" isn't a word break: no word-start bonus in the middle of "chapters".
    expect(fuzzyMatch('t', 'chapters')!.score).toBeLessThan(fuzzyMatch('t', 'the')!.score);
    expect(fuzzyMatch('k', 'lighthouse keeper')!.positions).toEqual([11]);
  });

  it('works on chapter titles too', () => {
    expect(rank('storm', ['The Lighthouse Keeper', 'The Storm', 'Stories of the Moor'])[0]).toBe('The Storm');
  });
});

describe('word matching (commands)', () => {
  const at = (query: string, text: string) => wordMatch(query, text)?.positions.map((p) => text[p]).join('') ?? null;

  it('takes the starts of words, in order', () => {
    expect(at('show conv', 'View: Show Conversations')).toBe('ShowConv');
    expect(at('exppdf', 'Book: Export PDF…')).toBe('ExpPDF');
    expect(at('file save', 'File: Save')).toBe('FileSave');
    expect(at('v', 'View: Zoom In')).toBe('V');
  });

  it('takes the query whole, anywhere', () => {
    expect(at('port', 'Book: Export PDF…')).toBe('port');
  });

  it("doesn't take letters scattered through words", () => {
    expect(wordMatch('save', 'Preview: Restart Preview')).toBeNull();
    expect(wordMatch('git', 'Edit: Trim Trailing Whitespace')).toBeNull();
    expect(wordMatch('xp', 'Book: Export PDF…')).not.toBeNull(); // whole, in "Export"
    expect(wordMatch('xpdf', 'Book: Export PDF…')).toBeNull();
  });

  it('backtracks when the first way fails', () => {
    // Not the "S" of "Stop" (no word after it starts with "a"), but that of "Sa".
    expect(wordMatch('sab', 'Stop Sa Bar')!.positions).toEqual([5, 6, 8]);
  });

  it('ranks word starts and whole words higher, and shorter texts', () => {
    expect(wordMatch('save', 'File: Save')!.score).toBeGreaterThan(wordMatch('save', 'File: Close Saved Tabs')!.score);
    expect(wordMatch('zoom', 'View: Zoom In')!.score).toBeGreaterThan(wordMatch('zi', 'View: Zoom In')!.score);
  });
});
