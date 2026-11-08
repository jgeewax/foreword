import { describe, expect, it } from 'vitest';
import { chapterOf, chapterPreviewPath, chapterPreviewText, includeTree, numberedChapters } from './chapter-preview';

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
    expect(lines[10]).toMatch(/^#\{ let gone = \(.*\); show ref: .*; show link: .*; include "chapters\/two\.typ" \}$/);
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
});
