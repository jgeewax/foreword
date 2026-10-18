import { describe, expect, it } from 'vitest';
import { hasWords, searchWords, wordSpans } from './word-search';

describe('word search', () => {
  it('splits a query into lower-case words', () => {
    expect(searchWords('  Font  FOLDERS ')).toEqual(['font', 'folders']);
    expect(searchWords('   ')).toEqual([]);
  });

  it('needs every word, in any order, ignoring case', () => {
    expect(hasWords('Extra font folders', ['folders', 'font'])).toBe(true);
    expect(hasWords('Extra font folders', ['font', 'size'])).toBe(false);
    expect(hasWords('Send a message with Enter', ['ent'])).toBe(true);
    expect(hasWords('anything', [])).toBe(true);
  });

  it('finds each occurrence, merging overlaps', () => {
    expect(wordSpans('Font folders: fonts', ['font'])).toEqual([
      [0, 4],
      [14, 18],
    ]);
    expect(wordSpans('PDF output folder', ['out', 'output'])).toEqual([[4, 10]]);
    expect(wordSpans('abc', ['bc', 'ab'])).toEqual([[0, 3]]);
    expect(wordSpans('abc', ['x'])).toEqual([]);
  });
});
