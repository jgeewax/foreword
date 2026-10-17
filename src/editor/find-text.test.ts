import { describe, expect, it } from 'vitest';
import { findInSource, findPartial } from './find-text';

const SRC = `= Eigenvalues

Let $A$ be an $n times n$ matrix. A nonzero vector $bold(v)$ is an
_eigenvector_ of $A$ with *eigenvalue* $lambda$ when the "equation" holds.

The eigenvalues of $A$ are the roots.`;

describe('findInSource', () => {
  const pick = (r: [number, number] | null) => (r ? SRC.slice(r[0], r[1]) : null);

  it('finds plain text across line breaks and markup', () => {
    expect(pick(findInSource(SRC, 'is an eigenvector of'))).toBe('is an\n_eigenvector_ of');
    expect(pick(findInSource(SRC, 'with eigenvalue'))).toBe('with *eigenvalue');
  });

  it('matches typographic quotes and is case-insensitive', () => {
    expect(pick(findInSource(SRC, 'the “Equation” holds'))).toBe('the "equation" holds');
  });

  it('prefers the occurrence nearest the clicked position', () => {
    const late = SRC.lastIndexOf('The eigenvalues');
    expect(findInSource(SRC, 'eigenvalues of', late)![0]).toBe(late + 4);
    expect(findInSource(SRC, 'not in the text')).toBeNull();
  });
});

describe('findPartial', () => {
  const pick = (r: [number, number] | null) => (r ? SRC.slice(r[0], r[1]) : null);
  it('anchors on the parts that match when math is in the middle', () => {
    // The preview shows "λ" where the source says $lambda$.
    expect(pick(findPartial(SRC, 'with eigenvalue λ when the “equation” holds'))).toBe('with *eigenvalue* $lambda$ when the "equation" holds');
  });
  it('falls back to the longest matching start', () => {
    expect(pick(findPartial(SRC, 'The eigenvalues of A are the roots. ∑∑∑'))).toBe('The eigenvalues of $A$ are the roots.');
    expect(findPartial(SRC, 'nothing like this at all')).toBeNull();
  });
});
