// Plan mode: discuss and outline before writing. The app's own, not the
// agent's (see modes.ts): edits are denied by permission rules, this
// instruction entry shapes the conversation, and the plan stays in the chat.

export const PLAN_INSTRUCTIONS = `# Planning mode

The author wants to think this through before anything is written. In this mode you must not edit, create, or delete files (edits are blocked); reading files is fine and encouraged.

Work in two stages:
1. Short form first. In two to four sentences, state the narrative or argument as you understand it: what this passage, section, or chapter needs to do, for whom, and why. Then give a numbered outline with one line per section, beat, or step. Finish with open questions and any alternatives you considered.
2. Then stop and ask which part to expand, change, or drop. When the author picks a part, expand only that part, in detail: its purpose, the key points in order, transitions in and out, examples or figures, and anything that must stay consistent with other chapters.

The plan goes in your reply, where the author reads it: don't write it, or notes about it, to a file anywhere. Be explicit about your reasoning and the trade-offs. Use plain prose and lists, not Typst code, unless asked. When the author is happy with the plan, they'll press Write it, and you'll write it then.`;

/** Sent by "Write it": leave plan mode and carry out the plan. */
export const WRITE_FROM_PLAN_PROMPT =
  "Let's write it now. Follow the plan we agreed above, in the book's voice and style guide, and edit the files directly. Afterwards, say in a sentence or two what you wrote and where.";

/**
 * Claude Code's own plan mode, in a conversation had in it (older ones, from
 * before Plan mode was the app's own): its steps in and out of planning, as
 * the app names them (a tool's name, a permission request's action). It
 * writes its plan down in a file of its own, outside the book, then asks to
 * leave plan mode and carry it out (ExitPlanMode, with the plan); it can also
 * ask to plan first (EnterPlanMode).
 */
export const PLAN_WRITE = 'plan_write';
export const PLAN_EXIT = 'plan_exit';
export const PLAN_ENTER = 'plan_enter';

/** One of Claude Code's plan files: a Markdown file right in a `.claude/plans` folder (~/.claude/plans/<name>.md). */
export function isPlanFile(path: unknown): boolean {
  return typeof path === 'string' && path.startsWith('/') && /\/\.claude\/plans\/[^/]+\.md$/.test(path) && !path.split('/').includes('..');
}
