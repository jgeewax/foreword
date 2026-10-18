// How long a turn's steps take, for the chat. The model saying nothing yet
// (waiting: queued, loading, or reasoning it doesn't show) and its reasoning
// streaming in (thinking) are timed apart, so a slow start isn't counted as
// thought.
import type { Activity, ChatItem } from './studio';

type Thought = Extract<ChatItem, { kind: 'thinking' }>;

/**
 * The activity after a step: the turn's clock runs on; the step's restarts
 * when the phase changes (sending, then waiting for the first words, is one wait).
 */
export function nextActivity(prev: Activity | null, next: Omit<Activity, 'since' | 'phaseSince'>, now: number): Activity {
  const same = prev && (prev.phase === next.phase || (prev.phase === 'sending' && next.phase === 'waiting'));
  return { since: prev?.since ?? now, phaseSince: same ? (prev.phaseSince ?? prev.since) : now, ...next };
}

/** How long the model has said nothing (ms), if it's being waited on: the wait before its thinking, not part of it. */
export function waitedFor(a: Activity | null, now: number): number | undefined {
  return a && (a.phase === 'waiting' || a.phase === 'sending') ? now - (a.phaseSince ?? a.since) : undefined;
}

/** "12 s", or "1:05" from a minute. */
export const clockTime = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/** Whole seconds in a span of ms, or null under one (too short to be worth saying). */
const wholeSecs = (ms: number | undefined) => (ms !== undefined && ms >= 1000 ? Math.round(ms / 1000) : null);

/** A running step's time and the turn's, in whole seconds. */
export function stepTimes(a: Activity, now: number): { step: number; total: number } {
  return { step: Math.max(0, Math.floor((now - (a.phaseSince ?? a.since)) / 1000)), total: Math.max(0, Math.floor((now - a.since) / 1000)) };
}

/** "Waited 12 s · " before a thinking block, or nothing when the model started at once. */
export function waitedPrefix(t: Thought): string {
  const waited = wholeSecs(t.waited);
  return waited ? `Waited ${clockTime(waited)} · ` : '';
}

/** Seconds of a live thinking block so far. */
export const thinkingSoFar = (t: Thought, now: number) => Math.max(0, Math.floor((now - t.started) / 1000));

/** A finished thinking block's heading: "Waited 12 s · Thought for 4 s", or just "Thought" when it came all at once. */
export function thoughtHeading(t: Thought): string {
  const thought = wholeSecs(t.ended !== undefined ? t.ended - t.started : undefined);
  return `${waitedPrefix(t)}${thought ? `Thought for ${clockTime(thought)}` : 'Thought'}`;
}
