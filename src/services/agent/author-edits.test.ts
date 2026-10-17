import { describe, expect, it } from 'vitest';
import { authorEditLabel, authorEdits, formatAuthorEdits } from './author-edits';

// The file as the assistant left it: it wrote lines 3–4.
const after = ['= Vectors', '', 'A vector is a list of numbers.', 'We write vectors in bold.', '', 'The end.'].join('\n');
const wrote = [{ from: 3, to: 4 }];

describe("the author's changes to the assistant's text", () => {
  it('finds a rewritten line, with what the assistant wrote and what is there now', () => {
    const now = after.replace('We write vectors in bold.', 'We always write vectors in bold, as $bold(v)$.');
    expect(authorEdits('ch1.typ', after, now, wrote)).toEqual([
      { path: 'ch1.typ', from: 4, to: 4, wrote: 'We write vectors in bold.', now: 'We always write vectors in bold, as $bold(v)$.' },
    ]);
  });

  it('ignores edits elsewhere, and no edits at all', () => {
    expect(authorEdits('ch1.typ', after, after.replace('The end.', 'The very end.'), wrote)).toEqual([]);
    expect(authorEdits('ch1.typ', after, after, wrote)).toEqual([]);
  });

  it('reports lines the author removed or added inside the assistant’s text', () => {
    const removed = authorEdits('ch1.typ', after, after.replace('We write vectors in bold.\n', ''), wrote);
    expect(removed).toEqual([{ path: 'ch1.typ', from: 4, to: 3, wrote: 'We write vectors in bold.', now: '' }]);
    expect(authorEditLabel(removed[0])).toBe('ch1.typ:4');
    const added = authorEdits('ch1.typ', after, after.replace('numbers.\n', 'numbers.\nThink of an arrow.\n'), wrote);
    expect(added).toEqual([{ path: 'ch1.typ', from: 4, to: 4, wrote: '', now: 'Think of an arrow.' }]);
  });

  it('runs a passage between unchanged lines, so it reads whole', () => {
    const now = after.replace('A vector is a list of numbers.\nWe write vectors in bold.', 'A vector is an ordered list.\nIt has a length.\nWe write it in bold.');
    const [e] = authorEdits('ch1.typ', after, now, wrote);
    expect(e).toMatchObject({ from: 3, to: 5, wrote: 'A vector is a list of numbers.\nWe write vectors in bold.', now: 'A vector is an ordered list.\nIt has a length.\nWe write it in bold.' });
  });

  it('formats a block the assistant reads as the author’s version to build on', () => {
    const text = formatAuthorEdits([{ path: 'ch1.typ', from: 4, to: 4, wrote: 'A', now: 'B' }]);
    expect(text).toMatch(/^Since your last turn, the author changed text you wrote\. Build on their version/);
    expect(text).toContain('<author-edit path="ch1.typ" lines="4–4">\n<you-wrote>\nA\n</you-wrote>\n<author-changed-it-to>\nB\n</author-changed-it-to>\n</author-edit>');
  });
});
