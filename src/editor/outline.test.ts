import { describe, expect, it } from 'vitest';
import { headingPath, headings } from './outline';

describe('headings', () => {
  it('reads Typst headings as they read, without labels or markup', () => {
    const lines = ['= The Storm <ch-storm>', 'Text.', '== A *dark* night', '', '=== The \\#1 rule', '=not a heading', '#heading[Not this either]'];
    expect(headings(lines, 'typst')).toEqual([
      { line: 1, level: 1, title: 'The Storm' },
      { line: 3, level: 2, title: 'A dark night' },
      { line: 5, level: 3, title: 'The #1 rule' },
    ]);
  });

  it('skips raw blocks and block comments', () => {
    const lines = ['```typ', '= In an example', '```', 'Inline ```= raw``` text', '/* old', '= Commented out', '*/', '// = Also commented', '= Real'];
    expect(headings(lines, 'typst').map((h) => h.title)).toEqual(['Real']);
  });

  it('reads Markdown headings, outside code blocks', () => {
    const lines = ['# Style guide', '## Voice ##', '```', '# a shell comment', '```', '~~~', '## nope', '~~~', '#hashtag'];
    expect(headings(lines, 'markdown')).toEqual([
      { line: 1, level: 1, title: 'Style guide' },
      { line: 2, level: 2, title: 'Voice' },
    ]);
  });

  it('has none for other files', () => {
    expect(headings(['= x', '# y'], 'json')).toEqual([]);
  });
});

describe('headingPath', () => {
  const all = headings(['= Part', '== One', 'a', '=== Detail', 'b', '== Two', 'c', '= Next'], 'typst');
  const titles = (line: number) => headingPath(all, line).map((h) => h.title);

  it('is the headings a line is under, outermost first', () => {
    expect(titles(3)).toEqual(['Part', 'One']);
    expect(titles(5)).toEqual(['Part', 'One', 'Detail']);
    expect(titles(7)).toEqual(['Part', 'Two']);
    expect(titles(8)).toEqual(['Next']);
  });

  it('is empty above the first heading', () => {
    expect(headingPath(headings(['#set page(width: 5in)', '= Title'], 'typst'), 1)).toEqual([]);
  });

  it('isn’t fooled by a line of maths that starts with =', () => {
    const lines = ['= Constants', 'Squaring, we get', '$', '  (a - b)^2 y^2 \\', '  = (x^2 + y^2)(a^2 - b^2),', '$', 'and $x = 1$ costs `$5`.', '== Next'];
    expect(headings(lines, 'typst').map((h) => h.title)).toEqual(['Constants', 'Next']);
  });

  it('copes with a deeper heading first', () => {
    expect(headingPath(headings(['== Two', '= One', 'x'], 'typst'), 3).map((h) => h.title)).toEqual(['One']);
  });
});
