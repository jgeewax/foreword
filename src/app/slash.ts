// Slash commands in the chat's message box: "/discuss", "/new", "/model sonnet"…
// Typing "/" lists them (mid-message too); they act on the app, never reach the model.

export type SlashCommand = {
  name: string;
  /** What follows the name, if anything ("model name"). */
  arg?: string;
  description: string;
  /** Runs as soon as it's picked (no argument to type). */
  immediate: boolean;
  /** Old names it still answers to ("/plan" for /discuss). */
  aliases?: string[];
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'write', description: 'Write mode: the assistant writes and edits the book', immediate: true },
  { name: 'ask', description: 'Ask mode: questions about the book, answered in the chat, no changes', immediate: true },
  { name: 'discuss', description: 'Discuss mode: think a direction through before writing, no changes', immediate: true, aliases: ['plan'] },
  { name: 'options', description: 'Options mode: three versions of a passage to pick from', immediate: true },
  { name: 'figures', description: 'Figures mode: diagrams and plots in Typst (CeTZ, fletcher, lilaq)', immediate: true },
  { name: 'new', description: 'Start a new task (a new conversation)', immediate: true },
  { name: 'done', description: 'This task is done: save a named version, start a new one', immediate: true },
  { name: 'compact', description: 'Summarize this conversation so far, to free up room', immediate: true },
  { name: 'stop', description: 'Stop the assistant', immediate: true },
  { name: 'resume', description: 'Carry on where it stopped', immediate: true },
  { name: 'model', arg: 'name', description: 'Switch model (e.g. /model sonnet)', immediate: false },
  { name: 'effort', arg: 'level', description: 'How hard the model thinks (e.g. /effort high)', immediate: false },
  { name: 'assistant', arg: 'name', description: 'Switch assistant: OpenCode, Claude Code, Gemini CLI, Codex or Antigravity (the chat carries on with it)', immediate: false },
  { name: 'permissions', arg: 'ask | edit | readonly', description: 'Ask first, Edit freely, or Read-only', immediate: false },
  { name: 'fix', description: 'Fix all open review comments', immediate: true },
  { name: 'export', description: 'Export the book to PDF', immediate: true },
  { name: 'pdf', description: 'Open the exported PDF', immediate: true },
  { name: 'help', description: 'What these commands do', immediate: true },
];

const names = (c: SlashCommand) => [c.name, ...(c.aliases ?? [])];

/** "/model son" → { name: "model", arg: "son" }; an old name gives the command's ("/plan" → "discuss"); null if it isn't a command line. */
export function parseSlash(text: string): { name: string; arg: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  return { name: SLASH_COMMANDS.find((c) => c.aliases?.includes(name))?.name ?? name, arg: (m[2] ?? '').trim() };
}

/** The "/name" being typed at the caret: where the box starts or after a space, and not in the middle of a word. */
export type SlashToken = { from: number; to: number; typed: string; alone: boolean };

export function slashToken(text: string, caret = text.length): SlashToken | null {
  const m = /(?:^|\s)\/([a-z]*)$/i.exec(text.slice(0, caret));
  if (!m || /^\S/.test(text.slice(caret))) return null;
  const from = caret - m[1].length - 1;
  // Alone: nothing else in the box, so a command with an argument can be typed out.
  return { from, to: caret, typed: m[1].toLowerCase(), alone: !text.slice(0, from).trim() && !text.slice(caret).trim() };
}

/**
 * Commands for the list while typing "/…" (the name typed so far, before any space).
 * In the middle of a message, only the ones that run at once: the message stays.
 */
export function slashMatches(text: string, caret = text.length): SlashCommand[] {
  const token = slashToken(text, caret);
  if (!token) return [];
  const { typed } = token;
  const pool = token.alone ? SLASH_COMMANDS : SLASH_COMMANDS.filter((c) => c.immediate);
  const starts = (c: SlashCommand) => names(c).some((n) => n.startsWith(typed));
  const byName = [...pool.filter(starts), ...pool.filter((c) => !starts(c) && names(c).some((n) => n.includes(typed)))];
  // Descriptions only when no name fits ("/conversation" finds /new).
  return byName.length ? byName : pool.filter((c) => c.description.toLowerCase().includes(typed));
}

/** The message with a picked "/name" taken out, and where the caret goes. */
export function withoutSlash(text: string, token: SlashToken): { text: string; caret: number } {
  const before = text.slice(0, token.from);
  const after = text.slice(token.to);
  if (!after.trim()) return { text: before.trimEnd(), caret: before.trimEnd().length };
  // "rewrite /discuss this" → "rewrite this".
  return { text: before + after.replace(/^[ \t]+/, ''), caret: before.length };
}

export const PERMISSION_WORDS: Record<string, 'ask' | 'edit' | 'readonly'> = {
  ask: 'ask',
  'ask-first': 'ask',
  edit: 'edit',
  'edit-freely': 'edit',
  freely: 'edit',
  readonly: 'readonly',
  'read-only': 'readonly',
  read: 'readonly',
};
