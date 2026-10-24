import { describe, expect, it } from 'vitest';
import { countWords, fileContents, headingAt, listedHeadings, wordsLabel } from './contents';

describe('the book’s contents', () => {
  it('counts the words of the prose, not the code around it', () => {
    const text = [
      '#import "../style.typ": *',
      '#set text(size: 11pt)',
      '// A note to myself about this chapter',
      '= The Storm <ch-storm>',
      '',
      'The storm came in from the sea, as @lamb2010 said it would.',
      'Its height was $h = 2x^2$ metres; *nobody* slept.',
      '/* a longer note',
      'over two lines */',
      'See https://example.com for more.',
    ].join('\n');
    // The Storm (2), The storm … would (11), Its height was metres nobody slept (6), See https example com for more (6)
    expect(countWords(text)).toBe(25);
    expect(countWords('')).toBe(0);
    expect(countWords("Don't stop — it’s well-known.")).toBe(4);
  });

  it('finds a file’s headings, and the one the cursor is under', () => {
    const c = fileContents('= One\n\nText.\n\n== Part A\n\nMore.\n\n== Part B\n');
    expect(c.headings.map((h) => `${h.level} ${h.title} @${h.line}`)).toEqual(['1 One @1', '2 Part A @5', '2 Part B @9']);
    expect(headingAt(c.headings, 7)?.title).toBe('Part A');
    expect(headingAt(c.headings, 1)?.title).toBe('One');
    expect(headingAt([], 3)).toBeNull();
  });

  it('lights the listed row a subsection is in', () => {
    const c = fileContents('= One\n\n== Part A\n\n=== Deeper\n\nText.\n\n== Part B\n');
    const lit = (main: boolean, open: boolean, line: number) => headingAt(listedHeadings(c, main, open), line)?.title;
    // A chapter lists its title and its sections, not their subsections.
    expect(lit(false, true, 7)).toBe('Part A');
    expect(lit(false, true, 9)).toBe('Part B');
    expect(lit(false, false, 7)).toBe('One');
    // The main file lists its own sections only while they're open.
    expect(lit(true, true, 7)).toBe('Part A');
    expect(lit(true, false, 7)).toBe('One');
  });

  it('says about how many words', () => {
    expect(wordsLabel(1)).toBe('1 word');
    expect(wordsLabel(347)).toBe('347 words');
    expect(wordsLabel(2143)).toBe('2,140 words');
  });
});
