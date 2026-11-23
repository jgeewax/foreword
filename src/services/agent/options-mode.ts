// Options mode: the agent offers alternative versions of a passage (as many as
// the author chose: optionCount in settings) instead of editing. Edits are
// blocked by permission rules; the reply format below is parsed into option
// cards. The reply says what its options replace (a ```replaces block: the file
// and line, and the passage's words exactly), and the one the author picks goes
// there in the editor (an ordinary, undoable buffer edit), not at the cursor.
import { closingFence, fenceOf } from './fences';

/** How many options the author can ask for, and how many until they choose. */
export const OPTION_COUNTS = [1, 2, 3, 4, 5];
export const DEFAULT_OPTION_COUNT = 3;

export const isOptionCount = (n: unknown): n is number => typeof n === 'number' && OPTION_COUNTS.includes(n);

const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five'];

/** "three options", "one option": in the words of a message. */
export const optionsInWords = (n: number) => `${NUMBER_WORDS[n - 1] ?? n} ${n === 1 ? 'option' : 'options'}`;

/** "3 options", "1 option": on a button or a note. */
export const optionsLabel = (n: number) => `${n} ${n === 1 ? 'option' : 'options'}`;

// The count isn't in these (they're the session's instructions, and changing
// them means a new system prompt): each message says it (optionsReminder).
export const OPTIONS_INSTRUCTIONS = `# Options mode

The author wants choices, not edits. In this mode you must not edit, create, or delete files (edits are blocked); reading files is fine. The app shows each option as a card, and the one the author picks goes in where your reply says, in place of the passage it names: nowhere else, whatever the cursor is doing.

For each request, reply with exactly as many alternative versions of the passage the author means as they chose: the app says how many with each message (${optionsInWords(DEFAULT_OPTION_COUNT)} if it doesn't). The passage is the one they selected; with nothing selected, the one you've been talking about, or what they ask for (a title, a sentence to insert at the cursor, and so on). Use exactly this format:

One short sentence about your approach (optional).

\`\`\`replaces
at: chapters/02-spaces.typ:140-141
find:
The span of a list is the set of all its linear combinations.
In other words, it is the smallest subspace that contains every vector in the list.
\`\`\`

### Option 1: <a two to five word label>
\`\`\`typst
<the full replacement for the passage in find>
\`\`\`
<one sentence on how this option differs>

### Option 2: <label>
…

and so on, one section for each option.

Rules:
- Start with the replaces block, once: it's where the options go, and without it none can. \`at\`: the file and its lines. \`find\`: the whole passage the options replace, all of it and nothing more, copied exactly from the file as it is now (every character, with its indentation and line breaks; read the file first if you haven't got it word for word). With a selection, that's the selection. To put an option in without replacing anything (at the cursor, say), leave \`find\` empty and give the line and column it goes at: \`at: chapters/02-spaces.typ:147:1\`.
- Each code block replaces the whole of \`find\`, so it must be complete Typst markup that can be pasted in its place. Keep its labels like <eq-name>, citations like @key, math and markup, and lay it out as the passage is: one sentence per line, at its indentation.
- Work out what the passage needs first (How to revise, steps 1 and 2). Then make each option a different way to give it that, an editor's different move (lead with the point, cut to what matters, recast the rhythm, shift the emphasis, rebuild the order), not the same version reworded; label it by its move. Every one follows the style guide and passes How to revise's check (step 5). Asked for one option, write the best version you can.
- Write nothing after the last option.
- If the message isn't something to give options for (a question, say), answer it briefly and normally instead.`;

/** Sent with every message in Options mode, after the author's words: how many options to write. */
export const optionsReminder = (n: number) =>
  `(Foreword, Options mode: start with the \`\`\`replaces block that says what they replace (\`at:\` the file and line, \`find:\` the passage exactly as it is in the file), then write exactly ${optionsInWords(n)}${n > 1 ? `, Option 1 to Option ${n}` : ''}, in the format your Options mode instructions give.)`;

/**
 * What a reply's options replace, as it says (its ```replaces block): `at`, the
 * file and line as written (`chapters/two.typ:140-146`, `…:147:1`); `find`,
 * the passage's words as they are in the file, or empty when the options go in
 * at `at` without replacing anything.
 */
