import { describe, expect, it } from 'vitest';
import { countWords, proseDiff, wordPieces } from './prose-diff';

describe('word pieces', () => {
  it('marks a changed phrase as one deletion and one insertion', () => {
    expect(wordPieces('The harbour was quiet that night.', 'The harbour lay still that night.')).toEqual([
      { kind: 'same', text: 'The harbour ' },
      { kind: 'del', text: 'was quiet' },
      { kind: 'add', text: 'lay still' },
      { kind: 'same', text: ' that night.' },
    ]);
  });

  it('shows pure insertions and deletions', () => {
    expect(wordPieces('A cat.', 'A black cat.')).toEqual([
      { kind: 'same', text: 'A ' },
      { kind: 'add', text: 'black ' },
      { kind: 'same', text: 'cat.' },
    ]);
    expect(countWords('It’s 3 o’clock — #emph[now]!')).toBe(5);
  });
});

describe('prose diff', () => {
  const before = ['= Chapter One', '', 'Mara stood on the pier.', 'The storm had been building since noon.', '', 'Boats came in.', '', 'She went home.'].join('\n');

  it('finds changed paragraphs with context and counts words', () => {
    const after = before.replace('since noon', 'since early morning').replace('She went home.', 'She went home, cold and tired.');
    const d = proseDiff(before, after);
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0]).toMatchObject({ line: 4, before: ['Mara stood on the pier.'], after: [''] });
    expect(d.hunks[0].pieces.filter((p) => p.kind !== 'same')).toEqual([
      { kind: 'del', text: 'noon' },
      { kind: 'add', text: 'early morning' },
    ]);
    expect(d.hunks[1].pieces.filter((p) => p.kind === 'add').map((p) => p.text)).toEqual([', cold and tired']);
    expect([d.added, d.removed]).toEqual([5, 1]);
  });

  it('groups nearby changes into one passage', () => {
    const after = before.replace('Mara', 'Ana').replace('noon', 'dawn');
    const d = proseDiff(before, after);
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].pieces.map((p) => p.kind)).toEqual(['del', 'add', 'same', 'del', 'add', 'same']);
  });

  it('handles new, deleted and unchanged files', () => {
    expect(proseDiff(null, 'Hello there.\nSecond line.')).toMatchObject({ added: 4, removed: 0, hunks: [{ line: 1 }] });
    expect(proseDiff('Gone now.', null)).toMatchObject({ added: 0, removed: 2 });
    expect(proseDiff(before, before).hunks).toEqual([]);
  });

  it('reports where a removed paragraph was', () => {
    const d = proseDiff(before, before.replace('Mara stood on the pier.\n', ''));
    expect(d.hunks[0]).toMatchObject({ line: 3, oldLine: 3, pieces: [{ kind: 'del', text: 'Mara stood on the pier.' }] });
  });
});
