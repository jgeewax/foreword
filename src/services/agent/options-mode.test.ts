import { describe, expect, it } from 'vitest';
import { isOptionCount, OPTIONS_INSTRUCTIONS, optionsReminder, parseOptions, withoutAnchor } from './options-mode';
import { REMINDER_START } from './message-context';

const REPLY = `Three ways to tighten it.

### Option 1: Shorter
\`\`\`typst
The eigenvalues of $A$ are the roots of $p(lambda)$.
\`\`\`
Cuts the sentence to its core.

### Option 2 — Warmer
\`\`\`typst
Here's the key fact:
the eigenvalues of $A$ are exactly the roots of $p(lambda)$ @axler2015.
\`\`\`
Adds a friendly lead-in and keeps the citation.

**Option 3: Formal**
\`\`\`
We observe that each eigenvalue of $A$ is a root of $p(lambda)$.
\`\`\``;

describe('parseOptions', () => {
  it('splits intro, labels, replacement text and notes', () => {
    const { intro, options } = parseOptions(REPLY);
    expect(intro).toBe('Three ways to tighten it.');
    expect(options.map((o) => [o.n, o.label, o.complete])).toEqual([
      [1, 'Shorter', true],
      [2, 'Warmer', true],
      [3, 'Formal', true],
    ]);
    expect(options[0].text).toBe('The eigenvalues of $A$ are the roots of $p(lambda)$.');
    expect(options[1].text).toBe("Here's the key fact:\nthe eigenvalues of $A$ are exactly the roots of $p(lambda)$ @axler2015.");
    expect(options[1].note).toBe('Adds a friendly lead-in and keeps the citation.');
    expect(options[2].note).toBe('');
  });

  it('marks a still-streaming option incomplete', () => {
    const { options } = parseOptions('### Option 1: Short\n```typst\nhalf of it');
    expect(options).toEqual([{ n: 1, label: 'Short', text: 'half of it', complete: false, note: '' }]);
  });

  it('ignores "Option" lines inside code blocks and replies without options', () => {
    expect(parseOptions('```\n### Option 1: not a heading\n```').options).toEqual([]);
    expect(parseOptions('The trace is the sum of the diagonal entries.').options).toEqual([]);
  });

  it('keeps an option with no code block as text-less', () => {
    expect(parseOptions('### Option 1\nJust prose.').options[0]).toMatchObject({ n: 1, label: '', text: null });
  });

  // Asked for code in a box: the option holds a raw block, with its own fences.
  const CODE = '  In NumPy, that whole formula is a one-liner:\n\n  ```python\n  Xc = X - X.mean(axis=0)\n  Xc.T @ Xc / (len(X) - 1)\n  ```';
  const WITH_CODE = `Each one adds the code.\n\n### Option 1: Mirror the Variance box\n\`\`\`typst\n${CODE}\n\`\`\`\nEchoes the Variance box.\n\n### Option 2: Wrap it\n\`\`\`typst\n#note[\n  \`\`\`python\n  def covariance(X): ...\n  \`\`\`\n]\n\`\`\`\nReusable.`;

  it('keeps a raw block in an option: its fences are the option’s text, not its end', () => {
    const { options } = parseOptions(WITH_CODE);
    expect(options.map((o) => [o.n, o.label, o.complete, o.note])).toEqual([
      [1, 'Mirror the Variance box', true, 'Echoes the Variance box.'],
      [2, 'Wrap it', true, 'Reusable.'],
    ]);
    expect(options[0].text).toBe(CODE);
    expect(options[1].text).toBe('#note[\n  ```python\n  def covariance(X): ...\n  ```\n]');
  });

  it('an option still coming isn’t complete inside its raw block, or after it', () => {
    for (const upTo of ['```python', 'Xc.T @ Xc', '- 1)\n  ```']) {
      const text = WITH_CODE.slice(0, WITH_CODE.indexOf(upTo) + upTo.length);
      expect(parseOptions(text).options[0]).toMatchObject({ complete: false, note: '' });
    }
  });

  it('a longer outer fence, as Markdown has it, holds the raw block too', () => {
    expect(parseOptions(`### Option 1\n\`\`\`\`typst\n${CODE}\n\`\`\`\`\nNote.`).options[0]).toMatchObject({ text: CODE, complete: true, note: 'Note.' });
  });

  it('an "Option" line in a raw block inside an option isn’t a heading', () => {
    const { options } = parseOptions('### Option 1\n```typst\n```text\n### Option 2: not one\n```\n```\nNote.');
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ text: '```text\n### Option 2: not one\n```', note: 'Note.' });
  });
});

