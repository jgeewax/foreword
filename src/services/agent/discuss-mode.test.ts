import { describe, expect, it } from 'vitest';
import { directionsOf, DISCUSS_INSTRUCTIONS, DISCUSS_REMINDER, withoutDirections, WRITE_FROM_DISCUSSION_PROMPT } from './discuss-mode';

describe('discuss mode text', () => {
  it('reads first, gives its honest verdict, asks what would settle it, and argues back, in short turns', () => {
    expect(DISCUSS_INSTRUCTIONS).toMatch(/must not edit, create, or delete files/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/Read first/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/give your honest verdict in your first sentence/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/Don't open with praise/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/Push back/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/don't give way just because they pushed/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/Ask the question whose answer would settle it/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/No outline or plan unless the author asks for one/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/When something is settled, say so in a line/);
    expect(DISCUSS_REMINDER).toMatch(/talk in directions, not rewrites/);
  });

  it('talks in directions, not edits, and ends with them in a block the chat shows as cards', () => {
    expect(DISCUSS_INSTRUCTIONS).toMatch(/Talk in directions, not edits/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/no rewritten sentences, drafts, change blocks or Typst code/);
    expect(directionsOf(DISCUSS_INSTRUCTIONS)?.directions).toEqual([
      { name: 'Cut it', what: "Delete section 2.4, and move its one example into the proof in 2.3.", pick: true },
      { name: 'Give it a job', what: 'Keep 2.4, but open it with the question 2.5 answers, so it sets that up.', pick: false },
    ]);
  });

  it('still outlines when asked: the short form first, then the part picked', () => {
    expect(DISCUSS_INSTRUCTIONS).toMatch(/give the short form first/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/expand a part when they pick it/);
  });

  it('"Write it" says what was agreed, then writes it in the book voice, or says nothing was', () => {
    expect(WRITE_FROM_DISCUSSION_PROMPT).toMatch(/First say, in a few short lines, what we agreed/);
    expect(WRITE_FROM_DISCUSSION_PROMPT).toMatch(/style guide/);
    expect(WRITE_FROM_DISCUSSION_PROMPT).toMatch(/If we didn't settle on anything to write, say so/);
  });
});

describe('directions', () => {
  const reply = 'It mostly repeats 2.3.\n\n```directions\ndirection: Cut it | Delete 2.4. | *\ndirection: Give it a job | Open it with the question 2.5 answers.\n```\n';

  it('reads a reply’s directions, the pick marked, and leaves the block out of the reply shown', () => {
    expect(directionsOf(reply)).toEqual({
      directions: [
        { name: 'Cut it', what: 'Delete 2.4.', pick: true },
        { name: 'Give it a job', what: 'Open it with the question 2.5 answers.', pick: false },
      ],
      closed: true,
    });
    expect(withoutDirections(reply)).toBe('It mostly repeats 2.3.');
    expect(withoutDirections('A.\n```directions\ndirection: x | y\n```\nB.')).toBe('A.\n\nB.');
    expect(directionsOf('No block.')).toBeNull();
    expect(withoutDirections('No block.')).toBe('No block.');
  });

  it('takes them written loosely: a dash, bold, quotes, no key, a | inside what to do', () => {
    expect(directionsOf('```directions\n- **Cut it** | “Delete 2.4.”\nKeep it | Keep 2.4 | but shorter\n```')?.directions).toEqual([
      { name: 'Cut it', what: 'Delete 2.4.', pick: false },
      { name: 'Keep it', what: 'Keep 2.4 | but shorter', pick: false },
    ]);
    // A line without both halves isn't one; four at most.
    expect(directionsOf('```directions\ndirection: Just a name\n```')?.directions).toEqual([]);
    expect(directionsOf(`\`\`\`directions\n${'direction: a | b\n'.repeat(6)}\`\`\``)?.directions).toHaveLength(4);
  });

  it('while the block is still being written: hidden, with only its whole lines', () => {
    const partial = 'It repeats 2.3.\n```directions\ndirection: Cut it | Delete 2.4.\ndirection: Give it';
    expect(directionsOf(partial)).toEqual({ directions: [{ name: 'Cut it', what: 'Delete 2.4.', pick: false }], closed: false });
    expect(withoutDirections(partial)).toBe('It repeats 2.3.');
  });
});
