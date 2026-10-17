import { describe, expect, it } from 'vitest';
import { addressPrompt, locate, makeComment, nextCommentId, parseAddressed, parseReview, serializeReview, withoutAddressed } from './review';

const TEXT = `= Vectors

A vector is an ordered list. A vector is also an arrow.
We write vectors in bold.`;

describe('anchoring', () => {
  const start = TEXT.indexOf('A vector is also');
  const c = makeComment('c1', 'ch1.typ', TEXT, start, start + 'A vector is'.length, '  Say "arrow" first?  ');

  it('records the passage, its surroundings and line', () => {
    expect(c).toMatchObject({ quote: 'A vector is', line: 3, text: 'Say "arrow" first?', status: 'open' });
    expect(c.prefix.endsWith('ordered list. ')).toBe(true);
  });

  it('finds the right occurrence after edits around it', () => {
    const edited = `= Vectors and Spaces\n\nIntro paragraph.\n\nA vector is an ordered list. A vector is also an arrow.\nWe write vectors in bold.`;
    const [s, e] = locate(edited, c)!;
    expect(edited.slice(s, e)).toBe('A vector is');
    expect(edited.slice(e, e + 10)).toBe(' also an a');
  });

  it("reports a passage that's gone", () => {
    expect(locate(TEXT.replace('A vector is also', 'Also'), c)).toBeNull();
  });
});

describe('file and ids', () => {
  it('round-trips and ignores junk', () => {
    const c = makeComment('c2', 'a.typ', 'abc', 0, 1, 'x');
    expect(parseReview(serializeReview([c]))).toEqual([c]);
    expect(parseReview('nope')).toEqual([]);
    expect(nextCommentId([c, { ...c, id: 'c7' }])).toBe('c8');
    expect(nextCommentId([])).toBe('c1');
  });
});

describe('addressing comments', () => {
  const c = makeComment('c3', 'chapters/ch1.typ', TEXT, 2, 9, 'Tighten this.');

  it('asks for every comment with its place and quote, and for the ADDRESSED line', () => {
    const p = addressPrompt([
      { comment: c, line: 3 },
      { comment: { ...c, id: 'c4', text: 'Cut it.' }, line: null },
    ]);
    expect(p).toContain('[c3] chapters/ch1.typ, line 3, on “Vectors”:\nTighten this.');
    expect(p).toContain('[c4] chapters/ch1.typ (the passage has changed since)');
    expect(p.trimEnd().endsWith('ADDRESSED: c3, c4')).toBe(true);
  });

  it('reads and hides the ADDRESSED line', () => {
    const reply = 'Done both.\n\n**ADDRESSED: c3, c4**';
    expect(parseAddressed(reply)).toEqual(['c3', 'c4']);
    expect(withoutAddressed(reply)).toBe('Done both.');
    expect(parseAddressed('No marker here, c3.')).toEqual([]);
    const both = 'Done.\n\nADDRESSED: c1, c2\n\nTASK COMPLETE?';
    expect(parseAddressed(both)).toEqual(['c1', 'c2']);
    expect(withoutAddressed(both)).toBe('Done.\n\nTASK COMPLETE?');
  });
});
