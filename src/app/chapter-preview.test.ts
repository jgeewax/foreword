import { describe, expect, it } from 'vitest';
import { chapterOf, chapterPreviewPath, chapterPreviewText, includeTree, numberedChapters } from './chapter-preview';

const files: Record<string, string> = {
  'src/front/preface.typ': '#heading(numbering: none)[Preface]\nSee @ch:one.\n',
  'src/chapters/one.typ': '= One <ch:one>\n== First steps <sec:steps>\nText.\n#figure(rect(), caption: [A box]) <fig:box>\n',
  'src/chapters/two.typ': '= Two <ch:two>\nAs in @sec:steps and @fig:box, and #ref(<ch:one>, form: "page") or #link(<fig:box>)[the box].\n#include "two-exercises.typ"\n',
  'src/chapters/two-exercises.typ': '== Exercises <sec:two-ex>\n',
  'src/chapters/three.typ': '= Three\n```\n= not a heading <not-a-label>\n```\n// = nor this\n= Three, again\n',
  'src/back/refs.typ': '#bibliography("refs.bib")\n',
};
const read = (p: string) => files[p] ?? null;

const MAIN = [
  '#import "template.typ": *',
  '#show: book',
  '#{',
  '  set heading(numbering: none)',
  '  include "front/preface.typ"',
  '}',
  '#book-chapter(include "chapters/one.typ") // the first',
  '#include "chapters/two.typ"',
  '#part[Later]',
  '#book-chapter(include "chapters/three.typ")',
  '#include "back/refs.typ"',
  '',
].join('\n');

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

  it('keeps one chapter, and in the others’ places the steps they gave the heading counter', () => {
    const out = chapterPreviewText(MAIN, 'src/main.typ', 'src/chapters/two.typ', read, 'src');
    const lines = out.split('\n');
    // Line for line with the main file, so errors and jumps land on the same lines.
    expect(lines.length).toBe(MAIN.split('\n').length);
    expect(lines[0]).toMatch(/^\/\* Foreword's chapter preview: src\/main\.typ with only src\/chapters\/two\.typ\. .*\*\/#import "template\.typ": \*$/);
    // The preface is unnumbered: nothing in its place.
    expect(lines[4]).toBe('  none');
    // A line that only wraps a chapter goes whole (its blank pages with it), its count kept.
    expect(lines[6]).toBe('#{ for _ in range(1) { counter(heading).step(); counter(heading.where(level: 1)).step() } }');
    expect(lines[8]).toBe('#part[Later]');
    expect(lines[9]).toBe('#{ for _ in range(2) { counter(heading).step(); counter(heading.where(level: 1)).step() } }');
    // The bibliography stays, for citations.
    expect(lines[10]).toBe('#include "back/refs.typ"');
    // The chapter, with references to what's taken out shown in grey rather than failing.
    expect(lines[7]).toMatch(/^#\{ let gone = \(.*\); show ref: .*; show link: .*; include "chapters\/two\.typ" \}$/);
    const gone = /let gone = \(([^)]*)\)/.exec(lines[7])![1];
    expect(gone).toBe('"ch:one": "One", "fig:box": none, "sec:steps": "First steps"');
    // Its own labels, its sub-file's, and what's only in comments or raw text aren't "gone".
    expect(gone).not.toMatch(/ch:two|sec:two-ex|not-a-label/);
  });

  it('keeps the chapter’s call around it', () => {
    const out = chapterPreviewText(MAIN, 'src/main.typ', 'src/chapters/one.typ', read, 'src');
    expect(out.split('\n')[6]).toMatch(/^#book-chapter\(\{ (let gone = .*)?include "chapters\/one\.typ" \}\) \/\/ the first$/);
    expect(out.split('\n')[7]).toBe('#{ for _ in range(1) { counter(heading).step(); counter(heading.where(level: 1)).step() } }');
  });

  it('quotes headings safely', () => {
    const out = chapterPreviewText('#include "a.typ"\n#include "b.typ"\n', 'main.typ', 'a.typ', (p) => ({ 'a.typ': 'See @b.', 'b.typ': '= The "Quoted" \\ One <b>\n' })[p] ?? null);
    expect(out).toContain('let gone = ("b": "The \\"Quoted\\" One");');
  });
});
