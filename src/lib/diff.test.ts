import { describe, expect, it } from 'vitest';
import { diff, followLine, mapLines, splitLines, type Run } from './diff';

/** Longest common subsequence length, the slow way. */
function lcs(a: string[], b: string[]) {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  return t[0][0];
}

/** The runs must walk both sequences in order and only call equal things equal. */
function check(a: string[], b: string[], runs: Run[]) {
  let i = 0;
  let j = 0;
  let same = 0;
  for (const r of runs) {
    expect([r.a, r.b]).toEqual([i, j]);
    if (r.type === 'equal') {
      for (let k = 0; k < r.n; k++) expect(a[i + k]).toBe(b[j + k]);
      i += r.n;
      j += r.n;
      same += r.n;
    } else if (r.type === 'delete') i += r.n;
    else j += r.n;
  }
  expect([i, j]).toEqual([a.length, b.length]);
  return same;
}

describe('diff', () => {
  it('finds a shortest edit script', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let t = 0; t < 400; t++) {
      const a = Array.from({ length: rand(14) }, () => 'abcd'[rand(4)]);
      const b = Array.from({ length: rand(14) }, () => 'abcd'[rand(4)]);
      expect(check(a, b, diff(a, b)), `${a.join('')} → ${b.join('')}`).toBe(lcs(a, b));
    }
  });

  it('gives up on the shortest script past maxEdits, still walking both sides correctly', () => {
    let seed = 11;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: rand(14) }, () => 'abcd'[rand(4)]);
      const b = Array.from({ length: rand(14) }, () => 'abcd'[rand(4)]);
      check(a, b, diff(a, b, Object.is, rand(4)));
    }
    // Unchanged ends stay matched; the middle becomes one delete and one insert.
    expect(diff([...'xabcy'], [...'xbcay'], Object.is, 1).map((r) => r.type)).toEqual(['equal', 'delete', 'insert', 'equal']);
  });

  it('handles empty sides and identical input', () => {
    expect(diff([], ['x'])).toEqual([{ type: 'insert', a: 0, b: 0, n: 1 }]);
    expect(diff(['x', 'y'], [])).toEqual([{ type: 'delete', a: 0, b: 0, n: 2 }]);
    expect(diff(['x'], ['x'])).toEqual([{ type: 'equal', a: 0, b: 0, n: 1 }]);
    expect(diff([], [])).toEqual([]);
  });

  it('maps unchanged lines onto the new text', () => {
    const before = splitLines('a\nb\nc\nd\n');
    const after = splitLines('new\na\nb\nC!\nd');
    expect([...mapLines(before, after)]).toEqual([1, 2, -1, 4]);
  });

  it('follows any line onto the new text, changed ones to what replaced them', () => {
    const before = splitLines('a\nb\nc\nd\ne\nf');
    const after = splitLines('new\na\nB\nC\nC2\nC3\nd\nf');
    // a, b→B, c→C, d, e (deleted: the line before it, d), f
    expect([0, 1, 2, 3, 4, 5].map((n) => followLine(before, after, n))).toEqual([1, 2, 3, 6, 6, 7]);
    // A replacement shorter than what it replaced: the extra lines go to its last line.
    expect([0, 1, 2, 3].map((n) => followLine(splitLines('x\ny\nz\nw'), splitLines('x\nY\nw'), n))).toEqual([0, 1, 1, 2]);
    // Changes at either end, and past the last line.
    expect(followLine(['a', 'b'], ['A', 'b'], 0)).toBe(0);
    expect(followLine(['a', 'b'], ['a', 'B', 'C'], 1)).toBe(1);
    expect(followLine(['a', 'b'], ['a'], 1)).toBe(0);
    expect(followLine(['a'], ['b'], 5)).toBe(0);
    expect(followLine(['a'], [], 0)).toBe(-1);
  });

  it('is quick on a chapter with scattered edits', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `Paragraph ${i} of the chapter, with some words.`);
    const after = before.map((l, i) => (i % 97 === 0 ? `${l} Edited.` : l));
    const t = performance.now();
    const runs = diff(before, after);
    expect(performance.now() - t).toBeLessThan(500);
    expect(check(before, after, runs)).toBe(3000 - 31);
  });
});
