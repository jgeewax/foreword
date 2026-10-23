import { describe, expect, it } from 'vitest';
import { quotedAt, referencesTo, relativeRef, removeIncludes, resolveRef, updateReferences } from './references';

const MAIN = `#import "style.typ": *
#import "@preview/cetz:0.5.2"
#show: book.with(title: "x")
#include "chapters/01-intro.typ"
#include "/chapters/02-body.typ"
#bibliography("refs.bib")
`;

describe('resolveRef', () => {
  it('resolves relative to the file, or to the root with a leading slash', () => {
    expect(resolveRef('chapters/01.typ', '../figures/a.png')).toBe('figures/a.png');
    expect(resolveRef('chapters/01.typ', '/figures/a.png')).toBe('figures/a.png');
    expect(resolveRef('main.typ', './chapters/01.typ')).toBe('chapters/01.typ');
    expect(resolveRef('main.typ', '@preview/cetz:0.5.2')).toBeNull();
    expect(resolveRef('main.typ', '../outside.typ')).toBeNull();
  });

  it('makes relative paths', () => {
    expect(relativeRef('chapters/01.typ', 'figures/a.png')).toBe('../figures/a.png');
    expect(relativeRef('main.typ', 'chapters/01.typ')).toBe('chapters/01.typ');
    expect(relativeRef('chapters/01.typ', 'chapters/02.typ')).toBe('02.typ');
  });
});

describe('updateReferences', () => {
  it('follows a renamed chapter, keeping root-absolute paths absolute', () => {
    const a = updateReferences(MAIN, 'main.typ', 'chapters/01-intro.typ', 'chapters/01-introduction.typ');
    expect(a.count).toBe(1);
    expect(a.text).toContain('#include "chapters/01-introduction.typ"');
    const b = updateReferences(MAIN, 'main.typ', 'chapters/02-body.typ', 'chapters/02-middle.typ');
    expect(b.text).toContain('#include "/chapters/02-middle.typ"');
  });

  it('follows a renamed folder', () => {
    const r = updateReferences(MAIN, 'main.typ', 'chapters', 'parts');
    expect(r.count).toBe(2);
    expect(r.text).toContain('#include "parts/01-intro.typ"');
    expect(r.text).toContain('#include "/parts/02-body.typ"');
  });

  it('fixes relative paths inside a file that moved', () => {
    const ch = '#import "../style.typ": *\n#figure(image("../figures/a.png"))\n';
    const r = updateReferences(ch, 'part1/ch/01.typ', 'chapters', 'part1/ch', 'chapters/01.typ');
    expect(r.text).toBe('#import "../../style.typ": *\n#figure(image("../../figures/a.png"))\n');
  });

  it("leaves packages, unrelated paths and other strings alone", () => {
    const r = updateReferences(MAIN, 'main.typ', 'figures/x.png', 'figures/y.png');
    expect(r).toEqual({ text: MAIN, count: 0 });
    expect(updateReferences('#let s = "chapters/01-intro.typ"', 'main.typ', 'chapters/01-intro.typ', 'b.typ').count).toBe(0);
  });
});

describe('references for deletion', () => {
  it('finds them and removes whole-line includes only', () => {
    const text = '#include "chapters/03.typ"\nSee #include "chapters/03.typ" inline.\n';
    const refs = referencesTo(text, 'main.typ', 'chapters/03.typ');
    expect(refs.map((r) => r.wholeInclude)).toEqual([true, false]);
    expect(removeIncludes(text, 'main.typ', 'chapters/03.typ')).toEqual({ text: 'See #include "chapters/03.typ" inline.\n', count: 1 });
  });
});

describe('quotedAt (⌘-click a path)', () => {
  const line = '#figure(image("../figures/a.png", width: 50%), caption: "A \\"square\\"")';
  const path = { text: '../figures/a.png', start: 14, end: 32 };

  it('finds the string the pointer is in, from quote to quote', () => {
    for (const at of [14, 15, 22, 31, 32]) expect(quotedAt(line, at)).toEqual(path);
  });

  it('is null outside a string', () => {
    expect(quotedAt(line, 3)).toBeNull();
    expect(quotedAt(line, 40)).toBeNull();
    expect(quotedAt('#include chapter', 10)).toBeNull();
  });

  it('pairs quotes from the start of the line, past escaped ones', () => {
    expect(quotedAt(line, 64)?.text).toBe('A \\"square\\"');
    expect(quotedAt('"a", "b"', 3)).toEqual({ text: 'a', start: 0, end: 3 });
    expect(quotedAt('"a", "b"', 6)).toEqual({ text: 'b', start: 5, end: 8 });
  });

  it('is null in a string still open at the end of the line', () => {
    expect(quotedAt('#include "chapters/01.typ', 12)).toBeNull();
  });
});

describe('a book kept in a subfolder (Typst root "src")', () => {
  it('resolves and rewrites root-absolute paths inside the root', () => {
    expect(resolveRef('src/chapters/one.typ', '/figures/a.png', 'src')).toBe('src/figures/a.png');
    expect(resolveRef('src/chapters/one.typ', '../figures/a.png', 'src')).toBe('src/figures/a.png');
    const r = updateReferences('#image("/figures/a.png")', 'src/chapters/one.typ', 'src/figures', 'src/art', 'src/chapters/one.typ', 'src');
    expect(r).toEqual({ text: '#image("/art/a.png")', count: 1 });
    expect(referencesTo('#include "/chapters/one.typ"', 'src/main.typ', 'src/chapters/one.typ', 'src')).toHaveLength(1);
  });
});
