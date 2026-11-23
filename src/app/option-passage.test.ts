import { describe, expect, it } from 'vitest';
import { closestOurs, findPassage, locatePassage } from './option-passage';

const before = 'Intro. ';
const passage = 'The cat sat on the mat.';
const after = ' Then it slept.';
const doc = before + passage + after;
const at = { start: before.length, end: before.length + passage.length };
const both = (r: { start: number; end: number }) => ({ outer: r, inner: r });

describe('finding the passage an option replaces', () => {
  it('is safe while it holds the passage as asked about', () => {
    expect(locatePassage(doc, both(at), [passage], null)).toEqual({ kind: 'ours', ...at });
  });

  it('holds an option put in it: safe too, and so is any option put in before', () => {
    const option = 'A cat lay on the mat.';
    const now = before + option + after;
    const range = { start: before.length, end: before.length + option.length };
    expect(locatePassage(now, both(range), [option, passage], null)).toEqual({ kind: 'ours', ...range });
    expect(locatePassage(now, both(range), ['Another.', option, passage], null)).toEqual({ kind: 'ours', ...range });
  });

  it('written right beside it: the range that grows took that in, the one that doesn’t holds the passage', () => {
    const typed = 'Indeed, ' + passage + ' Purring.';
    const now = before + typed + after;
    const outer = { start: before.length, end: before.length + typed.length };
    const inner = { start: before.length + 'Indeed, '.length, end: before.length + 'Indeed, '.length + passage.length };
    expect(locatePassage(now, { outer, inner }, [passage], null)).toEqual({ kind: 'ours', ...inner });
  });

  it('after ⌘Z over an option, the original is back whole in the range that grows, though the other covers only its start', () => {
    const option = 'The cat sat';
    const inner = { start: before.length, end: before.length + option.length };
    expect(locatePassage(doc, { outer: at, inner }, [option, passage], null)).toEqual({ kind: 'ours', ...at });
  });

  it('changed by the author, at its end too: not safe, with all they wrote', () => {
    const edited = 'The cat sat on the big mat.';
    const now = before + edited + after;
    const outer = { start: before.length, end: before.length + edited.length };
    // The end of what they typed is outside the range that doesn't grow.
    const inner = { start: before.length, end: before.length + passage.length };
    expect(locatePassage(now, { outer, inner }, [passage], null)).toEqual({ kind: 'changed', ...outer, now: edited });
    expect(locatePassage(before + 'The dog sat on the mat.' + after, both(at), [passage], null)).toEqual({ kind: 'changed', ...at, now: 'The dog sat on the mat.' });
  });

  it('deleted: only its place is left; written over: changed', () => {
    const point = { start: before.length, end: before.length };
    expect(locatePassage(before + after, both(point), [passage], null)).toEqual({ kind: 'deleted', at: before.length });
    const typed = 'Mine.';
    const now = before + typed + after;
    const outer = { start: before.length, end: before.length + typed.length };
    const inner = { start: outer.end, end: outer.end };
    expect(locatePassage(now, { outer, inner }, [passage], null)).toEqual({ kind: 'changed', ...outer, now: typed });
  });

  it('a bare insertion point is ours while nothing is in it, and after what the author types there', () => {
    const point = { start: before.length, end: before.length };
    expect(locatePassage(before + after, both(point), [''], null)).toEqual({ kind: 'ours', ...point });
    // Undone after an option went in: the point again.
    expect(locatePassage(before + after, both(point), ['An option.', ''], null)).toEqual({ kind: 'ours', ...point });
    const typed = 'Mine. ';
    const inner = { start: before.length + typed.length, end: before.length + typed.length };
    expect(locatePassage(before + typed + after, { outer: { start: before.length, end: inner.end }, inner }, [''], null)).toEqual({ kind: 'ours', ...inner });
  });

  it('not followed any more: found where it was last seen, or where its words are the only time', () => {
    expect(locatePassage(doc, null, [passage], before.length)).toEqual({ kind: 'ours', ...at });
    expect(locatePassage('New line. ' + doc, null, [passage], before.length)).toEqual({ kind: 'ours', start: at.start + 10, end: at.end + 10 });
    expect(locatePassage(doc + ' ' + passage, null, [passage], 0)).toEqual({ kind: 'lost' });
    expect(locatePassage(doc, null, [''], before.length)).toEqual({ kind: 'lost' });
  });

  it('not followed: the latest of ours is looked for first', () => {
    const option = 'A cat lay on the mat.';
    const text = before + option + ' ' + passage;
    expect(locatePassage(text, null, [option, passage], null)).toEqual({ kind: 'ours', start: before.length, end: before.length + option.length });
  });
});

