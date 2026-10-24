// The bar under a selection in the editor (SelectionBar.tsx): what Revise,
// Options and Ask offer, and how a request made from it is getting on, read
// from the chat (it waits its turn, the assistant works on it, it's done), for
// the passage's own note in the editor.
import { countWords, wordPieces, type Piece } from './prose-diff';
import { askPrompt, optionsPrompt, revisePrompt } from './stock-prompts';
import type { ChatItem, QueuedMessage } from './studio';
import { turnsOf, type UserItem } from './trace';
import type { AgentMode } from '../services/agent/modes';
import { parseOptions } from '../services/agent/options-mode';

/** Revise changes the passage in place (Write mode); Options writes three to pick from (Options mode); Ask answers a question about it (Ask mode). */
export type BarKind = 'revise' | 'options' | 'ask';

/** The mode each one is sent in. */
export const BAR_MODE: Record<BarKind, AgentMode> = { revise: 'write', options: 'options', ask: 'ask' };

/** The message a request from the card sends: the author's words, or a preset's. */
export function barMessage(kind: BarKind, instruction: string): string {
  if (kind === 'revise') return revisePrompt(instruction);
  return kind === 'options' ? optionsPrompt(instruction) : askPrompt(instruction);
}

/** One of the usual requests, a click away: its word on the button, and what it asks. */
export type Preset = { label: string; instruction: string; styleGuide?: true };

export const PRESETS: Record<BarKind, Preset[]> = {
  revise: [
    { label: 'Tighten', instruction: 'Tighten it: fewer words, the same meaning' },
    { label: 'Proofread', instruction: 'Proofread it: fix typos, spelling and grammar, and nothing else' },
    { label: 'Clearer', instruction: 'Make it clearer' },
    { label: 'Simpler words', instruction: 'Use simpler words' },
    { label: 'Expand', instruction: 'Expand it a little' },
    { label: 'Match my style guide', instruction: 'Bring it in line with my style guide', styleGuide: true },
  ],
  options: [
    { label: 'Shorter', instruction: 'Shorter' },
    { label: 'Plainer', instruction: 'Plainer' },
    { label: 'More vivid', instruction: 'More vivid' },
    { label: 'Match my style guide', instruction: 'Closer to my style guide', styleGuide: true },
  ],
  ask: [
    { label: 'Explain it', instruction: 'Explain it in plain words, including what any Typst markup in it does' },
    { label: 'Is it clear?', instruction: 'Is it clear? Where might a reader get lost?' },
    { label: 'Check the facts', instruction: 'Is it accurate? Check its facts, figures and claims' },
    { label: 'What’s weakest?', instruction: 'What is the weakest part of it, and why?' },
    { label: 'Does it fit?', instruction: 'Does it fit with what comes before and after it?' },
    { label: 'Against my style guide', instruction: 'Where does it stray from my style guide?', styleGuide: true },
  ],
};

/** The presets to offer: the style guide's only when the book has one. */
export const presetsFor = (kind: BarKind, hasStyleGuide: boolean) => PRESETS[kind].filter((p) => hasStyleGuide || !p.styleGuide);

/** Narrower than this (the editor's text, in px), the bar's buttons but Revise show only their icons. */
export const COMPACT_BELOW = 560;

/** A request made from the bar: the message it sent, from when. */
export type BarRequest = { kind: BarKind; message: string; since: number };

export type BarProgress =
  /** Waiting for the reply that's running (the author can send it now, or take it back). */
  | { phase: 'queued'; id: string; sending: boolean }
  | { phase: 'working' }
  /** Its turn is over: for Revise, what changed is in the passage itself (passageChange); for Ask, the answer is in the chat. */
  | { phase: 'ended' }
  /** Options, done: they're in the chat to pick from (`picked`: one is in the book). */
  | { phase: 'options'; picked: boolean }
  /** Not in this conversation (another task is showing, or it wasn't sent). */
  | { phase: 'gone' };

type Agent = { items: readonly ChatItem[]; queued: readonly QueuedMessage[]; running: boolean };

/** How a request from the bar is getting on, from the conversation. */
export function barProgress(agent: Agent, req: BarRequest): BarProgress {
  const queued = [...agent.queued].reverse().find((q) => q.text === req.message);
  if (queued) return { phase: 'queued', id: queued.id, sending: queued.sending };
  const users = agent.items.filter((it): it is UserItem => it.kind === 'user');
  const user = [...users].reverse().find((u) => u.text === req.message && (u.at ?? 0) >= req.since);
  if (!user) return { phase: 'gone' };
  if (agent.running && users[users.length - 1] === user && !user.ended) return { phase: 'working' };
  if (req.kind !== 'options') return { phase: 'ended' };
  const reply = turnsOf(agent.items).find((t) => t.key === user.id)?.reply;
  if (!reply || !parseOptions(reply.text).options.some((o) => o.complete && o.text !== null)) return { phase: 'ended' };
  return { phase: 'options', picked: reply.options?.applied != null };
}

/** What a revision did to the passage, word by word, and how many words longer it got; null if it's the same. */
export function passageChange(before: string, after: string): { pieces: Piece[]; words: number } | null {
  if (before === after) return null;
  return { pieces: wordPieces(before, after), words: countWords(after) - countWords(before) };
}

/** "−11 words", "+1 word", or "same length": how much longer or shorter it got. */
export function wordsLabel(n: number): string {
  if (n === 0) return 'same length';
  const words = Math.abs(n) === 1 ? 'word' : 'words';
  return n < 0 ? `−${-n} ${words}` : `+${n} ${words}`;
}

/** Where a selection is and how long, for the Revise card: "line 6 · 34 words". */
export function selectionSummary(startLine: number, endLine: number, text: string): string {
  const lines = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
  const n = countWords(text);
  return `${lines} · ${n} ${n === 1 ? 'word' : 'words'}`;
}
