import { describe, expect, it } from 'vitest';
import { bookNumbersPath, bookNumbersText, chapterOf, chapterPreviewPath, chapterPreviewText, includeTree, numberedChapters, parseBookNumbers, textHash, type BookNumber } from './chapter-preview';

const files: Record<string, string> = {
  'src/template.typ': [
    '#import "parts.typ": *',
    '#let book(body) = { set page(numbering: "1"); body }',
    '#let title-page(title) = page(header: none, align(center, title))',
    '#let in-body = state("in-body", false)',
    '#let start-body() = {',
    '  pagebreak(weak: true)',
    '  counter(page).update(1)',
    '  in-body.update(true)',
    '}',
    '#let book-chapter(body) = {',
    '  page(header: none)[]',
    '  {',
    '    // A blank verso, so the chapter starts on a recto.',
    '    set page(footer: none)',
    '    pagebreak(to: "odd")',
    '  }',
    '  body',
    '}',
    '#let appendix(body) = { set heading(numbering: "A.1"); body }',
  ].join('\n'),
  'src/parts.typ': '#let part(title) = {\n  pagebreak(weak: true, to: "odd")\n  [#metadata(title) <part-marker>]\n  align(center, text(20pt, title))\n}\n',
  'src/front/preface.typ': '#heading(numbering: none)[Preface]\nSee @ch:one.\n',
  'src/chapters/one.typ': '= One <ch:one>\n== First steps <sec:steps>\nText.\n#figure(rect(), caption: [A box]) <fig:box>\n',
  'src/chapters/two.typ': '= Two <ch:two>\nAs in @sec:steps and @fig:box, and #ref(<ch:one>, form: "page") or #link(<fig:box>)[the box].\n#include "two-exercises.typ"\n',
  'src/chapters/two-exercises.typ': '== Exercises <sec:two-ex>\n',
  'src/chapters/three.typ': '= Three\n```\n= not a heading <not-a-label>\n```\n// = nor this\n= Three, again, as @knuth84 says\n',
  'src/back/refs.typ': '#bibliography("refs.bib")\n',
};
const read = (p: string) => files[p] ?? null;

const MAIN = [
  '#import "template.typ": *',
  '#show: book',
  '#title-page[A Book]',
  '#outline()',
  '#{',
  '  set heading(numbering: none)',
  '  include "front/preface.typ"',
  '}',
  '#start-body()',
  '#book-chapter(include "chapters/one.typ") // the first',
  '#include "chapters/two.typ"',
  '#part[Later] <part:later>',
  '#appendix(include "chapters/three.typ")',
  '#include "back/refs.typ"',
  '',
].join('\n');

const STEP = (n: number) => `#{ for _ in range(${n}) { counter(heading).step(); counter(heading.where(level: 1)).step() } }`;