describe('what the options replace', () => {
  const ANCHOR = '```replaces\nat: chapters/02-spaces.typ:140-141\nfind:\nThe span of a list.\n  at: an indented line that isn’t a key\n```';

  it('the replaces block is the reply’s anchor, not part of its intro', () => {
    const parsed = parseOptions(`Two ways.\n\n${ANCHOR}\n\n${REPLY.split('\n\n').slice(1).join('\n\n')}`);
    expect(parsed.anchor).toEqual({ at: 'chapters/02-spaces.typ:140-141', find: 'The span of a list.\n  at: an indented line that isn’t a key', complete: true });
    expect(parsed.intro).toBe('Two ways.');
    expect(parsed.options.map((o) => o.label)).toEqual(['Shorter', 'Warmer', 'Formal']);
  });

  it('on one line, in backticks, or with nothing to replace (an insertion: line and column)', () => {
    expect(parseOptions('```replaces\nat: `ch.typ:3`\nfind: One sentence.\n```').anchor).toEqual({ at: 'ch.typ:3', find: 'One sentence.', complete: true });
    expect(parseOptions('```replaces\nat: ch.typ:147:1\nfind:\n```\n### Option 1\n```typst\nNew.\n```').anchor).toEqual({ at: 'ch.typ:147:1', find: '', complete: true });
  });

  it('put in an option by mistake: still the anchor, never the option’s text', () => {
    const { anchor, options } = parseOptions(`### Option 1: Short\n${ANCHOR}\n\`\`\`typst\nShort.\n\`\`\`\nNote.`);
    expect(anchor?.at).toBe('chapters/02-spaces.typ:140-141');
    expect(options[0]).toMatchObject({ text: 'Short.', note: 'Note.', complete: true });
  });

  it('still coming: not complete; and a reply without one has none', () => {
    expect(parseOptions('```replaces\nat: ch.typ:3\nfind:\nThe sp').anchor).toEqual({ at: 'ch.typ:3', find: 'The sp', complete: false });
    expect(parseOptions(REPLY).anchor).toBeNull();
  });

  it('isn’t shown: the reply without it', () => {
    expect(withoutAnchor(`Two ways.\n\n${ANCHOR}\n\n### Option 1\n\`\`\`typst\nA.\n\`\`\``)).toBe('Two ways.\n\n### Option 1\n```typst\nA.\n```');
    expect(withoutAnchor('Thinking.\n\n```replaces\nat: ch.typ:3\nfind:\nThe sp')).toBe('Thinking.');
    expect(withoutAnchor(REPLY)).toBe(REPLY);
  });
});

describe('OPTIONS_INSTRUCTIONS', () => {
  it('forbids edits and asks for as many complete replacements as the author chose, in the parsable format', () => {
    expect(OPTIONS_INSTRUCTIONS).toMatch(/must not edit, create, or delete files/);
    expect(OPTIONS_INSTRUCTIONS).toMatch(/exactly as many alternative versions of the passage the author means as they chose: the app says how many with each message \(three options if it doesn't\)/);
    expect(OPTIONS_INSTRUCTIONS).toContain('### Option 1: <a two to five word label>\n```typst');
    const format = parseOptions(OPTIONS_INSTRUCTIONS.split('Use exactly this format:')[1].split('Rules:')[0]);
    expect(format.options.length).toBeGreaterThanOrEqual(1);
    // Where they go, as the example says it.
    expect(format.anchor).toMatchObject({ at: 'chapters/02-spaces.typ:140-141', complete: true });
    expect(format.anchor?.find).toMatch(/^The span of a list .*\nIn other words, .*list\.$/);
  });

  it('says the options go where the reply says, and how to say an insertion', () => {
    expect(OPTIONS_INSTRUCTIONS).toMatch(/goes in where your reply says, in place of the passage it names: nowhere else, whatever the cursor is doing/);
    expect(OPTIONS_INSTRUCTIONS).toMatch(/leave `find` empty and give the line and column it goes at: `at: chapters\/02-spaces\.typ:147:1`/);
  });
});

describe('how many options', () => {
  it('each message says, as a reminder the chat leaves out', () => {
    const start = '(Foreword, Options mode: start with the ```replaces block that says what they replace (`at:` the file and line, `find:` the passage exactly as it is in the file), then write exactly';
    expect(optionsReminder(3)).toBe(`${start} three options, Option 1 to Option 3, in the format your Options mode instructions give.)`);
    expect(optionsReminder(1)).toBe(`${start} one option, in the format your Options mode instructions give.)`);
    expect(optionsReminder(5).startsWith(REMINDER_START)).toBe(true);
  });

  it('one to five', () => {
    expect([0, 1, 3, 5, 6, 2.5, '3'].map(isOptionCount)).toEqual([false, true, true, true, false, false, false]);
  });
});
