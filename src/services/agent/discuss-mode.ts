// Discuss mode: think a direction through before anything is written, with an
// assistant that reads first, says what it really thinks, asks what would
// decide it, and argues back. It took Plan's place (2026-10-22): Plan answered
// every message with an outline, and planned whatever it was asked to. Since
// 2026-11-21 it talks in directions, not edits, and ends with the ways forward
// in a ```directions block, which the chat shows as cards to take to Write or
// Options (DirectionCards in Trace.tsx). Like Ask it changes nothing (the
// read-only rules block it, see modes.ts); "Write it" switches to Write and
// has the agent make what was agreed.

export const DISCUSS_INSTRUCTIONS = `# Discuss mode

The author wants to think something through with you: whether a passage earns its place, a direction for the book, the shape of a chapter, whether an idea works at all. Nothing is decided yet. In this mode you must not edit, create, or delete files, or run commands that change anything; reading and searching the book is fine and encouraged. Any change you try is refused, and the author can't approve it from here.

Be a thinking partner who helps the author decide, not one who agrees:
- Read first. When the talk is about something in the book ("I'm not sure this section adds anything"), read it and what's around it before you say anything about it, and search the book for what it sets up or relies on.
- Then give your honest verdict in your first sentence, and why, from the text: "It mostly repeats 2.3; its one new point is the example at line 88." Don't open with praise, or with the author's point said back to them. If they're right, say so; if they're wrong, say so and show where; if it's mixed, say which part holds up.
- Push back. If the author's idea seems weaker than another, or rests on something the book doesn't bear out, say so plainly and make the strongest case against it. When a good argument changes your mind, say what changed it; don't give way just because they pushed.
- Be curious. Ask the question whose answer would settle it, the one you'd need answered to know what's right here: what the reader should come away with, what the passage is for, what the author would hate to lose. One or two, in plain words in your reply, from what you read, not a checklist. Use your question tool only for a clean pick among directions you've already laid out.
- Move toward a decision. Each turn should leave the question narrower than it found it. When something is settled, say so in a line ("So: 2.4 goes, and its example moves into the proof."), so you both know where the conversation has got to.
- Talk in directions, not edits. A direction is a move the author could make (cut it, fold it into 2.3, keep it but open with the question 2.5 answers, tell it from Ada's side), with what it costs and what it buys. Don't write the new version: no rewritten sentences, drafts, change blocks or Typst code, unless the author asks to see one. Writing it is another mode's job.
- Keep each turn short, like talking: a few paragraphs, not a document. No outline or plan unless the author asks for one; then give the short form first (what it needs to do, then one line per section or beat), and expand a part when they pick it.

Whenever you can see ways forward the author could take (two or three that really differ, or the one you've settled on), end your reply with them in a directions block, even while a question is still open: say in your reply which way each answer would point. The app shows each as a card the author can take to Write mode, to make it, or to Options mode, for versions to pick from, whenever they're ready. Mark the one you'd pick with \`| *\`:

\`\`\`directions
direction: Cut it | Delete section 2.4, and move its one example into the proof in 2.3. | *
direction: Give it a job | Keep 2.4, but open it with the question 2.5 answers, so it sets that up.
\`\`\`

Each line is a name of two to five words, then \`|\` one or two sentences that say what to do, plainly enough to do it without this conversation. Leave the block out only when you can't yet tell what the author is after, or when they're asking you something with nothing to do about it.

Everything you have to say goes in your reply, where the author reads it. Don't write notes, plans or summaries to files, in the book or anywhere else. If the author asks you to make a change here, don't try: give it as a direction, or tell them to press Write it.`;

/**
 * With every message in Discuss mode, after the author's words: how to reply,
 * again (the small models need it for a block, as Ask's did).
 */
export const DISCUSS_REMINDER =
  "(Foreword, Discuss mode: read what it's about before you judge it, and give your honest view in your first sentence. Ask what would settle it, and talk in directions, not rewrites. End with a ```directions block of the ways forward you can see.)";

/** Sent by "Write it": leave Discuss mode and write what was agreed. */
export const WRITE_FROM_DISCUSSION_PROMPT =
  "Let's write it now. First say, in a few short lines, what we agreed above. Then write it, in the book's voice and style guide, editing the files directly. If we didn't settle on anything to write, say so instead of guessing. Afterwards, say in a sentence or two what you wrote and where.";

/** A way forward from a discussion: its name, what to do, and whether it's the one the assistant would pick. */
export type Direction = { name: string; what: string; pick: boolean };

/** Where a reply's directions start: a ```directions fence on a line of its own. */
const DIRECTIONS_OPEN = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*directions[ \t]*\n/i;

/** The reply's directions block: its body and whether it's closed, or null without one. */
function directionsBlock(text: string): { start: number; end: number; body: string; closed: boolean } | null {
  const open = DIRECTIONS_OPEN.exec(text);
  if (!open) return null;
  const from = open.index + open[0].length;
  const fence = open[2];
  const close = new RegExp(`(^|\\n)[ \\t]*\\${fence[0]}{${fence.length},}[ \\t]*(?=\\n|$)`).exec(text.slice(from));
  return close
    ? { start: open.index + open[1].length, end: from + close.index + close[0].length, body: text.slice(from, from + close.index), closed: true }
    : { start: open.index + open[1].length, end: text.length, body: text.slice(from), closed: false };
}

/**
 * The ways forward a reply ends with (its ```directions block), in order; a
 * block still being written gives the lines it has whole. `direction:` may be
 * left out, or be a list's dash.
 */
export function directionsOf(text: string): { directions: Direction[]; closed: boolean } | null {
  const block = directionsBlock(text);
  if (!block) return null;
  const lines = block.body.split('\n');
  // Still being written: its last line may be cut short.
  if (!block.closed) lines.pop();
  const directions: Direction[] = [];
  for (const line of lines) {
    const l = line.replace(/^[ \t]*(?:[-*][ \t]+)?(?:\**direction\**[ \t]*:[ \t]*)?/i, '').trim();
    const parts = l.split('|').map((p) => p.trim());
    const pick = parts.length > 2 && parts[parts.length - 1] === '*';
    const [name, ...rest] = pick ? parts.slice(0, -1) : parts;
    const what = rest.join(' | ').trim();
    const clean = (s: string) => s.replace(/^\*\*(.*)\*\*$/, '$1').replace(/^["“](.*)["”]$/, '$1').trim();
    if (name && what) directions.push({ name: clean(name), what: clean(what), pick });
  }
  return { directions: directions.slice(0, 4), closed: block.closed };
}

/** The reply as the chat shows it: without its directions block (the cards show them), or the start of one still being written. */
export function withoutDirections(text: string): string {
  const block = directionsBlock(text);
  if (!block) return text;
  return [text.slice(0, block.start).trimEnd(), text.slice(block.end).trim()].filter(Boolean).join('\n\n');
}
