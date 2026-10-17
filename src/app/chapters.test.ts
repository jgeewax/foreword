import { describe, expect, it } from 'vitest';
import { chapterImports, chapterText, escapeMarkup, includeInsertion, includePath, nextChapterPath, slugify, withInclude } from './chapters';

describe('escapeMarkup', () => {
  it('escapes characters that mean something in Typst', () => {
    expect(escapeMarkup('Cats & *Dogs* #1 $5 @home <tag> [x]')).toBe('Cats & \\*Dogs\\* \\#1 \\$5 \\@home \\<tag> \\[x\\]');
    expect(escapeMarkup('- not a list')).toBe('\\- not a list');
    expect(escapeMarkup('  spaced \n out ')).toBe('spaced out');
  });
});

describe('slugify', () => {
  it('makes short, safe file names', () => {
    expect(slugify('The Island, Part 2')).toBe('the-island-part-2');
    expect(slugify('Café Noir!')).toBe('cafe-noir');
    expect(slugify('***')).toBe('chapter');
  });
});

describe('nextChapterPath', () => {
  it('numbers after the highest existing chapter, keeping the digit width', () => {
    const files = ['main.typ', 'chapters/01-one.typ', 'chapters/02-two.typ', 'chapters/notes.md'];
    expect(nextChapterPath(files, 'Three')).toBe('chapters/03-three.typ');
    expect(nextChapterPath(['chapters/009-x.typ'], 'Ten')).toBe('chapters/010-ten.typ');
    expect(nextChapterPath(['main.typ'], 'First')).toBe('chapters/01-first.typ');
  });

  it('ignores unnumbered files when numbering', () => {
    expect(nextChapterPath(['chapters/a.typ', 'chapters/02-x.typ'], 'X')).toBe('chapters/03-x.typ');
  });
});

describe('chapter text', () => {
  it('copies the import lines and escapes the title', () => {
    const imports = chapterImports('// note\n#import "../style.typ": *\n\n= Old\n');
    expect(imports).toEqual(['#import "../style.typ": *']);
    expect(chapterText('Why #1?', imports)).toBe('#import "../style.typ": *\n\n= Why \\#1?\n\n');
    expect(chapterText('Plain', [])).toBe('= Plain\n\n');
  });
});

describe('include placement', () => {
  it('goes after the last chapter include', () => {
    const main = '#show: book\n#include "chapters/01.typ"\n#include "chapters/02.typ"\n\n#bibliography("refs.bib")\n';
    expect(includeInsertion(main, 'chapters/03.typ')).toEqual({ line: 3, text: '#include "chapters/03.typ"' });
  });

  it('goes before the bibliography, or at the end', () => {
    expect(includeInsertion('= Hi\n\n#bibliography("r.bib")\n', 'c.typ')).toEqual({ line: 2, text: '#include "c.typ"\n' });
    expect(includeInsertion('= Hi\n', 'c.typ')).toEqual({ line: 1, text: '\n#include "c.typ"' });
  });

  it('produces the new main file text', () => {
    expect(withInclude('= Hi\n', 'c.typ')).toBe('= Hi\n\n#include "c.typ"\n');
    expect(withInclude('= Hi\n\n#bibliography("r.bib")\n', 'c.typ')).toBe('= Hi\n\n#include "c.typ"\n\n#bibliography("r.bib")\n');
    expect(withInclude('#include "a.typ"\n#include "b.typ"\n', 'c.typ')).toBe('#include "a.typ"\n#include "b.typ"\n#include "c.typ"\n');
  });

  it('makes the path relative to the main file', () => {
    expect(includePath('main.typ', 'chapters/03.typ')).toBe('chapters/03.typ');
    expect(includePath('book/main.typ', 'book/chapters/03.typ')).toBe('chapters/03.typ');
    expect(includePath('src/main.typ', 'chapters/03.typ')).toBe('../chapters/03.typ');
  });
});
