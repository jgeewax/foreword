import { describe, expect, it } from 'vitest';
import { aiEdit, bookPath, editMarks, parseRead, readLabel, readMarks, readOf } from './ai-marks';

const V = (id: string, time: number) => ({ id, label: `Agent: ${id}`, time });
const before = ['= One', '', 'The storm came.', 'Mara waited.', '', 'The end.'].join('\n');
const after = ['= One', '', 'The storm came at noon.', 'Mara waited.', 'A new line.', '', 'The end.'].join('\n');

describe('edit marks', () => {
  it('marks the lines the assistant changed, with what they replaced', () => {
    const e = aiEdit(V('v1', 10), before, after);
    expect(e.blocks).toEqual([
      { from: 2, to: 3, old: 'The storm came.' },
      { from: 4, to: 5, old: '' },
    ]);
    expect(editMarks([e], after).map((m) => [m.from, m.to, m.old])).toEqual([
      [3, 3, 'The storm came.'],
      [5, 5, ''],
    ]);
  });

  it('follows the text and drops lines the author has rewritten since', () => {
    const e = aiEdit(V('v1', 10), before, after);
    const now = `// a comment on top\n${after.replace('A new line.', 'My own line now.')}`;
    expect(editMarks([e], now).map((m) => [m.from, m.to])).toEqual([[4, 4]]);
  });

  it('lets a newer version win where both changed a line, and marks removals', () => {
    const e1 = aiEdit(V('v1', 10), before, after);
    // v2 rewrites v1's line and removes v1's added line (a separate change).
    const after2 = after.replace('The storm came at noon.', 'The storm came at dawn.').replace('A new line.\n', '');
    const e2 = aiEdit(V('v2', 20), after, after2);
    const marks = editMarks([e1, e2], after2);
    expect(marks.map((m) => [m.from, m.versionId, m.removal])).toEqual([
      [3, 'v2', false],
      [5, 'v2', true],
    ]);
    expect(marks[0].old).toBe('The storm came at noon.');
    expect(marks[1].old).toBe('A new line.');
    // A removal at the very end marks the (new) last line.
    const after3 = after2.replace('\n\nThe end.', '');
    expect(editMarks([aiEdit(V('v3', 30), after2, after3)], after3)).toMatchObject([{ from: 4, removal: true, old: '\nThe end.' }]);
  });

  it('marks a whole new file', () => {
    expect(editMarks([aiEdit(V('v1', 1), null, 'a\nb')], 'a\nb')).toMatchObject([{ from: 1, to: 2, old: '' }]);
  });
});

describe('reads', () => {
  it('parses both read formats and ignores non-text reads', () => {
    expect(parseRead('ch1.typ', 'Read file ch1.typ, lines 3-4\n3: The storm came.\n4: 12: looks numbered\n[Output truncated. Continue reading with offset: 5]', 1)).toEqual({
      path: 'ch1.typ',
      start: 3,
      lines: ['The storm came.', '12: looks numbered'],
      time: 1,
    });
    expect(parseRead('x', '<path>/b/x</path>\n<type>file</type>\n<content>\n440: a\n441: \n442: b\n</content>')?.lines).toEqual(['a', '', 'b']);
    expect(parseRead('x.png', 'Image read successfully')).toBeNull();
  });

  it('takes book paths from tool input, relative or absolute', () => {
    expect(bookPath('/b', 'chapters/x.typ')).toBe('chapters/x.typ');
    expect(bookPath('/b', './x.typ')).toBe('x.typ');
    expect(bookPath('/b', '/b/chapters/x.typ')).toBe('chapters/x.typ');
    expect(bookPath('/b', '/other/x.typ')).toBeNull();
    expect(bookPath('/b', '../x.typ')).toBeNull();
    expect(bookPath('/b', 42)).toBeNull();
    const r = readOf('/b', 'read', { filePath: '/b/ch.typ', offset: 3 }, 'Read file ch.typ, lines 3-5\n3: a\n4: b\n5: c')!;
    expect(readLabel(r)).toBe('ch.typ · lines 3–5');
    expect(readOf('/b', 'grep', { path: 'ch.typ' }, '3: a')).toBeNull();
  });

  it('places reads on the current text and merges overlaps', () => {
    const r1 = parseRead('c', 'Read file c, lines 1-3\n1: = One\n2: \n3: The storm came.')!;
    const r2 = parseRead('c', 'Read file c, lines 3-4\n3: The storm came.\n4: Mara waited.')!;
    expect(readMarks([r1, r2], before)).toMatchObject([{ from: 1, to: 4 }]);
    // Lines added above move the read down; a rewritten line inside it doesn't break it.
    const moved = `Intro.\n\n${before.replace('Mara waited.', 'Mara waited, cold.')}`;
    expect(readMarks([r2], moved)).toMatchObject([{ from: 5, to: 5 }]);
    expect(readMarks([r1, r2], moved)).toMatchObject([{ from: 3, to: 5 }]);
  });

  it('stays quick on a long file', () => {
    const big = Array.from({ length: 4000 }, (_, i) => `Line ${i}`).join('\n');
    const read = parseRead('b', `Read file b, lines 2001-2035\n${Array.from({ length: 35 }, (_, i) => `${2001 + i}: Line ${2000 + i}`).join('\n')}`)!;
    const t = performance.now();
    expect(readMarks([read], `New first line\n${big}`)).toMatchObject([{ from: 2002, to: 2036 }]);
    expect(performance.now() - t).toBeLessThan(300);
  });
});
