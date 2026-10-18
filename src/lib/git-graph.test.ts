import { describe, expect, it } from 'vitest';
import { layoutGraph } from './git-graph';

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe('layoutGraph', () => {
  it('draws a straight line for a branch without merges', () => {
    const { rows, width } = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')]);
    expect(width).toBe(1);
    expect(rows).toEqual([
      { lane: 0, top: [], bottom: [[0, 0]] },
      { lane: 0, top: [[0, 0]], bottom: [[0, 0]] },
      { lane: 0, top: [[0, 0]], bottom: [] },
    ]);
  });

  it('runs the line off the bottom when older commits are not shown', () => {
    expect(layoutGraph([c('b', 'a')]).rows[0].bottom).toEqual([[0, 0]]);
  });

  it('opens a lane for a merged branch and joins it at the fork', () => {
    // m merges x into main; x and b both come from a.
    const { rows, width } = layoutGraph([c('m', 'b', 'x'), c('x', 'a'), c('b', 'a'), c('a')]);
    expect(width).toBe(2);
    expect(rows[0]).toEqual({ lane: 0, top: [], bottom: [[0, 0], [0, 1]] });
    expect(rows[1]).toEqual({ lane: 1, top: [[0, 0], [1, 1]], bottom: [[0, 0], [1, 1]] });
    expect(rows[2]).toEqual({ lane: 0, top: [[0, 0], [1, 1]], bottom: [[1, 1], [0, 0]] });
    expect(rows[3]).toEqual({ lane: 0, top: [[0, 0], [1, 0]], bottom: [] });
  });

  it('gives a remote branch ahead of this one its own lane', () => {
    // origin's r is ahead of h (HEAD); both come from a.
    const { rows } = layoutGraph([c('r', 'a'), c('h', 'a'), c('a')]);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0]);
    expect(rows[2].top).toEqual([[0, 0], [1, 0]]);
  });
});
