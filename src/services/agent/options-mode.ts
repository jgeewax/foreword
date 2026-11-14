// Options mode: the agent offers alternative versions of the selected passage
// (as many as the author chose: optionCount in settings) instead of editing.
// Edits are blocked by permission rules; the reply format below is parsed into
// option cards, and the one the author picks replaces the selection in the
// editor (an ordinary, undoable buffer edit).

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

The author wants choices, not edits. In this mode you must not edit, create, or delete files (edits are blocked); reading files is fine. The app shows each option as a card, and the one the author picks replaces the passage they selected.

For each request, reply with exactly as many alternative versions of the selected passage (or, with no selection, of what they ask for: a title, a sentence to insert at the cursor, and so on) as the author chose: the app says how many with each message (${optionsInWords(DEFAULT_OPTION_COUNT)} if it doesn't). Use exactly this format:

One short sentence about your approach (optional).

### Option 1: <a two to five word label>
\`\`\`typst
<the full replacement for the selected passage>
\`\`\`
<one sentence on how this option differs>

### Option 2: <label>
…

and so on, one section for each option.

Rules:
- Each code block replaces the whole selected passage, so it must be complete Typst markup that can be pasted in its place. Keep its labels like <eq-name>, citations like @key, math and markup, and lay it out as the passage is: one sentence per line, at its indentation.
- Make the options meaningfully different from each other (for example in tone, length, or structure), and make every one follow the style guide. Asked for one option, write the best version you can.
- Write nothing after the last option.
- If the message isn't something to give options for (a question, say), answer it briefly and normally instead.`;

/** Sent with every message in Options mode, after the author's words: how many options to write. */
export const optionsReminder = (n: number) =>
  `(Foreword, Options mode: write exactly ${optionsInWords(n)}${n > 1 ? `, Option 1 to Option ${n}` : ''}, in the format your Options mode instructions give.)`;

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

export type ParsedOptions = { intro: string; options: ParsedOption[] };

const OPTION_HEADING = /^(?:#{1,4}\s*(?:\*\*)?|\*\*)Option\s+(\d+)(?:\*\*)?\s*(?:[:.)–—-]\s*)?(.*?)(?:\*\*)?\s*$/i;

/** Split a reply into its intro and "Option N" sections (tolerates bold headings and missing labels). */
export function parseOptions(reply: string): ParsedOptions {
  const lines = reply.replace(/\r\n?/g, '\n').split('\n');
  const intro: string[] = [];
  const sections: { n: number; label: string; body: string[] }[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence ? OPTION_HEADING.exec(line.trim()) : null;
    if (m) sections.push({ n: parseInt(m[1], 10), label: m[2].replace(/^\*\*|\*\*$/g, '').trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(line);
    else intro.push(line);
  }
  return {
    intro: intro.join('\n').trim(),
    options: sections.map(({ n, label, body }) => {
      const open = body.findIndex((l) => /^\s*(```|~~~)/.test(l));
      if (open < 0) return { n, label, text: null, complete: false, note: body.join('\n').trim() };
      const fence = body[open].trim().slice(0, 3);
      const close = body.findIndex((l, i) => i > open && l.trim().startsWith(fence));
      const code = body.slice(open + 1, close < 0 ? undefined : close);
      const note = close < 0 ? [] : [...body.slice(0, open), ...body.slice(close + 1)];
      return { n, label, text: code.join('\n'), complete: close >= 0, note: note.join('\n').trim() };
    }),
  };
}
