import { describe, expect, it } from 'vitest';
import { describeRestore } from './history';

describe('describeRestore', () => {
  it('names restored, skipped and kept files', () => {
    expect(
      describeRestore({
        restored: ['chapters/ch1.typ'],
        skipped: [{ path: 'chapters/ch2.typ', why: 'unsaved edits' }],
        kept: ['chapters/new.typ'],
      }),
    ).toBe("Restored ch1.typ. Skipped ch2.typ (unsaved edits). Left new.typ in place (added later; delete by hand if you don't want it).");
  });

  it('summarises long lists and says when nothing changed', () => {
    expect(describeRestore({ restored: ['a', 'b', 'c', 'd'], skipped: [], kept: [] })).toBe('Restored 4 files.');
    expect(describeRestore({ restored: [], skipped: [], kept: [] })).toBe('Nothing needed restoring.');
  });
});
