import { describe, expect, it } from 'vitest';
import { scanImports } from './includes';
import { fileUses, importLine, snippetPrelude } from './snippet-book';

describe('a file’s top-level imports', () => {
  it('reads each import with the rest of its statement', () => {
    const text = [
      '#import "template/lib.typ": *',
      '#import "@preview/cetz:0.4.2": canvas, draw',
      '#import "diagrams.typ": (',
      '  axis-style, canvas,',
      ')',
      '#import "metadata.typ" as meta;',
      '= Heading',
    ].join('\n');
    expect(scanImports(text)).toEqual([
      { spec: 'template/lib.typ', rest: ': *' },
      { spec: '@preview/cetz:0.4.2', rest: ': canvas, draw' },
      { spec: 'diagrams.typ', rest: ': (\n  axis-style, canvas,\n)' },
      { spec: 'metadata.typ', rest: ' as meta' },
    ]);
  });

  it('leaves out imports in blocks, functions, comments and raw text', () => {
    const text = [
      '#let f() = [',
      '  #import "inside.typ": *',
      ']',
      '// #import "commented.typ": *',
      '```typst',
      '#import "example.typ": *',
      '```',
      '#{',
      '  import "code.typ": *',
      '}',
      'Text, then #import "late.typ": x',
    ].join('\n');
    expect(scanImports(text)).toEqual([{ spec: 'late.typ', rest: ': x' }]);
  });
});

describe('importing for a snippet', () => {
  it('makes paths root-absolute, from the file they’re in', () => {
    const lib = { spec: '../template/lib.typ', rest: ': *' };
    expect(importLine('src/chapters/ch17.typ', lib, 'src')).toBe('#import "/template/lib.typ": *');
    expect(importLine('chapters/ch1.typ', { spec: '../style.typ', rest: ': *' }, '')).toBe('#import "/style.typ": *');
    expect(importLine('src/chapters/ch1.typ', { spec: '/template/math.typ', rest: ': vect' }, 'src')).toBe('#import "/template/math.typ": vect');
  });

  it('keeps packages, and leaves out what’s outside the root', () => {
    expect(importLine('src/main.typ', { spec: '@preview/cetz:0.4.2', rest: '' }, 'src')).toBe('#import "@preview/cetz:0.4.2"');
    expect(importLine('src/main.typ', { spec: '../shared.typ', rest: ': *' }, 'src')).toBeNull();
    expect(importLine('main.typ', { spec: '../shared.typ', rest: ': *' }, '')).toBeNull();
  });
});

describe('the prelude of a book’s snippets', () => {
  const files: Record<string, string> = {
    'src/main.typ': '#import "template/lib.typ": *\n#import "metadata.typ": *\n#include "chapters/ch1.typ"\n#include "chapters/ch2.typ"\n',
    'src/chapters/ch1.typ': '#import "../template/lib.typ": *\n= One\n#include "parts/aside.typ"\n',
    'src/chapters/parts/aside.typ': '#import "/figures/style.typ": palette\nAside.\n',
    'src/chapters/ch2.typ': '#import "../template/lib.typ": *\n#import "@preview/cetz:0.4.2"\n= Two\n#include "ch1.typ"\n',
    'src/drafts/old.typ': '#import "../old-style.typ": *\n',
  };
  const uses = (path: string) => (path in files ? fileUses(files[path]) : undefined);

  it('has every import of the main file and what it includes, each once, in order', () => {
    expect(snippetPrelude('src/main.typ', uses, 'src')).toBe(
      ['#import "/template/lib.typ": *', '#import "/metadata.typ": *', '#import "/figures/style.typ": palette', '#import "@preview/cetz:0.4.2"'].join('\n'),
    );
  });

  it('is empty for a book that imports nothing', () => {
    expect(snippetPrelude('main.typ', (p) => (p === 'main.typ' ? fileUses('= Book\n#include "a.typ"') : undefined), '')).toBe('');
  });
});
