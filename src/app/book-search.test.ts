import { describe, expect, it } from 'vitest';
import { replaceText, searchPattern, searchText, type SearchOptions } from './book-search';

const plain: SearchOptions = { matchCase: false, wholeWord: false, regex: false };
const re = (q: string, o: Partial<SearchOptions> = {}) => searchPattern(q, { ...plain, ...o }) as RegExp;

describe('searching the book', () => {
  const text = '= The Storm\n\nThe storm came in from the sea.\nStormy weather; a storm-cloud.\nC++ and $x^2$.';

  it('finds words in any case, or matching case, or whole words', () => {
    expect(searchText(text, re('storm')).map((m) => `${m.line}:${m.column}`)).toEqual(['1:7', '3:5', '4:1', '4:19']);
    expect(searchText(text, re('Storm', { matchCase: true })).map((m) => m.line)).toEqual([1, 4]);
    expect(searchText(text, re('storm', { wholeWord: true })).map((m) => `${m.line}:${m.column}`)).toEqual(['1:7', '3:5', '4:19']);
  });

  it('takes the query as text unless it’s a pattern', () => {
    expect(searchText(text, re('C++')).map((m) => m.match)).toEqual(['C++']);
    expect(searchText(text, re('\\$x\\^2\\$', { regex: true })).map((m) => m.match)).toEqual(['$x^2$']);
    expect(searchPattern('(', { ...plain, regex: true })).toMatchObject({ error: expect.stringMatching(/^Not a pattern/) });
    expect(searchPattern('x*', { ...plain, regex: true })).toEqual({ error: 'That pattern matches empty text.' });
    expect(searchPattern('', plain)).toBeNull();
  });

  it('shows each match in its line, shortened before it', () => {
    const [m] = searchText('    A long line of text that goes on for a while before the word lighthouse and after it.', re('lighthouse'));
    expect(m).toMatchObject({ match: 'lighthouse', after: ' and after it.' });
    expect(m.before.startsWith('…')).toBe(true);
    expect(m.before.length).toBeLessThanOrEqual(15);
    expect(searchText('a\nb', re('a'))[0].before).toBe('');
  });

  it('stops at a limit', () => {
    expect(searchText('a a a a a', re('a'), 3)).toHaveLength(3);
  });

  it('replaces every match, with $1 for a pattern’s groups', () => {
    expect(replaceText(text, re('storm'), 'gale', plain)).toEqual({ text: '= The gale\n\nThe gale came in from the sea.\ngaley weather; a gale-cloud.\nC++ and $x^2$.', count: 4 });
    expect(replaceText('Dr. Jekyll and Mr. Hyde', re('(Dr|Mr)\\. (\\w+)', { regex: true }), '$2 ($1.)', { ...plain, regex: true }).text).toBe('Jekyll (Dr.) and Hyde (Mr.)');
    expect(replaceText('cost $5', re('cost'), 'price $1', plain).text).toBe('price $1 $5');
  });
});
