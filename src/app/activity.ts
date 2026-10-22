// How long a turn's steps take, for the chat. The model saying nothing yet
// (waiting: queued, loading, or reasoning it doesn't show) and its reasoning
// streaming in (thinking) are timed apart, so a slow start isn't counted as
// thought. And what the chat says meanwhile: who's at work, in words that
// change while it waits, and a tip once a turn runs long.
import type { AssistantId } from './settings';
import type { Activity, ChatItem } from './studio';

/** What the chat calls whoever is at work: the assistant (Claude, Codex…); for OpenCode, its model. */
const WORKERS: Record<Exclude<AssistantId, 'opencode'>, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', antigravity: 'Antigravity' };

/** "Claude", "Codex", or OpenCode's model ("GPT-5", "Nemotron 3.5…" when long); "The assistant" when there's no name. */
export function workerName(assistant: AssistantId, modelName?: string | null): string {
  if (assistant !== 'opencode') return WORKERS[assistant];
  const name = modelName?.trim();
  if (!name) return 'The assistant';
  if (name.length <= 22) return name;
  // A long name, to its first words (the line has a time beside it).
  let short = '';
  for (const word of name.split(/\s+/)) {
    if (short && `${short} ${word}`.length > 16) break;
    short = short ? `${short} ${word}` : word;
  }
  const cut = short.slice(0, 22);
  return cut.length < name.length ? `${cut}…` : cut;
}

/**
 * While the model says nothing, the line changes every few seconds so a long
 * wait doesn't look stuck: playful words, never a claim about what it does.
 */
export const WAITING_WORDS = [
  'mulling it over',
  'pondering',
  'chewing the pen',
  'musing',
  'wordsmithing',
  'turning a phrase',
  'percolating',
  'staring out the window',
  'sharpening a pencil',
  'daydreaming',
  'noodling',
  'ruminating',
  'brewing ideas',
  'inking',
];
/** After a long wait, now and then: it's still going. */
const STILL_WORDS = ['still at it', 'taking its time to get it right'];

/** Seconds per phrase. */
const PHRASE_SECS = 5;
/** Plain "is thinking" for this long first. */
const PLAIN_SECS = 4;
const SLOW_SECS = 45;

/** The words for a wait `step` seconds long ("is thinking", then others); `seed` picks where the list starts, per turn. */
export function waitingWords(step: number, seed: number): string {
  if (step < PLAIN_SECS) return 'thinking';
  const n = Math.floor((step - PLAIN_SECS) / PHRASE_SECS);
  if (step >= SLOW_SECS && n % 4 === 3) return STILL_WORDS[Math.floor(n / 4) % STILL_WORDS.length];
  return WAITING_WORDS[(Math.abs(seed) + n) % WAITING_WORDS.length];
}

/** The activity line's words for a step (without its "…"). */
export function activityWords(a: Activity, name: string, step: number, retryIn: number): string {
  switch (a.phase) {
    case 'sending':
      return `Sending to ${name}`;
    case 'waiting':
      return `${name} is ${waitingWords(step, a.since)}`;
    case 'thinking':
      return `${name} is thinking`;
    case 'tool':
      return a.label ?? `${name} is working`;
    case 'writing':
      return `${name} is writing`;
    case 'asking':
      return 'Waiting for your answer';
    case 'retrying':
      return `The model is busy. Trying again${retryIn ? ` in ${retryIn} s` : ' now'}${a.attempt ? ` (attempt ${a.attempt})` : ''}`;
  }
}

/** Things worth knowing, one at a time under a turn that runs long. */
export const WAITING_TIPS = [
  'You can keep writing meanwhile: History keeps a version from before its changes.',
  'A message you send now waits for this turn; ⌥⏎ hands it over at the next step.',
  'Select a passage and press ⌘I to ask about just that.',
  'Options mode gives you three versions of a passage to pick from.',
  'Discuss mode weighs an idea with you, and argues back, before anything is written.',
  'Ask mode answers questions in the chat, and changes nothing.',
  'Finished? Done keeps a named version in History and starts a new task.',
  'Every change it makes is marked in the editor’s gutter, and can be undone from History.',
  'A style guide (WRITING_STYLE.md) keeps every edit sounding like your book.',
];
const TIP_AFTER_SECS = 15;
const TIP_SECS = 12;

/** The tip for a turn `total` seconds long, or null while it's young. */
export function waitingTip(total: number, seed: number): string | null {
  if (total < TIP_AFTER_SECS) return null;
  return WAITING_TIPS[(Math.abs(Math.floor(seed / 7)) + Math.floor((total - TIP_AFTER_SECS) / TIP_SECS)) % WAITING_TIPS.length];
}

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
