import { describe, expect, it } from 'vitest';
import { headings } from '../editor/outline';
import { bookKind, commonFolder, headingOver, importsFor, includeInPlace, includeLines, insertLine, movedText, partName, partPath, partText, partTitle, placesOver, sectionEnd, sectionIncludes, topFolder, wholeLines } from './new-parts';

const heads = (text: string) => headings(text.split('\n'), 'typst');

describe('where the cursor is in the book', () => {
  it('finds each include’s line', () => {
    const text = '= Methods\n\n#include "02-methods/design.typ"\n// #include "no.typ"\n#box(include "/parts/data.typ")\n';
    expect(includeLines(text, 'chapters/02-methods.typ')).toEqual([
      { file: 'chapters/02-methods/design.typ', line: 3 },
      { file: 'parts/data.typ', line: 5 },
    ]);
  });

  it('follows headings down through the files that include each other', () => {
    const h = (level: number, title: string) => ({ line: level, level, title });
    const main = [{ file: 'main.typ', heading: h(1, 'Methods') }];
    const chapter = [{ file: 'methods.typ', heading: h(2, 'Design') }];
    // The section file starts at level 2 again: Design isn't over it.
    const section = [{ file: 'methods/sampling.typ', heading: h(2, 'Sampling') }, { file: 'methods/sampling.typ', heading: h(3, 'Random') }];
    expect(placesOver([main, chapter, section]).map((p) => p.heading.title)).toEqual(['Methods', 'Sampling', 'Random']);
    expect(placesOver([[], chapter]).map((p) => p.heading.title)).toEqual(['Design']);
  });
});

describe('what a part is called', () => {
  it('is a chapter, section or subsection in a book; a section or subsection in a paper', () => {
    expect([1, 2, 3, 4].map((l) => partName(l, 'book'))).toEqual(['chapter', 'section', 'subsection', 'subsection']);
    expect([1, 2, 3].map((l) => partName(l, 'paper'))).toEqual(['section', 'subsection', 'subsection']);
    expect(partTitle(2, 'book')).toBe('Section');
  });

  it('tells a paper from a book by where its parts are, or its own headings', () => {
    expect(bookKind([], ['chapters/01-a.typ', 'chapters/02-b.typ'])).toBe('book');
    expect(bookKind([], ['src/chapters/ch01.typ', 'frontmatter/preface.typ'])).toBe('book');
    expect(bookKind([], ['sections/intro.typ', 'sections/methods.typ'])).toBe('paper');
    expect(bookKind(heads('#show: ieee\n= Introduction\nText.\n= Methods\n'), [])).toBe('paper');
    // A new book from the blank template: no headings in its main file, nothing included yet.
    expect(bookKind([], [])).toBe('book');
    expect(bookKind([], ['story.typ'])).toBe('book');
  });
});

describe('where top-level parts go', () => {
  it('beside the ones there are, else chapters or sections beside the main file', () => {
    expect(commonFolder(['frontmatter/p.typ', 'chapters/1.typ', 'chapters/2.typ', 'backmatter/a.typ'])).toBe('chapters');
    expect(commonFolder([])).toBe(null);
    expect(topFolder('main.typ', ['parts/one.typ'], 'book')).toBe('parts');
    expect(topFolder('src/main.typ', [], 'book')).toBe('src/chapters');
    expect(topFolder('main.typ', [], 'paper')).toBe('sections');
    // A picture book's one story file beside the main file isn't a folder of chapters.
    expect(topFolder('main.typ', ['story.typ'], 'book')).toBe('chapters');
  });
});

describe('partPath', () => {
  const files = ['main.typ', 'chapters/01-intro.typ', 'chapters/02-methods.typ'];

  it('goes in a folder named after the file that includes it', () => {
    expect(partPath(files, 'chapters/02-methods.typ', [], 'Sampling', 'main.typ')).toBe('chapters/02-methods/sampling.typ');
    expect(partPath(files, 'main.typ', [], 'Related Work', 'main.typ')).toBe('sections/related-work.typ');
    expect(partPath(['paper/main.typ'], 'paper/main.typ', [], 'Results', 'paper/main.typ')).toBe('paper/sections/results.typ');
  });

  it('goes beside the parts the file already includes, named as they are', () => {
    const siblings = ['chapters/02-methods/01-design.typ', 'chapters/02-methods/02-data.typ'];
    expect(partPath([...files, ...siblings], 'chapters/02-methods.typ', siblings, 'Sampling', 'main.typ')).toBe('chapters/02-methods/03-sampling.typ');
    const plain = ['parts/design.typ'];
    expect(partPath([...files, ...plain], 'chapters/02-methods.typ', plain, 'Data', 'main.typ')).toBe('parts/data.typ');
  });

  it('never takes a file that exists', () => {
    const taken = [...files, 'chapters/02-methods/sampling.typ'];
    expect(partPath(taken, 'chapters/02-methods.typ', [], 'Sampling', 'main.typ')).toBe('chapters/02-methods/sampling-2.typ');
    expect(partPath(files, 'chapters/02-methods.typ', [], '***', 'main.typ')).toBe('chapters/02-methods/section.typ');
  });
});

