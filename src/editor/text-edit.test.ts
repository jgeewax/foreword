import { describe, expect, it } from 'vitest';
import { applyLspEdits } from './lsp-convert';
import { smallEdits, type OffsetEdit } from './text-edit';

const apply = (text: string, edits: OffsetEdit[]) => [...edits].reverse().reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text);

// What typstyle (Tinymist 0.15) makes of an equation: `&` columns lined up, spaces after `&`.
const equation = ['$', '  f(x) &= x^2 + 1 && "if" x > 0 \\', '  f(x) &= 0 && "otherwise"', '$', ''].join('\n');
const formatted = ['$', '  f(x) & = x^2 + 1 && "if" x > 0 \\', '  f(x) & = 0       && "otherwise"', '$', ''].join('\n');

describe('smallEdits', () => {
  const pairs: [string, string][] = [
    [equation, formatted],
    ['#let f(x,y)=x+y\n\n= Heading\n', '#let f(x, y) = x + y\n\n= Heading\n'],
    ['#table(columns:3, [a],[b],[c])\n', '#table(\n  columns: 3,\n  [a], [b], [c],\n)\n'],
    ['a\nb\nc', 'a\nc'],
    ['a\nb', 'a'],
    ['a', 'a\n'],
    ['a\n', 'a'],
    ['', 'new\n'],
    ['old\n', ''],
    ['x  \ny\t\n', 'x\ny\n'],
    ['one\r\ntwo  \r\n', 'one\r\ntwo\r\n'],
    ['😀 smile', '😃 smile'],
    ['a😀b', 'a😀😀b'],
    ['same\n', 'same\n'],
  ];

  it.each(pairs)('turns %j into %j', (before, after) => {
    const edits = smallEdits(before, after);
    expect(apply(before, edits)).toBe(after);
    // In order, not touching: Monaco applies them all at once.
    for (let i = 1; i < edits.length; i++) expect(edits[i].start).toBeGreaterThan(edits[i - 1].end);
  });

  it('leaves unchanged lines alone and changes lines only where they differ', () => {
    const edits = smallEdits(equation, formatted);
    // Between the `$` lines.
    expect(edits.every((e) => e.start > equation.indexOf('\n') && e.end < equation.lastIndexOf('$'))).toBe(true);
    // Only spaces go in: the text around the cursor never moves under it.
    expect(edits.every((e) => e.start === e.end && /^ +$/.test(e.text))).toBe(true);
    expect(smallEdits('a&=b', 'a & =b')).toEqual([
      { start: 1, end: 1, text: ' ' },
      { start: 2, end: 2, text: ' ' },
    ]);
  });

  it('never splits a surrogate pair', () => {
    const [e] = smallEdits('😀', '😃');
    expect(e).toEqual({ start: 0, end: 2, text: '😃' });
  });
});

describe('applyLspEdits', () => {
  it('applies edits whose ranges are all in the original text, in any order', () => {
    const text = 'ab\ncd\nef';
    const at = (line: number, character: number) => ({ line, character });
    const edits = [
      { range: { start: at(2, 0), end: at(2, 1) }, newText: 'E' },
      { range: { start: at(0, 1), end: at(1, 1) }, newText: 'X' },
    ];
    expect(applyLspEdits(text, edits)).toBe('aXd\nEf');
  });
});
