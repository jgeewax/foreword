// Task-based conversations: each OpenCode session is a task with one goal.
// The assistant restates the goal first and, when it thinks the goal is met,
// ends its reply with a marker line; Typst Studio hides the marker and asks the
// author to confirm. Finished tasks are remembered per book on this Mac.

import { readLabel, readOf, type AiRead } from './ai-marks';
import { describeTool, NO_NAMES } from './tool-labels';
import type { ChatItem } from './studio';
import { AUTHOR_EDITS_INTRO } from '../services/agent/author-edits';

export const TASK_INSTRUCTIONS_KEY = 'task';

export const TASK_MARKER = 'TASK COMPLETE?';

export const TASK_INSTRUCTIONS = `# This conversation is one task

The author works in tasks: each conversation has one goal.
- At the start, restate the goal in one sentence. If something important is unclear, ask one or two short questions before starting; otherwise get going.
- Stay on that goal. If the author asks for something unrelated, help briefly, or suggest starting a new task for it.
- When you believe the goal is done, say in a sentence or two what you did, then end your reply with this exact line on its own:
${TASK_MARKER}
Typst Studio shows the author buttons to confirm. Don't use that line at any other time.`;

// A whole line; other marker lines (e.g. ADDRESSED:) may come after it.
const MARKER_LINE = /^[ \t]*[*_`]*TASK COMPLETE\?[*_`]*[ \t]*$/gm;

/** Whether the reply asks the author to confirm the task is done (in its last few lines). */
export function asksTaskDone(text: string): boolean {
  const tail = text.trimEnd().split('\n').slice(-4).join('\n');
  return new RegExp(MARKER_LINE.source, 'm').test(tail);
}

/** The reply without the marker line (for display). */
export function withoutMarker(text: string): string {
  return text.replace(MARKER_LINE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Marks a message's chip for the author's edits sent with it. */
export const AUTHOR_EDIT_CHIP = 'Your edit:';

export type TaskRecord = { sessionId: string; status: 'open' | 'done'; doneAt?: number };

export type TaskSummary = { sessionId: string; title: string; status: 'open' | 'done'; updated: number; tokens: number | null };

/** The context Typst Studio appends to a message: selections (editor/selection.ts) and the author's edits (agent/author-edits.ts). */
const CONTEXT_TAIL = new RegExp(`\\n\\n(?:Selected in the editor: |The cursor is in |${AUTHOR_EDITS_INTRO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[\\s\\S]*$`);

/** User message text as the author typed it, plus the labels of what was attached. */
export function splitUserText(text: string): { text: string; attachments: string[] } {
  const attachments = [
    ...[...text.matchAll(/<selection path="([^"]+)" start="(\d+):\d+" end="(\d+):\d+">/g)].map(([, path, a, b]) => (a === b ? `${path}:${a}` : `${path}:${a}–${b}`)),
    ...[...text.matchAll(/<author-edit path="([^"]+)" lines="(\d+)(?:–(\d+)| \(removed\))">/g)].map(([, path, a, b]) => `${AUTHOR_EDIT_CHIP} ${path}:${b && b !== a ? `${a}–${b}` : a}`),
  ];
  return { text: text.replace(CONTEXT_TAIL, ''), attachments };
}

type ContextPart = {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  state?: { status?: string; input?: Record<string, unknown>; content?: { text?: string }[]; error?: string };
  time?: { created?: number; completed?: number };
};
type ContextMessage = {
  id: string;
  type: string;
  text?: string;
  content?: ContextPart[];
  tokens?: { input?: number; cache?: { read?: number; write?: number } };
  /** Compaction: the summary that replaced earlier messages, and any kept verbatim. */
  summary?: string;
  recent?: unknown;
};

const toolSummary = (input: Record<string, unknown> = {}) => String(input.path ?? input.filePath ?? input.command ?? input.pattern ?? input.url ?? input.query ?? '');

/** The lines the assistant read in a saved conversation (as far as it still holds them: compaction drops older reads). */
export function readsFromContext(messages: ContextMessage[], root: string): AiRead[] {
  const reads: AiRead[] = [];
  for (const m of messages) {
    if (m.type === 'compaction' && Array.isArray(m.recent)) reads.push(...readsFromContext(m.recent as ContextMessage[], root));
    if (m.type !== 'assistant') continue;
    for (const part of m.content ?? []) {
      if (part.type !== 'tool' || part.state?.status === 'error' || part.state?.status === 'failed') continue;
      const r = readOf(root, part.name ?? '', part.state?.input, part.state?.content?.map((c) => c.text ?? '').join('\n') ?? '');
      if (r) reads.push(r);
    }
  }
  return reads;
}

/** Chat items for a saved conversation (from GET /api/session/{id}/context). */
export function itemsFromContext(messages: ContextMessage[], root = ''): ChatItem[] {
  const items: ChatItem[] = [];
  for (const m of messages) {
    if (m.type === 'compaction') {
      if (m.summary?.trim()) items.push({ kind: 'assistant', id: m.id, text: `**Summary of the conversation so far**\n\n${m.summary}`, done: true });
      if (Array.isArray(m.recent)) items.push(...itemsFromContext(m.recent as ContextMessage[], root));
    } else if (m.type === 'user') {
      const { text, attachments } = splitUserText(m.text ?? '');
      items.push({ kind: 'user', id: m.id, text, attachments });
    } else if (m.type === 'assistant') {
      // Ids as the live events make them (text and reasoning are numbered per kind within a
      // message), so a reply still being written carries on in the same item after a switch.
      let texts = 0;
      let thoughts = 0;
      (m.content ?? []).forEach((part, i) => {
        if (part.type === 'text') {
          const n = texts++;
          if (part.text?.trim()) items.push({ kind: 'assistant', id: `${m.id}:${n}`, text: part.text, done: true });
        } else if (part.type === 'reasoning') {
          const n = thoughts++;
          if (part.text?.trim()) items.push({ kind: 'thinking', id: `${m.id}:r${n}`, text: part.text, done: true, started: part.time?.created ?? 0, ended: part.time?.completed });
        } else if (part.type === 'tool') {
          const status = part.state?.status;
          const output = part.state?.content?.map((c) => c.text ?? '').join('\n') ?? '';
          const read = root ? readOf(root, part.name ?? '', part.state?.input, output) : null;
          items.push({
            kind: 'tool',
            id: part.id ?? `${m.id}:${i}`,
            name: part.name ?? 'tool',
            summary: read ? readLabel(read) : toolSummary(part.state?.input),
            input: part.state?.input,
            note: describeTool(part.name ?? 'tool', part.state?.input, NO_NAMES, output).note,
            ...(read ? { read: { path: read.path, from: read.start, to: read.start + read.lines.length - 1 } } : {}),
            status: status === 'error' || status === 'failed' ? 'failed' : status === 'running' || status === 'pending' ? 'running' : 'done',
            detail: (part.state?.error ?? part.state?.content?.map((c) => c.text ?? '').join('\n') ?? '').slice(0, 4000),
          });
        }
      });
    }
  }
  return items;
}

/**
 * The latest model call's prompt size (input plus cached tokens): how much of
 * the context window the conversation fills. (session.usage.updated carries
 * the session's running total instead, which overstates it.)
 */
export function contextTokens(messages: ContextMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = messages[i].tokens;
    if (messages[i].type !== 'assistant' || !t) continue;
    const total = (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0);
    if (total > 0) return total;
  }
  return null;
}
