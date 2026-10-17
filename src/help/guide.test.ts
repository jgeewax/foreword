import { describe, expect, it } from 'vitest';
import { GUIDE, isBlockSnippet, snippetInsertion } from './guide';

describe('Typst basics guide', () => {
  it('has plain-language text for every item, and examples for most', () => {
    const items = GUIDE.sections.flatMap((s) => s.items);
    expect(items.length).toBeGreaterThan(12);
    for (const i of items) expect(i.text.length, i.title).toBeGreaterThan(20);
    expect(items.filter((i) => i.code).length).toBeGreaterThan(10);
    // Only markup patterns are insertable, and they all have code.
    for (const i of items.filter((x) => x.insert)) expect(i.code, i.title).toBeTruthy();
  });

  it('lists the keyboard shortcuts', () => {
    expect(GUIDE.shortcuts.map(([k]) => k)).toEqual(expect.arrayContaining(['⌘S', '⌘I', '⇧⌘E']));
  });
});

describe('snippetInsertion', () => {
  it('inserts inline snippets as they are', () => {
    expect(isBlockSnippet('#footnote[Source.]')).toBe(false);
    expect(snippetInsertion('#footnote[Source.]', 'Some text', ' more')).toBe('#footnote[Source.]');
  });

  it('gives block snippets their own paragraph', () => {
    expect(isBlockSnippet('#pagebreak()')).toBe(true);
    expect(snippetInsertion('#pagebreak()', '', '')).toBe('#pagebreak()\n');
    expect(snippetInsertion('#pagebreak()', 'End of a sentence.', '')).toBe('\n\n#pagebreak()\n');
    expect(snippetInsertion('- a\n- b', 'Before', 'after')).toBe('\n\n- a\n- b\n\n');
  });
});
