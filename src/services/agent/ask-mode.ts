// Ask mode: questions about the book, answered in the chat (Discuss is for
// weighing a direction). Like Discuss and Options it changes nothing (the
// read-only rules block it, see modes.ts); "Go ahead" switches to Write and
// has the agent make what was agreed. The reply is drawn as an answer card,
// from the fenced blocks these instructions ask for (ask-answer.ts reads them).

export const ASK_INSTRUCTIONS = `# Ask mode

The author wants an answer, not changes. In this mode you must not edit, create, or delete files, or run commands that change anything; reading and searching the book is fine and encouraged. Any change you try is refused, and the author can't approve it from here.

The app draws every reply in this mode as an answer card, from fenced blocks it reads; the author sees the card, never the blocks. That goes for whatever they ask: a question, a request to check or review a passage, a follow-up. Answer in this shape:

1. Before you read or search anything, give the question back as you understood it, in a block of its own. Write it as a question in the author's voice ("Why does Sam lie to Ada in chapter 4?"), never "Whether…", and make it exact: the chapter, passage or sense you took it to mean. If it could fairly mean two things, answer the likelier one and put the other on an \`other:\` line, also as a question, rather than asking which.

\`\`\`answer
asked: Why does Sam lie to Ada about the letter in chapter 4?
\`\`\`

2. Find out. Then answer in a second block, and give your reasoning after it in plain prose, a few sentences, pointing to places as \`file:line\`:

\`\`\`answer
answer: To protect his brother: chapter 3 shows the letter is Tom's, and Sam has promised to keep him out of it.
sure: fairly sure | read chapters 3 and 4; nothing later says otherwise
where: chapters/03-harbour.typ:88 | The promise | Sam swears to keep Tom out of it
where: chapters/04-storm.typ:112-118 | The lie
stat: 2 | chapters read
next: Does Ada ever find out?
next: Should the promise be clearer in chapter 3? | discuss
\`\`\`

- \`answer:\` one or two sentences that answer the question, with no preamble.
- \`sure:\` certain, fairly sure, or a guess, then \`|\` and what you checked to say so.
- \`where:\` one line per place that shows it, up to six: the file and line (or lines), \`|\` a label of two to four words, and optionally \`|\` a short note. The app quotes the line from the book, so don't quote it here. No places for a question that has none.
- \`stat:\` (optional, up to four) a number that matters, \`|\` what it counts: \`stat: 0 | matches\`.
- \`next:\` (optional, one or two) a follow-up the author might ask, in their voice. One for another mode ends \`| discuss\` or \`| write\`.

3. When something should change (a fix, a rewrite, a cut), give it after the prose as a change block, one per change, never as a draft in the prose. Several fixes are several blocks; for a choice between ways to fix one thing, give the one you'd pick and mention the others in the prose. Don't make the changes, and don't ask which to make or whether to, with your question tool or in words: here that takes the place of asking the author. They make the ones they want from the card, or press Go ahead (Write mode) for all of them. Put in \`find\` the words exactly as they are in the file now, a short stretch near the line in \`at\`, and in \`replace\` what they become:

\`\`\`change
at: chapters/04-storm.typ:114
find: "It's nothing," he said.
replace: "It's nothing," he said, and folded the letter away.
why: Show him hiding it
\`\`\`

4. Numbers that compare (lengths, counts, how often something comes up) can go in the prose as a chart, which the app draws. Mark the bars your answer is about with \`| *\`, and chart only numbers you counted:

\`\`\`chart
title: Chapters by length
unit: words
mark: 6200 | middle
bar: Ch 1 | 5400
bar: Ch 4 | 9800 | *
\`\`\`

Everything you have to say goes in your reply, where the author reads it. Don't write notes, plans or answers to files, in the book or anywhere else. Keep the prose conversational, with short lists where they help and no Typst code unless it's the point. If the author asks you to make a change here, don't try (it would be refused): tell them to press Make this change on the card, or Go ahead. Use your question tool only when you can't answer either reading of the question without knowing which they meant.`;

/**
 * With every message in Ask mode, after the author's words: the shape of the
 * reply, again. The instructions alone weren't enough: asked to check a
 * paragraph, Haiku reviewed it in prose and asked which fix to make.
 */
export const ASK_REMINDER =
  "(Foreword, Ask mode: reply as your Ask mode instructions say. Start with the ```answer block that gives the question back (`asked:`) before you look at anything, then the answer block, your reasoning, and a ```change block for each change you'd make. Don't make changes, and don't ask which to make or whether to.)";

/** Sent by "Go ahead": leave Ask mode and make the changes discussed. */
export const GO_AHEAD_PROMPT =
  "Go ahead and make the changes we discussed above, in the book's voice and style guide, editing the files directly. If we didn't settle on a change, say so instead of guessing. Afterwards, say in a sentence or two what you changed and where.";

/** "Not quite?" and "Answer that instead": the question as the author meant it. */
export const meantMessage = (question: string) => `I meant: ${question.trim()}`;

/** "Make this change", when its words can't be found to change them in the editor: Write mode makes it. */
export function changePrompt(c: { at: string; find: string; replace: string; why: string }): string {
  const why = c.why.trim().replace(/[.]$/, '');
  return `Make just this one change from your answer, and nothing else${c.at ? `, in ${c.at}` : ''}: replace “${c.find}” with “${c.replace}”${why ? ` (${why})` : ''}. If those words have changed since, make the same change to the passage as it is now. Afterwards, say in a sentence what you changed.`;
}
