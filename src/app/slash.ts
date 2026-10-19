// Slash commands in the chat's message box: "/plan", "/new", "/model sonnet"…
// Typing "/" at the start lists them; they act on the app, never reach the model.

export type SlashCommand = {
  name: string;
  /** What follows the name, if anything ("model name"). */
  arg?: string;
  description: string;
  /** Runs as soon as it's picked (no argument to type). */
  immediate: boolean;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'write', description: 'Write mode: the assistant writes and edits the book', immediate: true },
  { name: 'plan', description: 'Plan mode: talk it through and outline first, no changes', immediate: true },
  { name: 'options', description: 'Options mode: three versions of a passage to pick from', immediate: true },
  { name: 'figures', description: 'Figures mode: diagrams and plots in Typst (CeTZ, fletcher, lilaq)', immediate: true },
  { name: 'new', description: 'Start a new task (a new conversation)', immediate: true },
  { name: 'done', description: 'This task is done: save a named version, start a new one', immediate: true },
  { name: 'compact', description: 'Summarize this conversation so far, to free up room', immediate: true },
  { name: 'stop', description: 'Stop the assistant', immediate: true },
  { name: 'resume', description: 'Carry on where it stopped', immediate: true },
  { name: 'model', arg: 'name', description: 'Switch model (e.g. /model sonnet)', immediate: false },
  { name: 'effort', arg: 'level', description: 'How hard the model thinks (e.g. /effort high)', immediate: false },
  { name: 'assistant', arg: 'name', description: 'Switch assistant: OpenCode, Claude Code, Gemini CLI, Codex or Antigravity (a new conversation)', immediate: false },
  { name: 'permissions', arg: 'ask | edit | readonly', description: 'Ask first, Edit freely, or Read-only', immediate: false },
  { name: 'fix', description: 'Fix all open review comments', immediate: true },
  { name: 'export', description: 'Export the book to PDF', immediate: true },
  { name: 'pdf', description: 'Open the exported PDF', immediate: true },
  { name: 'help', description: 'What these commands do', immediate: true },
];

/** "/model son" → { name: "model", arg: "son" }; null if it isn't a command line. */
export function parseSlash(text: string): { name: string; arg: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? { name: m[1].toLowerCase(), arg: (m[2] ?? '').trim() } : null;
}

/** Commands for the list while typing "/…" (the name typed so far, before any space). */
export function slashMatches(text: string): SlashCommand[] {
  const m = /^\/([a-z]*)$/i.exec(text);
  if (!m) return [];
  const typed = m[1].toLowerCase();
  const byName = [...SLASH_COMMANDS.filter((c) => c.name.startsWith(typed)), ...SLASH_COMMANDS.filter((c) => !c.name.startsWith(typed) && c.name.includes(typed))];
  // Descriptions only when no name fits ("/conversation" finds /new).
  return byName.length ? byName : SLASH_COMMANDS.filter((c) => c.description.toLowerCase().includes(typed));
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