describe('the chapter preview', () => {
  it('sits beside the main file', () => {
    expect(chapterPreviewPath('src/main.typ')).toBe('src/.foreword-chapter.typ');
    expect(chapterPreviewPath('main.typ')).toBe('.foreword-chapter.typ');
  });

  it('knows which chapter a file is in, however deep', () => {
    const chapters = ['src/front/preface.typ', 'src/chapters/one.typ', 'src/chapters/two.typ'];
    expect(includeTree('src/chapters/two.typ', read)).toEqual(['src/chapters/two.typ', 'src/chapters/two-exercises.typ']);
    expect(chapterOf('src/chapters/two.typ', chapters, read)).toBe('src/chapters/two.typ');
    expect(chapterOf('src/chapters/two-exercises.typ', chapters, read)).toBe('src/chapters/two.typ');
    expect(chapterOf('src/template.typ', chapters, read)).toBeNull();
  });

  it('counts the numbered top-level headings a file gives the counter', () => {
    expect(numberedChapters(files['src/chapters/one.typ'])).toBe(1);
    expect(numberedChapters(files['src/front/preface.typ'])).toBe(0);
    expect(numberedChapters(files['src/chapters/three.typ'])).toBe(2);
    expect(numberedChapters('#heading(level: 1)[A]\n#heading(level: 2)[B]\n#heading(numbering: none, outlined: false)[C]')).toBe(1);
    expect(numberedChapters('#set heading(numbering: none)\n= Afterword\n= Thanks\n')).toBe(0);
    // An equation's lines that start with "=" aren't headings; nor is "=" after an escaped or raw "$".
    expect(numberedChapters('= Sums\n$\n  a + b\n  = c\n$\nCosts \\$5, or `$`.\n= More\n')).toBe(2);
  });

  it('keeps the chapter and what sets the book up, and leaves out the pages the main file makes', () => {
    const out = chapterPreviewText(MAIN, 'src/main.typ', 'src/chapters/two.typ', read, 'src');
    const lines = out.split('\n');
    // Line for line with the main file, so errors and jumps land on the same lines.
    expect(lines.length).toBe(MAIN.split('\n').length);
    expect(lines[0]).toMatch(/^\/\* Foreword's chapter preview: src\/main\.typ with only src\/chapters\/two\.typ\. .*\*\/#import "template\.typ": \*$/);
    expect(lines[1]).toBe('#show: book');
    // The title page and the contents go.
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('');
    // The block stays for its set rule; the preface is unnumbered: nothing in its place.
    expect(lines.slice(4, 8)).toEqual(['#{', '  set heading(numbering: none)', '  none', '}']);
    // A call that only sets counters and state stays.
    expect(lines[8]).toBe('#start-body()');
    // The other chapters go, their blank pages with them, their count kept.
    expect(lines[9]).toBe(STEP(1));
    // A part goes, and its label with it.
    expect(lines[11]).toBe('');
    expect(lines[12]).toBe(STEP(2));
    // The bibliography goes: this chapter cites nothing.
    expect(lines[13]).toBe('');
    // The chapter, with references to what's taken out shown in grey rather than failing.
    expect(lines[10]).toMatch(/^#\{ let gone = \(.*\); let shown\(it, g\) = .*; show ref: .*; show link: .*; include "chapters\/two\.typ" \}$/);
    const gone = /let gone = \(([^)]*)\)/.exec(lines[10])![1];
    expect(gone).toBe('"ch:one": "One", "fig:box": none, "part:later": none, "sec:steps": "First steps"');
    // Its own labels, its sub-file's, and what's only in comments or raw text aren't "gone".
    expect(gone).not.toMatch(/ch:two|sec:two-ex|not-a-label/);
  });

  it('leaves out the chapter’s call when it only puts blank pages around it', () => {
    const lines = chapterPreviewText(MAIN, 'src/main.typ', 'src/chapters/one.typ', read, 'src').split('\n');
    expect(lines[9]).toMatch(/^#\{ (let gone = .*)?include "chapters\/one\.typ" \}$/);
    expect(lines[10]).toBe(STEP(1));
  });

  it('keeps a call that sets the chapter, and the bibliography for its citations', () => {
    const lines = chapterPreviewText(MAIN, 'src/main.typ', 'src/chapters/three.typ', read, 'src').split('\n');
    expect(lines[12]).toMatch(/^#appendix\(\{ (let gone = .*)?include "chapters\/three\.typ" \}\)$/);
    expect(lines[13]).toBe('#include "back/refs.typ"');
  });

  it('counts the headings written in the main file', () => {
    const out = chapterPreviewText('= Interlude\nA few words.\n#include "a.typ"\n#include "b.typ"\n', 'main.typ', 'b.typ', (p) => ({ 'a.typ': '= A\n', 'b.typ': '= B\n' })[p] ?? null);
    const lines = out.split('\n');
    expect(lines[0].endsWith(`*/${STEP(1)}`)).toBe(true);
    expect(lines.slice(1, 3)).toEqual(['', STEP(1)]);
  });

  it('quotes headings safely', () => {
    const out = chapterPreviewText('#include "a.typ"\n#include "b.typ"\n', 'main.typ', 'a.typ', (p) => ({ 'a.typ': 'See @b.', 'b.typ': '= The "Quoted" \\ One <b>\n' })[p] ?? null);
    expect(out).toContain('let gone = ("b": "The \\"Quoted\\" One");');
  });

  it('reads references out of the chapter as the whole book has them, once it knows', () => {
    const numbers = new Map<string, BookNumber>([
      ['fig:box', { supplement: 'Figure', number: '1.1', page: '3' }],
      ['ch:one', { supplement: 'Chapter', number: '1', page: '2' }],
      // An unnumbered heading: only its page, and its words if a reference names it.
      ['part:later', { supplement: 'Section', number: null, page: 'xii' }],
      // A label the chapter has itself isn't "gone".
      ['ch:two', { supplement: 'Chapter', number: '2', page: '5' }],
    ]);
    const out = chapterPreviewText(MAIN, 'src/main.typ', 'src/chapters/two.typ', read, 'src', numbers);
    const gone = /let gone = \((.*?)\); let shown/.exec(out)![1];
    expect(gone).toBe('"ch:one": ("Chapter", "1", "2"), "fig:box": ("Figure", "1.1", "3"), "part:later": (none, "part:later", "xii"), "sec:steps": "First steps"');
  });
});

describe('the book typeset for its numbers', () => {
  it('records what each reference reads as, around every include and at the top', () => {
    expect(bookNumbersPath('src/main.typ')).toBe('src/.foreword-numbers.typ');
    const out = bookNumbersText(MAIN, '#show ref: it => it;');
    const lines = out.split('\n');
    expect(lines[1]).toBe('#show ref: it => it;');
    expect(lines[2]).toMatch(/^#let foreword-number\(it, n\) = \{ it; if it.has\("label"\) \{ context .*<foreword-number>\] \} \} \}$/);
    expect(lines.slice(3, 6).map((l) => l.split(':')[0])).toEqual(['#show heading', '#show figure', '#show math.equation']);
    // Then the main file, each include in a block with the same rules, where they run before the book's own.
    const main = lines.slice(6).join('\n');
    expect(main.split('\n').length).toBe(MAIN.split('\n').length);
    expect(main).toContain('#book-chapter({ show heading: it => foreword-number(');
    expect(main).toMatch(/\n#\{ show heading: .*; show math\.equation: .*; include "chapters\/two\.typ" \}\n/);
    expect(main).toMatch(/\n  \{ show heading: .*; include "front\/preface\.typ" \}\n/);
    expect(main.match(/foreword-number\(it, \(\) => counter\(heading\)/g)).toHaveLength(5);
  });

  it('reads Typst’s answer: by label, as text, the first of each', () => {
    const numbers = parseBookNumbers([
      ['fig:a', { func: 'text', text: 'Figure' }, '3.2', '41'],
      ['eq:b', { func: 'sequence', children: [{ func: 'text', text: 'Key' }, { func: 'space' }, { func: 'text', text: 'Equation' }] }, { func: 'text', text: '(4)' }, null],
      ['sec:c', null, null, 'xii'],
      ['fig:a', { func: 'text', text: 'Figure' }, '9.9', '99'],
      'junk',
      [7, 'x'],
    ]);
    expect([...numbers]).toEqual([
      ['fig:a', { supplement: 'Figure', number: '3.2', page: '41' }],
      ['eq:b', { supplement: 'Key Equation', number: '(4)', page: null }],
      ['sec:c', { supplement: null, number: null, page: 'xii' }],
    ]);
    expect(parseBookNumbers(null).size).toBe(0);
  });

  it('tells texts apart by their hash', () => {
    expect(textHash('= One\n')).toBe(textHash('= One\n'));
    expect(textHash('= One\n')).not.toBe(textHash('= One \n'));
    expect(textHash('')).not.toBe(textHash(' '));
  });
});
