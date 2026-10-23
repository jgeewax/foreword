import { describe, expect, it } from 'vitest';
import { applyLspChanges, definitions, relativeToUri, toLspChanges, toMarker, toMonacoRange, uriToRelative } from './lsp-convert';
import { minimalEdit } from './text-edit';

describe('toLspChanges', () => {
  it('converts 1-based Monaco ranges to 0-based LSP ranges', () => {
    expect(toLspChanges([{ range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 4 }, text: 'Hi' }])).toEqual([
      { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } }, text: 'Hi' },
    ]);
  });

  it('keeps multi-cursor edits applicable in order (Monaco emits later positions first)', () => {
    const before = 'aa\nbb\ncc';
    const changes = toLspChanges([
      { range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 }, text: '> ' },
      { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: '> ' },
    ]);
    expect(applyLspChanges(before, changes)).toBe('> aa\nbb\n> cc');
  });

  it('round-trips an insertion with a newline and a deletion across lines', () => {
    const text = 'one\ntwo\nthree';
    const inserted = applyLspChanges(text, toLspChanges([{ range: { startLineNumber: 2, startColumn: 4, endLineNumber: 2, endColumn: 4 }, text: '\nnew' }]));
    expect(inserted).toBe('one\ntwo\nnew\nthree');
    const deleted = applyLspChanges(inserted, toLspChanges([{ range: { startLineNumber: 1, startColumn: 4, endLineNumber: 3, endColumn: 4 }, text: '' }]));
    expect(deleted).toBe('one\nthree');
  });
});

describe('uri mapping', () => {
  it('round-trips paths with spaces and non-ASCII', () => {
    const root = '/Users/me/My Books/Lineare Algebra';
    const uri = relativeToUri('chapters/ch 1 – Λ.typ', root);
    expect(uri).toBe('file:///Users/me/My%20Books/Lineare%20Algebra/chapters/ch%201%20%E2%80%93%20%CE%9B.typ');
    expect(uriToRelative(uri, root)).toBe('chapters/ch 1 – Λ.typ');
  });

  it('rejects URIs outside the workspace', () => {
    expect(uriToRelative('file:///etc/passwd', '/Users/me/book')).toBeNull();
    expect(uriToRelative('file:///Users/me/book2/x.typ', '/Users/me/book')).toBeNull();
  });
});

describe('toMarker', () => {
  it('maps LSP severities and ranges', () => {
    expect(toMarker({ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } }, message: 'unclosed delimiter', severity: 1 })).toEqual({
      startLineNumber: 1,
      startColumn: 3,
      endLineNumber: 1,
      endColumn: 6,
      message: 'unclosed delimiter',
      severity: 'error',
      source: undefined,
    });
  });
});

describe('definitions', () => {
  const range = (line: number, from: number, to: number) => ({ start: { line, character: from }, end: { line, character: to } });

  it('reads LocationLinks: the name defined, and the name clicked (#key-idea, with its hyphen)', () => {
    expect(
      definitions([{ originSelectionRange: range(171, 1, 9), targetUri: 'file:///b/style.typ', targetRange: range(128, 0, 60), targetSelectionRange: range(128, 5, 13) }]),
    ).toEqual([{ uri: 'file:///b/style.typ', range: range(128, 0, 60), nameRange: range(128, 5, 13), originRange: range(171, 1, 9) }]);
  });

  it('reads a Location, or a list of them', () => {
    const location = { uri: 'file:///b/main.typ', range: range(3, 2, 8) };
    const expected = [{ uri: 'file:///b/main.typ', range: range(3, 2, 8), nameRange: range(3, 2, 8) }];
    expect(definitions(location)).toEqual(expected);
    expect(definitions([location])).toEqual(expected);
  });

  it('is empty when there is no definition (a built-in like #figure)', () => {
    expect(definitions(null)).toEqual([]);
    expect(definitions(undefined)).toEqual([]);
    expect(definitions([])).toEqual([]);
  });

  it('converts to Monaco ranges, 1-based', () => {
    expect(toMonacoRange(range(128, 5, 13))).toEqual({ startLineNumber: 129, startColumn: 6, endLineNumber: 129, endColumn: 14 });
  });
});

describe('minimalEdit', () => {
  it('finds the smallest single replacement', () => {
    expect(minimalEdit('abc', 'abc')).toBeNull();
    expect(minimalEdit('hello world', 'hello brave world')).toEqual({ start: 6, end: 6, text: 'brave ' });
    expect(minimalEdit('aaa', 'aa')).toEqual({ start: 2, end: 3, text: '' });
    expect(minimalEdit('x = 1;\ny = 2;', 'x = 1;\ny = 3;')).toEqual({ start: 11, end: 12, text: '3' });
  });

  it('always reconstructs the target text', () => {
    const cases = [
      ['', 'new'],
      ['old', ''],
      ['abcabc', 'abc'],
      ['= Title\nbody\n', '= Title\nnew body\n// agent was here\n'],
    ];
    for (const [a, b] of cases) {
      const e = minimalEdit(a, b)!;
      expect(a.slice(0, e.start) + e.text + a.slice(e.end)).toBe(b);
    }
  });
});
