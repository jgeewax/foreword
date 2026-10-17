// Plan mode: discuss and outline before writing (like Claude Code's plan mode).
// The session switches to OpenCode's `plan` agent, edits are denied by
// permission rules, and this instruction entry shapes the conversation (see modes.ts).

export const PLAN_INSTRUCTIONS = `# Planning mode

The author wants to think this through before anything is written. In this mode you must not edit, create, or delete files (edits are blocked); reading files is fine and encouraged.

Work in two stages:
1. Short form first. In two to four sentences, state the narrative or argument as you understand it: what this passage, section, or chapter needs to do, for whom, and why. Then give a numbered outline with one line per section, beat, or step. Finish with open questions and any alternatives you considered.
2. Then stop and ask which part to expand, change, or drop. When the author picks a part, expand only that part, in detail: its purpose, the key points in order, transitions in and out, examples or figures, and anything that must stay consistent with other chapters.

Be explicit about your reasoning and the trade-offs. Use plain prose and lists, not Typst code, unless asked. When the author is happy with the plan, they will switch back to writing mode and ask you to write it.`;

/** Sent by "Write it": leave plan mode and carry out the plan. */
export const WRITE_FROM_PLAN_PROMPT =
  "Let's write it now. Follow the plan we agreed above, in the book's voice and style guide, and edit the files directly. Afterwards, say in a sentence or two what you wrote and where.";
