import { describe, expect, it } from 'vitest';
import { barProgress, passageChange, PRESETS, presetsFor, selectionSummary, wordsLabel, type BarRequest } from './selection-bar';
import { optionsPrompt, revisePrompt } from './stock-prompts';
import type { ChatItem, QueuedMessage } from './studio';

const revise: BarRequest = { kind: 'revise', message: revisePrompt('Tighten it'), since: 1000 };
const options: BarRequest = { kind: 'options', message: optionsPrompt('Shorter'), since: 1000 };
const user = (id: string, text: string, at = 2000, ended?: number): ChatItem => ({ kind: 'user', id, text, attachments: [], at, ...(ended ? { ended } : {}) });
const said = (id: string, text = 'Done.', applied: number | null = null): ChatItem => ({ kind: 'assistant', id, text, done: true, options: { target: null, original: null, applied } });
const queued = (text: string): QueuedMessage => ({ id: 'q1', text, attachments: [], delivery: 'queue', sending: false });
const THREE = ['### Option 1: Lean', '```typst', 'A.', '```', '### Option 2: Plain', '```typst', 'B.', '```', '### Option 3: Vivid', '```typst', 'C.', '```'].join('\n');

describe('how a request from the selection bar is getting on', () => {
  it('waits its turn while another reply runs, then works, then is over', () => {
    expect(barProgress({ items: [user('u0', 'Something else')], queued: [queued(revise.message)], running: true }, revise)).toEqual({ phase: 'queued', id: 'q1', sending: false });
    expect(barProgress({ items: [user('u1', revise.message)], queued: [], running: true }, revise)).toEqual({ phase: 'working' });
    expect(barProgress({ items: [user('u1', revise.message, 2000, 9000), said('a1')], queued: [], running: false }, revise)).toEqual({ phase: 'ended' });
  });

  it('is over once a later message has started its own turn', () => {
    const items = [user('u1', revise.message), said('a1'), user('u2', 'And chapter 2?')];
    expect(barProgress({ items, queued: [], running: true }, revise)).toEqual({ phase: 'ended' });
  });

  it('the same words sent before the request are another message; none at all is gone', () => {
    expect(barProgress({ items: [user('u1', revise.message, 500, 600)], queued: [], running: false }, revise)).toEqual({ phase: 'gone' });
    expect(barProgress({ items: [], queued: [], running: false }, revise)).toEqual({ phase: 'gone' });
  });

  it('Options: in the chat to pick from, until one is picked; a reply without them is just over', () => {
    expect(barProgress({ items: [user('u1', options.message, 2000, 9000), said('a1', THREE)], queued: [], running: false }, options)).toEqual({ phase: 'options', picked: false });
    expect(barProgress({ items: [user('u1', options.message, 2000, 9000), said('a1', THREE, 2)], queued: [], running: false }, options)).toEqual({ phase: 'options', picked: true });
    expect(barProgress({ items: [user('u1', options.message, 2000, 9000), said('a1', 'Which passage?')], queued: [], running: false }, options)).toEqual({ phase: 'ended' });
  });
});

describe('what a revision did', () => {
  it('the words it cut and put in, and how much shorter it got', () => {
    const change = passageChange('but which spoke not only in these silent symbols', 'but it showed');
    expect(change?.words).toBe(-6);
    expect(change?.pieces.some((p) => p.kind === 'del')).toBe(true);
    expect(passageChange('Same.', 'Same.')).toBeNull();
  });

  it('in words', () => {
    expect(wordsLabel(-11)).toBe('−11 words');
    expect(wordsLabel(1)).toBe('+1 word');
    expect(wordsLabel(0)).toBe('same length');
    expect(selectionSummary(6, 6, 'something indeed which never')).toBe('line 6 · 4 words');
    expect(selectionSummary(6, 8, 'One')).toBe('lines 6–8 · 1 word');
  });
});

describe('the usual requests', () => {
  it('the style guide’s only when the book has one', () => {
    expect(presetsFor('revise', false).map((p) => p.label)).toEqual(['Tighten', 'Proofread', 'Clearer', 'Simpler words', 'Expand']);
    expect(presetsFor('revise', true)).toHaveLength(PRESETS.revise.length);
    expect(presetsFor('options', false).map((p) => p.label)).toEqual(['Shorter', 'Plainer', 'More vivid']);
  });
});
