import { describe, expect, it } from 'vitest';
import { inBook } from './paths';

describe('a path in the book', () => {
  it('is its place in the book', () => {
    expect(inBook('/Users/a/book/chapters/one.typ', '/Users/a/book')).toBe('chapters/one.typ');
    expect(inBook('/Users/a/book/chapters', '/Users/a/book/')).toBe('chapters');
    expect(inBook('/Users/a/book', '/Users/a/book')).toBe('');
  });

  it('is null outside it, or with no book', () => {
    expect(inBook('/Users/a/book-2/one.typ', '/Users/a/book')).toBeNull();
    expect(inBook('/Users/a/other.typ', '/Users/a/book')).toBeNull();
    expect(inBook('/Users/a/book/one.typ', null)).toBeNull();
  });
});
