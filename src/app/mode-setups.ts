// What each mode runs on: the chat's usual assistant, model and effort, unless
// the author pinned the mode to its own (Figures on Codex at extra high).
// Switching to a pinned mode brings back its own, and leaving it brings back
// the usual one; between modes not pinned nothing changes. Changing any of
// them in a pinned mode changes its own, and anywhere else the usual one.
//
// A conversation carries over to a mode set to another assistant: that
// assistant gets the turns it hasn't seen with the next message (chatSoFar),
// in its own conversation, which is opened again when the chat comes back to it.

import { ASSISTANT_NAMES, ASSISTANTS, type AssistantId } from './settings';
import type { ChatItem } from './studio';
import { withoutMarker } from './tasks';
import { describeTool, NO_NAMES } from './tool-labels';
import { EARLIER_CHIP, EARLIER_INTRO } from '../services/agent/message-context';
import { AGENT_MODES, withoutModeOffer, type AgentMode } from '../services/agent/modes';
import { answersMessage } from '../services/agent/questions';
import type { ModelRef } from '../services/agent/types';

export type ModeSetup = {
  assistant: AssistantId;
  /** null: the assistant's own choice (none was picked in this mode). */
  model: ModelRef | null;
  effort: string | null;
  /** As the mode menu shows them (another assistant's models aren't listed while this one runs). */
  modelName?: string;
  effortName?: string;
};

export type ModeSetups = Partial<Record<AgentMode, ModeSetup>>;

export type Setups = {
  /** What every mode not pinned runs on: the last chosen in one of them. */
  usual: ModeSetup | null;
  /** The modes pinned to their own. */
  pins: ModeSetups;
};

/** One that was kept (localStorage), with an assistant it knows; null if not. */
export function readSetup(raw: unknown): ModeSetup | null {
  const s = raw as Record<string, any> | null;
  if (!s || typeof s !== 'object' || !ASSISTANTS.includes(s.assistant)) return null;
  const model = s.model && typeof s.model.providerID === 'string' && typeof s.model.id === 'string' ? { providerID: s.model.providerID, id: s.model.id } : null;
  return {
    assistant: s.assistant,
    model,
    effort: typeof s.effort === 'string' ? s.effort : null,
    ...(model && typeof s.modelName === 'string' ? { modelName: s.modelName } : {}),
    ...(typeof s.effort === 'string' && typeof s.effortName === 'string' ? { effortName: s.effortName } : {}),
  };
}

/** The modes it knows, each with a setup readSetup takes. */
export function readModeSetups(raw: unknown): ModeSetups {
  const out: ModeSetups = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const mode of AGENT_MODES) {
    const s = readSetup((raw as Record<string, unknown>)[mode]);
    if (s) out[mode] = s;
  }
  return out;
}

/**
 * Before pins (until 2026-11-14) every mode kept the setup last used in it,
 * which a mode switch brought back unasked. Write's is the usual one now (a
 * window starts in Write, so it's what was running), and no mode is pinned.
 */
export const fromModeSetups = (raw: unknown): Setups => ({ usual: readModeSetups(raw).write ?? null, pins: {} });

/** What `mode` runs on: its own if it's pinned, else the usual one (none yet: what's in use). */
export const setupOf = (s: Setups, mode: AgentMode): ModeSetup | undefined => s.pins[mode] ?? s.usual ?? undefined;

/** The same assistant, model and effort (names aside). */
export const sameSetup = (a: ModeSetup, b: ModeSetup) => a.assistant === b.assistant && a.model?.providerID === b.model?.providerID && a.model?.id === b.model?.id && (a.effort ?? null) === (b.effort ?? null);

/** The mode menu's line for a mode: "Claude Code · Opus 5.5 · Medium". */
export function setupLine(s: ModeSetup): string {
  return [ASSISTANT_NAMES[s.assistant], s.model ? (s.modelName ?? s.model.id) : null, s.effort && s.effort !== 'default' ? (s.effortName ?? s.effort) : null].filter(Boolean).join(' · ');
}

// ---- the chat so far, for another assistant ---------------------------------------

/** At most this much of the chat goes (the latest of it): about 10,000 tokens. */
const MAX_CHARS = 40_000;
const MAX_ENTRY = 8_000;
const MAX_TOOLS = 20;

const cut = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/**
 * The chat's turns after the item `after` (null: all of it), as words for an
 * assistant that didn't take part: what the author said, each reply (by the
 * assistant that gave it), and what it did ("Edited chapters/storm.typ").
 * Null when there's no turn to give. `root` makes tools' paths the book's.
 */
export function chatSoFar(items: readonly ChatItem[], after: string | null, root = ''): string | null {
  const start = after === null ? 0 : items.findIndex((it) => it.id === after) + 1;
  const names = { ...NO_NAMES, root };
  const entries: { who: string; lines: string[]; tools: string[] }[] = [];
  let speaker = 'Assistant';
  const say = (who: string, text: string) => {
    const last = entries.at(-1);
    if (last && last.who === who) last.lines.push(text);
    else entries.push({ who, lines: [text], tools: [] });
  };
  for (const it of items.slice(start)) {
    if (it.kind === 'user') {
      speaker = it.by ? ASSISTANT_NAMES[it.by.assistant] : 'Assistant';
      const attached = it.attachments.filter((a) => a !== EARLIER_CHIP);
      say('Author', `${it.text.trim()}${attached.length ? `\n(With: ${attached.join(', ')})` : ''}`);
    } else if (it.kind === 'assistant') {
      const text = withoutMarker(withoutModeOffer(it.text)).trim();
      if (text) say(speaker, text);
    } else if (it.kind === 'tool' && it.status !== 'running') {
      const label = describeTool(it.name, it.input, names).done;
      const last = entries.at(-1);
      if (last?.who === speaker) last.tools.push(it.status === 'failed' ? `${label} (failed)` : label);
      else entries.push({ who: speaker, lines: [], tools: [label] });
    } else if (it.kind === 'question' && it.via !== 'message' && it.state === 'answered' && it.answer) {
      say('Author', answersMessage(it.fields, it.answer));
    }
  }
  const blocks = entries.map(({ who, lines, tools }) => {
    const did = tools.length ? `[${[...tools.slice(0, MAX_TOOLS), ...(tools.length > MAX_TOOLS ? [`${tools.length - MAX_TOOLS} more`] : [])].join('; ')}]` : '';
    return cut(`${who}: ${[lines.join('\n\n'), did].filter(Boolean).join('\n')}`, MAX_ENTRY);
  });
  if (!blocks.length) return null;
  // The latest turns, as many as fit (one always does: MAX_ENTRY).
  let from = blocks.length;
  for (let size = 0; from > 0 && size + blocks[from - 1].length <= MAX_CHARS; from--) size += blocks[from - 1].length + 2;
  const body = [...(from ? ['(Earlier turns left out.)'] : []), ...blocks.slice(from)].join('\n\n');
  return `${EARLIER_INTRO}\n<earlier-turns>\n${body}\n</earlier-turns>\nThe book’s files are as these turns left them: read a file again before you change it.`;
}