export type OptionsAnchor = { at: string; find: string; complete: boolean };

export type ParsedOption = {
  /** 1-based number as the agent wrote it. */
  n: number;
  label: string;
  /** Replacement text from the first code block, or null if there's none (yet). */
  text: string | null;
  /** Whether the code block is closed (the option is complete). */
  complete: boolean;
  note: string;
};

export type ParsedOptions = { intro: string; options: ParsedOption[]; anchor: OptionsAnchor | null };

const OPTION_HEADING = /^(?:#{1,4}\s*(?:\*\*)?|\*\*)Option\s+(\d+)(?:\*\*)?\s*(?:[:.)–—-]\s*)?(.*?)(?:\*\*)?\s*$/i;

/** A replaces block's body: `at:` (on its line), then `find:` and every line after it as written (a passage line that starts "at:" stays its own). */
function anchorOf(body: string[], complete: boolean): OptionsAnchor {
  const key = (l: string, k: string) => new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?\\**${k}\\**[ \\t]*:[ \\t]?(.*)$`, 'i').exec(l);
  const f = body.findIndex((l) => key(l, 'find'));
  const head = f < 0 ? body : body.slice(0, f);
  const at = head.map((l) => key(l, 'at')?.[1]).find((v) => v != null) ?? '';
  const find = f < 0 ? '' : [key(body[f], 'find')![1], ...body.slice(f + 1)].join('\n').replace(/^[ \t]*\n/, '').replace(/\n+$/, '');
  return { at: at.trim().replace(/^`(.*)`$/, '$1'), find, complete };
}

/** The reply without its ```replaces block (still coming, or there's no option in it to show). */
export function withoutAnchor(reply: string): string {
  if (!/replaces/i.test(reply)) return reply;
  const lines = reply.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = fenceOf(lines[i]);
    const close = fence ? closingFence(lines, i) : i;
    const end = close < 0 ? lines.length - 1 : close;
    if (!fence || !/^replaces$/i.test(fence.info)) out.push(...lines.slice(i, end + 1));
    i = end;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Split a reply into its intro and "Option N" sections (tolerates bold headings
 * and missing labels). An option's text is its first code block, raw blocks it
 * holds and all (fences.ts). The ```replaces block, before the options (or in
 * one, if the assistant put it there), is the reply's anchor, not shown, and
 * never an option's text: the first one counts.
 */
export function parseOptions(reply: string): ParsedOptions {
  const lines = reply.replace(/\r\n?/g, '\n').split('\n');
  const intro: string[] = [];
  const sections: { n: number; label: string; body: string[] }[] = [];
  let anchor: OptionsAnchor | null = null;
  for (let i = 0; i < lines.length; i++) {
    // A code block goes in whole: an "Option" line in it isn't a heading.
    const fence = fenceOf(lines[i]);
    const close = fence ? closingFence(lines, i) : i;
    const end = close < 0 ? lines.length - 1 : close;
    const m = end === i ? OPTION_HEADING.exec(lines[i].trim()) : null;
    if (fence && /^replaces$/i.test(fence.info)) anchor ??= anchorOf(lines.slice(i + 1, close < 0 ? undefined : close), close >= 0);
    else if (m) sections.push({ n: parseInt(m[1], 10), label: m[2].replace(/^\*\*|\*\*$/g, '').trim(), body: [] });
    else (sections.length ? sections[sections.length - 1].body : intro).push(...lines.slice(i, end + 1));
    i = end;
  }
  return {
    anchor,
    intro: intro.join('\n').trim(),
    options: sections.map(({ n, label, body }) => {
      const open = body.findIndex((l) => fenceOf(l));
      if (open < 0) return { n, label, text: null, complete: false, note: body.join('\n').trim() };
      const close = closingFence(body, open);
      const code = body.slice(open + 1, close < 0 ? undefined : close);
      const note = close < 0 ? [] : [...body.slice(0, open), ...body.slice(close + 1)];
      return { n, label, text: code.join('\n'), complete: close >= 0, note: note.join('\n').trim() };
    }),
  };
}