describe('a new part’s text', () => {
  it('imports what its sample imports, from where it is', () => {
    const chapter = '// A chapter\n#import "../style.typ": *\n#import "@preview/cetz:0.3.4"\n#import "/lib/defs.typ": thm\n\n= Methods\n#import "inside.typ"\n';
    expect(importsFor(chapter, 'chapters/02-methods.typ', 'chapters/02-methods/sampling.typ')).toEqual([
      '#import "../../style.typ": *',
      '#import "@preview/cetz:0.3.4"',
      '#import "/lib/defs.typ": thm',
      '#import "../inside.typ"',
    ]);
    expect(importsFor('#import "style.typ": *\n', 'main.typ', 'sections/intro.typ')).toEqual(['#import "../style.typ": *']);
  });

  it('starts with its heading at its level', () => {
    expect(partText('Why #1?', 3, ['#import "../../style.typ": *'])).toBe('#import "../../style.typ": *\n\n=== Why \\#1?\n\n');
    expect(partText('Data', 2, [])).toBe('== Data\n\n');
  });
});

describe('sectionEnd', () => {
  const text = ['= Methods', '', 'Intro.', '', '== Design', 'Text.', '', '', '== Data', 'More.', '', '= Results', 'R.', ''].join('\n');
  const lines = text.split('\n');
  const all = heads(text);
  const at = (title: string) => all.find((h) => h.title === title)!;

  it('is after the section’s last line, before the next heading at its level or above', () => {
    expect(sectionEnd(lines, all, at('Design'))).toBe(6);
    expect(sectionEnd(lines, all, at('Data'))).toBe(10);
    expect(sectionEnd(lines, all, at('Methods'))).toBe(10);
    expect(sectionEnd(lines, all, at('Results'))).toBe(13);
  });

  it('is before the bibliography at the end of a file', () => {
    const paper = '= Intro\nText.\n\n= Discussion\nMore.\n\n#bibliography("refs.bib")\n';
    expect(sectionEnd(paper.split('\n'), heads(paper), heads(paper)[1])).toBe(5);
  });

  it('is just under a heading with nothing after it', () => {
    expect(sectionEnd(['== Empty', ''], heads('== Empty\n'), heads('== Empty\n')[0])).toBe(1);
  });
});

describe('the parts in a section', () => {
  const main = '= Introduction\n#include "sections/01-intro.typ"\n= Methods\nText.\n== Design\n#include "methods/design.typ"\n= Results\n';
  const all = heads(main);

  it('are the files included between its heading and its end', () => {
    expect(sectionIncludes(main, 'main.typ', all[1])).toEqual(['methods/design.typ']);
    expect(sectionIncludes(main, 'main.typ', all[3])).toEqual([]);
    expect(sectionIncludes(main, 'main.typ', null)).toEqual(['sections/01-intro.typ', 'methods/design.typ']);
  });

  it('so a paper’s subsection isn’t named as a section beside the top-level ones', () => {
    const files = ['main.typ', 'sections/01-intro.typ'];
    expect(partPath(files, 'main.typ', sectionIncludes(main, 'main.typ', all[3]), 'Sampling', 'main.typ')).toBe('sections/sampling.typ');
  });

  it('a moved passage goes under the heading above it at a higher level', () => {
    expect(headingOver(all, 6, 2)?.title).toBe('Methods');
    expect(headingOver(all, 6, null)?.title).toBe('Design');
    expect(headingOver(all, 1, null)).toBe(null);
  });
});

describe('insertLine', () => {
  it('gives the #include a paragraph of its own', () => {
    expect(insertLine('= A\nText.\n= B\n', 2, '#include "x.typ"')).toEqual({ text: '= A\nText.\n\n#include "x.typ"\n\n= B\n', line: 3 });
    expect(insertLine('= A\nText.\n', 2, '#include "x.typ"')).toEqual({ text: '= A\nText.\n\n#include "x.typ"\n', line: 3 });
  });

  it('keeps a list of includes a list', () => {
    expect(insertLine('= A\n\n#include "a.typ"\n\n= B\n', 3, '#include "b.typ"')).toEqual({ text: '= A\n\n#include "a.typ"\n#include "b.typ"\n\n= B\n', line: 3 });
  });
});

describe('moving a selection to a file', () => {
  it('takes whole lines', () => {
    expect(wholeLines({ lineNumber: 3 }, { lineNumber: 7, column: 1 })).toEqual({ from: 3, to: 6 });
    expect(wholeLines({ lineNumber: 3 }, { lineNumber: 7, column: 4 })).toEqual({ from: 3, to: 7 });
    expect(wholeLines({ lineNumber: 3 }, { lineNumber: 3, column: 1 })).toEqual({ from: 3, to: 3 });
  });

  it('leaves the #include its own paragraph where the passage was', () => {
    expect(includeInPlace('== Data\nText.\n', '#include "d.typ"')).toBe('#include "d.typ"\n');
    expect(includeInPlace('\n== Data\nText.\n\n', '#include "d.typ"')).toBe('\n#include "d.typ"\n\n');
    expect(includeInPlace('Text.', '#include "d.typ"')).toBe('#include "d.typ"');
  });

  it('starts the file with the imports the passage doesn’t have', () => {
    expect(movedText('\n== Data\n#import "../../style.typ": *\nText.\n\n', ['#import "../../style.typ": *', '#import "@preview/cetz:0.3.4"'])).toBe(
      '#import "@preview/cetz:0.3.4"\n\n== Data\n#import "../../style.typ": *\nText.\n',
    );
    expect(movedText('Text.', [])).toBe('Text.\n');
  });
});
