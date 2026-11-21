import { describe, expect, it } from 'vitest';
import { isOptionCount, OPTIONS_INSTRUCTIONS, optionsReminder, parseOptions } from './options-mode';
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

describe('OPTIONS_INSTRUCTIONS', () => {
  it('forbids edits and asks for as many complete replacements as the author chose, in the parsable format', () => {
    expect(OPTIONS_INSTRUCTIONS).toMatch(/must not edit, create, or delete files/);
    expect(OPTIONS_INSTRUCTIONS).toMatch(/exactly as many alternative versions .* as the author chose: the app says how many with each message \(three options if it doesn't\)/);
    expect(OPTIONS_INSTRUCTIONS).toContain('### Option 1: <a two to five word label>\n```typst');
    expect(parseOptions(OPTIONS_INSTRUCTIONS.split('Use exactly this format:')[1]).options.length).toBeGreaterThanOrEqual(1);
  });
});

describe('how many options', () => {
  it('each message says, as a reminder the chat leaves out', () => {
    expect(optionsReminder(3)).toBe('(Foreword, Options mode: write exactly three options, Option 1 to Option 3, in the format your Options mode instructions give.)');
    expect(optionsReminder(1)).toBe('(Foreword, Options mode: write exactly one option, in the format your Options mode instructions give.)');
    expect(optionsReminder(5).startsWith(REMINDER_START)).toBe(true);
  });

  it('one to five', () => {
    expect([0, 1, 3, 5, 6, 2.5, '3'].map(isOptionCount)).toEqual([false, true, true, true, false, false, false]);
  });
});
