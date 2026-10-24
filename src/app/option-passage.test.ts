import { describe, expect, it } from 'vitest';
import { closestOurs, locatePassage } from './option-passage';

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
