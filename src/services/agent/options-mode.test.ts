import { describe, expect, it } from 'vitest';
import { OPTIONS_INSTRUCTIONS, parseOptions } from './options-mode';

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
});

describe('OPTIONS_INSTRUCTIONS', () => {
  it('forbids edits and asks for three complete replacements in the parsable format', () => {
    expect(OPTIONS_INSTRUCTIONS).toMatch(/must not edit, create, or delete files/);
    expect(OPTIONS_INSTRUCTIONS).toMatch(/exactly 3 alternative versions/);
    expect(OPTIONS_INSTRUCTIONS).toContain('### Option 1: <a two to five word label>\n```typst');
    expect(parseOptions(OPTIONS_INSTRUCTIONS.split('Use exactly this format:')[1]).options.length).toBeGreaterThanOrEqual(1);
  });
});
