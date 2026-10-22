import { describe, expect, it } from 'vitest';
import { blankLinesAroundHeadings, headingRanges, singleBlankLines } from './format';
import type { LspSymbol } from './lsp-convert';

const at = (line: number, character: number) => ({ line, character });
const range = (s: [number, number], e: [number, number]) => ({ start: at(...s), end: at(...e) });
const sym = (name: string, kind: number, s: [number, number], e: [number, number], children?: LspSymbol[]): LspSymbol => ({ name, kind, range: range(s, e), children });

describe('headingRanges', () => {
  it('reads headings (kind 3) from Tinymist’s nested outline, in order', () => {
    // What Tinymist 0.15 returns for `= Title <intro>`, `== Sub`, `=== Deeper`, a #let and a two-line heading.
    const symbols = [
      sym('Title', 3, [0, 2], [0, 7], [sym('intro', 14, [0, 8], [0, 15]), sym('Sub', 3, [3, 3], [3, 6], [sym('Deeper', 3, [4, 4], [4, 10])])]),
      sym('A #emph[two\nline] heading', 3, [17, 2], [18, 13]),
      sym('f', 12, [20, 5], [20, 6]),
    ];
    expect(headingRanges(symbols)).toEqual([range([0, 2], [0, 7]), range([3, 3], [3, 6]), range([4, 4], [4, 10]), range([17, 2], [18, 13])]);
    expect(headingRanges([{ name: 'Flat', kind: 3, location: { range: range([2, 2], [2, 6]) } }])).toEqual([range([2, 2], [2, 6])]);
  });
});

describe('blankLinesAroundHeadings', () => {
  /** Headings as [line, first character of the title, end line, end character]. */
  const fix = (lines: string[], headings: [number, number, number, number][]) =>
    blankLinesAroundHeadings(
      lines.join('\n'),
      headings.map(([l, c, el, ec]) => range([l, c], [el, ec])),
    ).split('\n');

  it('puts a blank line above and below a heading', () => {
    expect(fix(['= My new chapter', '', 'something else.', '== something', 'another', ''], [[0, 2, 0, 16], [3, 3, 3, 12]])).toEqual([
      '= My new chapter',
      '',
      'something else.',
      '',
      '== something',
      '',
      'another',
      '',
    ]);
  });

  it('puts one blank line between headings that follow each other', () => {
    expect(fix(['Text.', '= Part', '== Chapter', 'Text.'], [[1, 2, 1, 6], [2, 3, 2, 10]])).toEqual(['Text.', '', '= Part', '', '== Chapter', '', 'Text.']);
  });

  it('keeps a label with its heading', () => {
    expect(fix(['= Intro <intro>', 'Text.'], [[0, 2, 0, 7]])).toEqual(['= Intro <intro>', '', 'Text.']);
    expect(fix(['= Intro', '<intro>', 'Text.'], [[0, 2, 0, 7]])).toEqual(['= Intro', '<intro>', '', 'Text.']);
  });

  it('keeps comments right above a heading with it', () => {
    expect(fix(['Text.', '// TODO: a better title', '// (ask the editor)', '== Title', '', 'More.'], [[3, 3, 3, 8]])).toEqual([
      'Text.',
      '',
      '// TODO: a better title',
      '// (ask the editor)',
      '== Title',
      '',
      'More.',
    ]);
  });

  it('goes after the last line of a heading that spans two', () => {
    expect(fix(['Text.', '= A #emph[two', '  line] heading', 'after'], [[1, 2, 2, 15]])).toEqual(['Text.', '', '= A #emph[two', '  line] heading', '', 'after']);
  });

  it('works inside blocks, and indents nothing', () => {
    expect(fix(['#block[', '  intro', '  = In block', '  body', ']'], [[2, 4, 2, 12]])).toEqual(['#block[', '  intro', '', '  = In block', '', '  body', ']']);
  });

  it('leaves alone: the ends of the file and of a block, blank lines already there, a heading sharing its line', () => {
    expect(fix(['= First', '', 'Text.', '', '= Last'], [[0, 2, 0, 7], [4, 2, 4, 6]])).toEqual(['= First', '', 'Text.', '', '= Last']);
    expect(fix(['Text.', '  ', '= Title', '   ', 'Text.'], [[2, 2, 2, 7]])).toEqual(['Text.', '  ', '= Title', '   ', 'Text.']);
    expect(fix(['#block[', '  = Title', ']'], [[1, 4, 1, 9]])).toEqual(['#block[', '  = Title', ']']);
    expect(fix(['Text.', '#block[= Title] and more', 'Text.'], [[1, 9, 1, 14]])).toEqual(['Text.', '#block[= Title] and more', 'Text.']);
  });

  it('keeps \\r\\n line endings', () => {
    expect(blankLinesAroundHeadings('Text.\r\n= Title\r\nText.\r\n', [range([1, 2], [1, 7])])).toBe('Text.\r\n\r\n= Title\r\n\r\nText.\r\n');
  });

  it('changes nothing without headings', () => {
    const text = 'Just text.\n';
    expect(blankLinesAroundHeadings(text, [])).toBe(text);
  });
});

describe('singleBlankLines', () => {
  const fix = (lines: string[]) => singleBlankLines(lines.join('\n')).split('\n');

  it('leaves one blank line where there were several, blank or just spaces', () => {
    expect(fix(['First.', '', '', '', 'Second.', '  ', '\t', 'Third.', '', 'Fourth.'])).toEqual(['First.', '', 'Second.', '  ', 'Third.', '', 'Fourth.']);
  });

  it('takes the blank lines off the start and the end, keeping the last line break', () => {
    expect(singleBlankLines('\n\n= Title\n\nText.\n\n\n\n')).toBe('= Title\n\nText.\n');
    expect(singleBlankLines('Text.')).toBe('Text.');
    expect(singleBlankLines('\n\n')).toBe('');
  });

  it('keeps raw text and block comments as written', () => {
    const raw = ['Text.', '', '', '```py', 'def a():', '    pass', '', '', 'def b():', '    pass', '```', '', '', 'More.'];
    expect(fix(raw)).toEqual(['Text.', '', '```py', 'def a():', '    pass', '', '', 'def b():', '    pass', '```', '', 'More.']);
    expect(fix(['`inline', '', '', 'raw`', '', '', 'Text.'])).toEqual(['`inline', '', '', 'raw`', '', 'Text.']);
    expect(fix(['/* a', '', '', '/* nested */', '', '', 'b */', '', '', 'Text.'])).toEqual(['/* a', '', '', '/* nested */', '', '', 'b */', '', 'Text.']);
  });

  it('is not fooled by backticks that start nothing', () => {
    expect(fix(['An escaped \\` and an empty `` here.', '', '', 'Text.'])).toEqual(['An escaped \\` and an empty `` here.', '', 'Text.']);
    expect(fix(['// a ``` in a comment', '', '', 'Text.'])).toEqual(['// a ``` in a comment', '', 'Text.']);
    // A link's // isn't a comment: the raw text after it is still raw text.
    expect(fix(['See https://example.com `raw', '', '', 'text`', '', '', 'More.'])).toEqual(['See https://example.com `raw', '', '', 'text`', '', 'More.']);
  });

  it('keeps \\r\\n line endings', () => {
    expect(singleBlankLines('A.\r\n\r\n\r\n\r\nB.\r\n')).toBe('A.\r\n\r\nB.\r\n');
  });

  it('changes nothing that is already tidy', () => {
    const text = '= Title\n\nText.\n\n#let f(x) = {\n  x\n\n  x\n}\n';
    expect(singleBlankLines(text)).toBe(text);
  });
});