describe('what the author changed', () => {
  it('is measured from whichever of ours their version is closest to', () => {
    const option = 'A cat lay on the mat.';
    expect(closestOurs('A cat lay on the big mat.', [option, passage])).toBe(option);
    expect(closestOurs('The cat sat on a mat.', [option, passage])).toBe(passage);
    expect(closestOurs('Anything', [])).toBe('');
  });
});

describe('the passage a reply says its options replace', () => {
  const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n');
  const span = (doc: string, words: string, from = 0) => ({ start: doc.indexOf(words, from), end: doc.indexOf(words, from) + words.length });

  it('is where its words are, wherever the line it gives', () => {
    const doc = 'Intro.\n\nThe span of a list is the set of its combinations.\nIt is the smallest subspace.\n\nNext.';
    const find = 'The span of a list is the set of its combinations.\nIt is the smallest subspace.';
    expect(findPassage(doc, find, 3)).toEqual(span(doc, find));
    expect(findPassage(doc, find, 400)).toEqual(span(doc, find));
    expect(findPassage(doc, find, null)).toEqual(span(doc, find));
  });

  it('words in the file more than once: the place nearest its line, if there is one', () => {
    const doc = lines(200, (i) => (i === 10 || i === 150 ? 'Same words.' : `Line ${i}.`));
    const second = doc.indexOf('Same words.', doc.indexOf('Same words.') + 1);
    expect(findPassage(doc, 'Same words.', 148)).toEqual({ start: second, end: second + 11 });
    expect(findPassage(doc, 'Same words.', 12)).toEqual(span(doc, 'Same words.'));
    // No line, too far from both, or halfway: nowhere, rather than a guess.
    expect(findPassage(doc, 'Same words.', null)).toBeNull();
    expect(findPassage(doc, 'Same words.', 80)).toBeNull();
  });

  it('tolerates blank space at its ends, quotes around it, and retyped spaces and quote marks', () => {
    const doc = 'Before.\n  It’s the “smallest” subspace\n  that holds them.\nAfter.';
    const passage = 'It’s the “smallest” subspace\n  that holds them.';
    expect(findPassage(doc, `\n${passage}\n`, 2)).toEqual(span(doc, passage));
    expect(findPassage(doc, `"${passage}"`, 2)).toEqual(span(doc, passage));
    expect(findPassage(doc, 'It\'s the "smallest" subspace\nthat holds them.', 2)).toEqual(span(doc, passage));
    expect(findPassage(doc, "It's the smallest subspace that holds them.", 2)).toBeNull();
  });

  it('no words, or words that aren’t there: nowhere', () => {
    expect(findPassage('Some text.', '', 1)).toBeNull();
    expect(findPassage('Some text.', ' \n ', 1)).toBeNull();
    expect(findPassage('Some text.', 'Other text.', 1)).toBeNull();
  });

  it('a regex character in the words is only itself', () => {
    const doc = 'Let $x in (a, b)$ [see @ref].\nThen $x^2 + 1 > 0$.';
    expect(findPassage(doc, 'Let $x in (a, b)$  [see @ref].', 1)).toEqual(span(doc, 'Let $x in (a, b)$ [see @ref].'));
  });
});
