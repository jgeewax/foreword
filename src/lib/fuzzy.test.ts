import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from './fuzzy';

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
