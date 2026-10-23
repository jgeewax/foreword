import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';
import { bookFiles, linkBlocks, linkInlines, refNamed, refTitle, splitRefs } from './source-links';

const ROOT = '/Users/ada/Books/Linear Algebra';
const book = bookFiles(['main.typ', 'chapters/one.typ', 'chapters/two.typ', 'drafts/two.typ', 'Chapter Three.typ', 'figures/a.png'], ROOT);
const refs = (text: string) => splitRefs(book, text).filter((p) => typeof p !== 'string');

describe('splitRefs', () => {
  it('finds a file and its line, as assistants write them', () => {
    expect(splitRefs(book, 'See chapters/one.typ:42 for it.')).toEqual(['See ', { text: 'chapters/one.typ:42', to: { path: 'chapters/one.typ', line: 42 } }, ' for it.']);
    expect(refs('at one.typ:42:7')[0]).toMatchObject({ to: { path: 'chapters/one.typ', line: 42, column: 7 } });
    expect(refs('one.typ:42-48 and one.typ:3–5')).toMatchObject([{ to: { line: 42, endLine: 48 } }, { to: { line: 3, endLine: 5 } }]);
    expect(refs('chapters/one.typ#L42-L48')[0]).toMatchObject({ text: 'chapters/one.typ#L42-L48', to: { line: 42, endLine: 48 } });
    expect(refs('main.typ#L9C3')[0]).toMatchObject({ to: { path: 'main.typ', line: 9, column: 3 } });
  });

  it('reads a line written in words, before or after the name', () => {
    expect(refs('in one.typ, line 12, the')[0]).toMatchObject({ text: 'one.typ, line 12', to: { line: 12 } });
    expect(refs('one.typ (lines 12–20) has')[0]).toMatchObject({ text: 'one.typ (lines 12–20)', to: { line: 12, endLine: 20 } });
    expect(refs('main.typ at line 4.')[0]).toMatchObject({ text: 'main.typ at line 4', to: { path: 'main.typ', line: 4 } });
    expect(refs('Lines 3 to 5 of one.typ say')[0]).toMatchObject({ text: 'Lines 3 to 5 of one.typ', to: { path: 'chapters/one.typ', line: 3, endLine: 5 } });
    expect(refs('line 8 in main.typ.')[0]).toMatchObject({ text: 'line 8 in main.typ', to: { line: 8 } });
  });

  it('takes a whole path from the book’s folder, and a name with spaces', () => {
    expect(refs(`edited ${ROOT}/chapters/one.typ:42 now`)[0]).toMatchObject({ text: `${ROOT}/chapters/one.typ:42`, to: { path: 'chapters/one.typ', line: 42 } });
    expect(refs('~/Books/Linear Algebra/main.typ:1')[0]).toMatchObject({ to: { path: 'main.typ', line: 1 } });
    expect(refs('In Chapter Three.typ:7 the')[0]).toMatchObject({ text: 'Chapter Three.typ:7', to: { path: 'Chapter Three.typ' } });
    expect(refs('./main.typ:2')[0]).toMatchObject({ to: { path: 'main.typ', line: 2 } });
  });

  it('links only the book’s files, and only with a line', () => {
    expect(refs('at 10:30, v1.2:3, other.typ:4, nowhere/one.typ:5')).toEqual([]);
    // two.typ ends two files' paths: which one isn't known.
    expect(refs('two.typ:3')).toEqual([]);
    expect(refs('drafts/two.typ:3')[0]).toMatchObject({ to: { path: 'drafts/two.typ' } });
    expect(refs('chapters/one.typ and main.typ, lines are short')).toEqual([]);
    expect(refs('xone.typ:3 one.typst:3')).toEqual([]);
  });
});

describe('refNamed', () => {
  it('reads a file, or a place in one, from code or a link’s address', () => {
    expect(refNamed(book, 'chapters/one.typ')).toEqual({ path: 'chapters/one.typ' });
    expect(refNamed(book, 'one.typ:42')).toEqual({ path: 'chapters/one.typ', line: 42 });
    expect(refNamed(book, 'chapters/one.typ#L4-L6')).toEqual({ path: 'chapters/one.typ', line: 4, endLine: 6 });
    expect(refNamed(book, `file://${encodeURI(ROOT)}/main.typ`)).toEqual({ path: 'main.typ' });
    expect(refNamed(book, 'Chapter%20Three.typ:2')).toEqual({ path: 'Chapter Three.typ', line: 2 });
    expect(refNamed(book, 'figures/a.png')).toEqual({ path: 'figures/a.png' });
    expect(refNamed(book, 'https://typst.app/docs')).toBeNull();
    expect(refNamed(book, '#include "chapters/one.typ"')).toBeNull();
  });
});

describe('linkInlines', () => {
  it('links code and links that name a place, and the line in the words around `code`', () => {
    const linked = linkInlines(parseInline('`one.typ:3`, `main.typ` (line 9), line 4 of `one.typ`, [the intro](chapters/one.typ#L2), [Typst](https://typst.app)'), book);
    const found = linked.filter((n) => n.t === 'ref');
    expect(found.map((n) => n.t === 'ref' && n.to)).toEqual([
      { path: 'chapters/one.typ', line: 3 },
      { path: 'main.typ', line: 9 },
      { path: 'chapters/one.typ', line: 4 },
      { path: 'chapters/one.typ', line: 2 },
    ]);
    expect(found[0]).toMatchObject({ c: [{ t: 'code', v: 'one.typ:3' }] });
    expect(found[3]).toMatchObject({ c: [{ t: 'text', v: 'the intro' }] });
    expect(linked.some((n) => n.t === 'link' && n.href === 'https://typst.app')).toBe(true);
  });

  it('looks inside emphasis and tables, not code blocks', () => {
    const blocks = linkBlocks(parseMarkdown('**See one.typ:3**\n\n| where |\n| --- |\n| main.typ:1 |\n\n```\none.typ:3\n```'), book);
    expect(JSON.stringify(blocks[0])).toContain('"t":"ref"');
    expect(JSON.stringify(blocks[1])).toContain('"t":"ref"');
    expect(blocks[2]).toEqual({ t: 'code', lang: '', v: 'one.typ:3' });
  });
});

describe('refTitle', () => {
  it('says where it goes', () => {
    expect(refTitle({ path: 'main.typ' })).toBe('Open main.typ');
    expect(refTitle({ path: 'main.typ', line: 4 })).toBe('Go to main.typ, line 4');
    expect(refTitle({ path: 'main.typ', line: 4, endLine: 6 })).toBe('Go to main.typ, lines 4–6');
  });
});
