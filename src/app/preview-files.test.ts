import { describe, expect, it } from 'vitest';
import { aloneRoot, bookFiles, canPreviewAlone, filesOutsideBook } from './preview-files';
import { fileUses, type FileUses } from './snippet-book';

/** Each file's imports and includes, from its text. */
const usesOf = (texts: Record<string, string>) => {
  const map = new Map(Object.entries(texts).map(([path, text]) => [path, fileUses(text)] as const));
  return (path: string): FileUses | undefined => map.get(path);
};

// As the linear algebra book is laid out: the book in src/, a cover beside it that reaches into src/ for the title.
const LINALG = {
  'src/main.typ': '#import "/template/lib.typ": *\n#include "chapters/ch01.typ"\n#include "chapters/ch02.typ"\n',
  'src/template/lib.typ': '#import "boxes.typ": *\n',
  'src/template/boxes.typ': '#let note(body) = body\n',
  'src/chapters/ch01.typ': '= One\n#include "ch01-sidebar.typ"\n',
  'src/chapters/ch01-sidebar.typ': 'A sidebar.\n',
  'src/chapters/ch02.typ': '= Two\n',
  'src/metadata.typ': '#let booktitle = "Linear Algebra"\n',
  'src/preview.typ': '#import "/template/lib.typ": *\n#include "chapters/ch02.typ"\n',
  'src/.foreword-chapter.typ': '#include "main.typ"\n',
  'cover/preview.typ': '#include "cover.typ"\n',
  'cover/cover.typ': '#import "../src/metadata.typ": booktitle\n#booktitle\n',
  'scratch.typ': 'Trying something.\n',
  'notes.md': '# Notes',
};
const FILES = Object.keys(LINALG);

describe('the book’s files', () => {
  it('are the main file and what it includes and imports, however deep', () => {
    expect([...bookFiles('src/main.typ', usesOf(LINALG), 'src')].sort()).toEqual([
      'src/chapters/ch01-sidebar.typ',
      'src/chapters/ch01.typ',
      'src/chapters/ch02.typ',
      'src/main.typ',
      'src/template/boxes.typ',
      'src/template/lib.typ',
    ]);
  });

  it('end where a file includes itself', () => {
    const texts = { 'main.typ': '#include "a.typ"', 'a.typ': '#include "main.typ"' };
    expect([...bookFiles('main.typ', usesOf(texts), '')].sort()).toEqual(['a.typ', 'main.typ']);
  });
});

describe('the files the preview can show on their own', () => {
  it('are the Typst files outside the book, but for modules and Foreword’s own', () => {
    // metadata.typ is imported by the cover: a module, blank alone.
    expect(filesOutsideBook(FILES, 'src/main.typ', usesOf(LINALG), 'src')).toEqual(['cover/cover.typ', 'cover/preview.typ', 'scratch.typ', 'src/preview.typ']);
  });

  it('leave out a designed cover’s parts, but keep the cover with guides and the one printed', () => {
    const texts = {
      'main.typ': '= Book',
      'cover/spec.typ': '#let pages = 200',
      'cover/guides.typ': '#let guides() = none',
      'cover/design.typ': '#import "spec.typ": *\n#import "guides.typ": *\n#let cover(guides: false) = none',
      'cover/preview.typ': '#import "design.typ": cover\n#cover(guides: true)',
      'cover/cover.typ': '#import "design.typ": cover\n#cover()',
    };
    expect(filesOutsideBook(Object.keys(texts), 'main.typ', usesOf(texts), '')).toEqual(['cover/cover.typ', 'cover/preview.typ']);
  });

  it('are every Typst file when there is no main file', () => {
    expect(filesOutsideBook(['b.typ', 'a.typ', 'c.md'], null, () => undefined, '')).toEqual(['a.typ', 'b.typ']);
  });

  it('can be any Typst file but the main file, from the file list', () => {
    expect(canPreviewAlone('src/template/boxes.typ', 'src/main.typ')).toBe(true);
    expect(canPreviewAlone('cover/cover.typ', 'src/main.typ')).toBe(true);
    expect(canPreviewAlone('src/main.typ', 'src/main.typ')).toBe(false);
    expect(canPreviewAlone('src/.foreword-chapter.typ', 'src/main.typ')).toBe(false);
    expect(canPreviewAlone('.foreword/interior.typ', 'src/main.typ')).toBe(false);
    expect(canPreviewAlone('notes.md', 'src/main.typ')).toBe(false);
  });

  it('are typeset from the book’s root when they’re in it, else from the folder opened', () => {
    expect(aloneRoot('src/preview.typ', 'src')).toBe('src');
    expect(aloneRoot('cover/cover.typ', 'src')).toBe('');
    expect(aloneRoot('srcs/x.typ', 'src')).toBe('');
    expect(aloneRoot('cover/cover.typ', '')).toBe('');
  });
});
