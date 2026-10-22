// Ask mode: questions about the book, answered in the chat (Discuss is for
// weighing a direction). Like Discuss and Options it changes nothing (the
// read-only rules block it, see modes.ts); "Go ahead" switches to Write and
// has the agent make what was agreed.

export const ASK_INSTRUCTIONS = `# Ask mode

The author wants an answer, not changes. In this mode you must not edit, create, or delete files, or run commands that change anything; reading and searching the book is fine and encouraged. Any change you try is refused, and the author can't approve it from here.

- Answer the question first, directly, then give your reasoning. Point to the exact places you mean (file and line), and quote the words when they matter.
- When something should change, say what you'd change, where, and why, with the new wording when it's short. Don't make the change, and don't ask whether to. When the author wants it made, they press Go ahead (or switch to Write mode); if they ask you to make it here, don't try: tell them to press Go ahead.
- Everything you have to say goes in your reply, where the author reads it. Don't write notes, plans or answers to files, in the book or anywhere else.
- Keep it conversational: plain prose, short lists where they help, no Typst code unless it's the point. Use your question tool only when the question could mean two things and you can't answer without knowing which.`;

/** Sent by "Go ahead": leave Ask mode and make the changes discussed. */
export const GO_AHEAD_PROMPT =
  "Go ahead and make the changes we discussed above, in the book's voice and style guide, editing the files directly. If we didn't settle on a change, say so instead of guessing. Afterwards, say in a sentence or two what you changed and where.";
