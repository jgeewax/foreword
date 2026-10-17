import { describe, expect, it } from 'vitest';
import { addressPrompt, locate, makeComment, nextCommentId, parseAddressed, parseReport, parseReview, passageChange, serializeReview, undoChange, withoutAddressed } from './review';

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
    expect(p).toContain('REVIEW c3: changed — what you did\nREVIEW c4: declined — why not');
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

describe('the assistant’s report on each comment', () => {
  it('reads REVIEW lines (and the older ADDRESSED line), and hides them', () => {
    const reply = 'Done.\n\nREVIEW c1: changed — tightened the opening\n**REVIEW c2: declined – the term is defined in ch. 1**\nADDRESSED: c1, c5\n\nTASK COMPLETE?';
    expect(parseReport(reply)).toEqual([
      { id: 'c1', kind: 'changed', note: 'tightened the opening' },
      { id: 'c2', kind: 'declined', note: 'the term is defined in ch. 1' },
      { id: 'c5', kind: 'changed', note: '' },
    ]);
    expect(withoutAddressed(reply)).toBe('Done.\n\nTASK COMPLETE?');
  });
});

describe('the change made for a comment', () => {
  const before = ['= One', '', 'The storm came.', 'Mara waited.', '', 'Boats came in.', '', 'The end.'].join('\n');
  const at = (text: string, quote: string) => [text.indexOf(quote), text.indexOf(quote) + quote.length] as const;

  it('finds what changed in and right around the passage', () => {
    const after = before.replace('The storm came.', 'The storm came at noon.').replace('Mara waited.', 'Mara waited.\nShe was cold.');
    expect(passageChange(before, after, ...at(before, 'The storm came.'))).toEqual({ before: 'The storm came.', after: 'The storm came at noon.', line: 3 });
    // A line added right after the passage is part of its change.
    expect(passageChange(before, after, ...at(before, 'Mara waited.'))).toEqual({ before: 'Mara waited.', after: 'Mara waited.\nShe was cold.', line: 4 });
  });

  it('ignores changes elsewhere, and follows lines added above', () => {
    expect(passageChange(before, before.replace('The end.', 'Fin.'), ...at(before, 'Boats came in.'))).toBeNull();
    const after = `Intro.\n\n${before.replace('Boats came in.', 'Two boats came in.')}`;
    expect(passageChange(before, after, ...at(before, 'Boats came in.'))).toEqual({ before: 'Boats came in.', after: 'Two boats came in.', line: 8 });
  });

  it('undoes a change, if it is still there', () => {
    const after = before.replace('Boats came in.', 'Two boats came in.\nThe harbour filled.');
    const change = passageChange(before, after, ...at(before, 'Boats came in.'))!;
    expect(undoChange(after, change)).toBe(before);
    expect(undoChange(after.replace('Two boats', 'Three boats'), change)).toBeNull();
  });
});
