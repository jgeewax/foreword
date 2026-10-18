import { describe, expect, it } from 'vitest';
import { activityWords, clockTime, nextActivity, stepTimes, thinkingSoFar, thoughtHeading, WAITING_TIPS, WAITING_WORDS, waitedFor, waitedPrefix, waitingTip, waitingWords, workerName } from './activity';
import type { Activity, ChatItem } from './studio';

type Thought = Extract<ChatItem, { kind: 'thinking' }>;
const thought = (t: Partial<Thought>): Thought => ({ kind: 'thinking', id: 'm:r0', text: '…', done: true, started: 0, ...t });

describe('a turn’s steps', () => {
  it('keep the turn’s clock, and restart the step’s when the phase changes', () => {
    const tool: Activity = { phase: 'tool', label: 'Reading', since: 1000, phaseSince: 2000 };
    const waiting = nextActivity(tool, { phase: 'waiting' }, 3000);
    expect(waiting).toEqual({ phase: 'waiting', since: 1000, phaseSince: 3000 });
    // Another step of the same phase (a new step starting) doesn't restart it.
    expect(nextActivity(waiting, { phase: 'waiting' }, 5000).phaseSince).toBe(3000);
    const thinking = nextActivity(waiting, { phase: 'thinking' }, 9000);
    expect(thinking).toEqual({ phase: 'thinking', since: 1000, phaseSince: 9000 });
    expect(stepTimes(thinking, 13500)).toEqual({ step: 4, total: 12 });
  });

  it('count sending and waiting for the first words as one wait', () => {
    const sent: Activity = { phase: 'sending', since: 1000 };
    const waiting = nextActivity(sent, { phase: 'waiting' }, 1300);
    expect(waiting).toEqual({ phase: 'waiting', since: 1000, phaseSince: 1000 });
    expect(waitedFor(waiting, 6000)).toBe(5000);
  });

  it('start a turn’s clock when there is none', () => {
    expect(nextActivity(null, { phase: 'tool', label: 'Reading' }, 42)).toEqual({ phase: 'tool', label: 'Reading', since: 42, phaseSince: 42 });
    // A restored turn with no step time counts from the turn's start.
    expect(stepTimes({ phase: 'waiting', since: 0 }, 7000)).toEqual({ step: 7, total: 7 });
  });

  it('measure the wait only while the model is being waited on', () => {
    expect(waitedFor({ phase: 'waiting', since: 0, phaseSince: 4000 }, 16000)).toBe(12000);
    expect(waitedFor({ phase: 'sending', since: 2000 }, 3000)).toBe(1000);
    expect(waitedFor({ phase: 'writing', since: 0, phaseSince: 0 }, 5000)).toBeUndefined();
    expect(waitedFor({ phase: 'tool', since: 0, phaseSince: 0 }, 5000)).toBeUndefined();
    expect(waitedFor(null, 5000)).toBeUndefined();
  });
});

describe('a thinking block’s heading', () => {
  it('says how long the model waited and how long it thought, apart', () => {
    expect(thoughtHeading(thought({ waited: 12000, started: 20000, ended: 24200 }))).toBe('Waited 12 s · Thought for 4 s');
    expect(thoughtHeading(thought({ waited: 65000, started: 0, ended: 90000 }))).toBe('Waited 1:05 · Thought for 1:30');
  });

  it('leaves out a wait under a second', () => {
    expect(thoughtHeading(thought({ waited: 400, started: 0, ended: 3000 }))).toBe('Thought for 3 s');
    expect(thoughtHeading(thought({ started: 0, ended: 3000 }))).toBe('Thought for 3 s');
  });

  it('gives no time for reasoning that came all at once', () => {
    expect(thoughtHeading(thought({ waited: 8000, started: 5000, ended: 5000 }))).toBe('Waited 8 s · Thought');
    expect(thoughtHeading(thought({ started: 5000 }))).toBe('Thought');
  });

  it('counts a live block from its first words, with the wait before', () => {
    const live = thought({ done: false, waited: 3000, started: 10000, ended: 11000 });
    expect(waitedPrefix(live)).toBe('Waited 3 s · ');
    expect(thinkingSoFar(live, 14900)).toBe(4);
    expect(thinkingSoFar(live, 9000)).toBe(0);
  });

  it('writes times as seconds, then minutes', () => {
    expect([clockTime(0), clockTime(59), clockTime(60), clockTime(605)]).toEqual(['0 s', '59 s', '1:00', '10:05']);
  });
});

describe('what the chat says while a turn runs', () => {
  it('names who is at work: the assistant, or OpenCode’s model', () => {
    expect(workerName('claude', 'opus')).toBe('Claude');
    expect(workerName('codex')).toBe('Codex');
    expect(workerName('gemini')).toBe('Gemini');
    expect(workerName('opencode', 'GPT-5')).toBe('GPT-5');
    expect(workerName('opencode', 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
    expect(workerName('opencode', 'Nemotron 3.5 Super VL Free')).toBe('Nemotron 3.5…');
    expect(workerName('opencode', 'a-very-long-model-name-without-spaces-at-all')).toBe('a-very-long-model-name…');
    expect(workerName('opencode', null)).toBe('The assistant');
  });

  it('says "is thinking" first, then other words every few seconds, from a place picked per turn', () => {
    expect(waitingWords(0, 3)).toBe('thinking');
    expect(waitingWords(3, 3)).toBe('thinking');
    expect(waitingWords(4, 0)).toBe(WAITING_WORDS[0]);
    expect(waitingWords(8, 0)).toBe(WAITING_WORDS[0]);
    expect(waitingWords(9, 0)).toBe(WAITING_WORDS[1]);
    expect(waitingWords(4, 5)).toBe(WAITING_WORDS[5]);
    // Each is said for a while, and they don't repeat back to back.
    const said = Array.from({ length: 40 }, (_, s) => waitingWords(s, 1234));
    for (let i = 1; i < said.length; i++) if (said[i] !== said[i - 1]) expect(i === 4 || (i - 4) % 5 === 0).toBe(true);
    // A long wait says now and then that it's still going.
    expect(Array.from({ length: 120 }, (_, s) => waitingWords(s, 0))).toContain('still at it');
  });

  it('words each step', () => {
    const a = (phase: string, more = {}) => ({ phase, since: 0, ...more }) as never;
    expect(activityWords(a('sending'), 'Codex', 0, 0)).toBe('Sending to Codex');
    expect(activityWords(a('waiting'), 'Claude', 1, 0)).toBe('Claude is thinking');
    expect(activityWords(a('thinking'), 'Claude', 30, 0)).toBe('Claude is thinking');
    expect(activityWords(a('writing'), 'GPT-5', 2, 0)).toBe('GPT-5 is writing');
    expect(activityWords(a('tool', { label: 'Reading “The Storm”' }), 'Claude', 2, 0)).toBe('Reading “The Storm”');
    expect(activityWords(a('asking'), 'Claude', 2, 0)).toBe('Waiting for your answer');
    expect(activityWords(a('retrying', { attempt: 2 }), 'Claude', 2, 5)).toBe('The model is busy. Trying again in 5 s (attempt 2)');
  });

  it('offers a tip once a turn runs long, and another later', () => {
    expect(waitingTip(14, 0)).toBeNull();
    expect(WAITING_TIPS).toContain(waitingTip(15, 0));
    expect(waitingTip(15, 0)).toBe(waitingTip(26, 0));
    expect(waitingTip(27, 0)).not.toBe(waitingTip(15, 0));
  });
});
