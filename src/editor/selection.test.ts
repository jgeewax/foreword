import { describe, expect, it } from 'vitest';
import { captureSelection, formatSelectionContext, selectionLabel, sha256, type EditorRange, type SelectionSource } from './selection';

function fakeModel(text: string, version = 7): SelectionSource {
  const lines = text.split('\n');
  return {
    getValue: () => text,
    getVersionId: () => version,
    getLineMaxColumn: (line) => lines[line - 1].length + 1,
    getValueInRange: (r: EditorRange) => {
      const out: string[] = [];
      for (let l = r.startLineNumber; l <= r.endLineNumber; l++) {
        const s = l === r.startLineNumber ? r.startColumn - 1 : 0;
        const e = l === r.endLineNumber ? r.endColumn - 1 : lines[l - 1].length;
        out.push(lines[l - 1].slice(s, e));
      }
      return out.join('\n');
    },
  };
}

const TEXT = '= Eigen\n\nLet $A$ be a matrix.\n$ A v = lambda v $\nDone.';

describe('captureSelection', () => {
  it('captures two lines with exact text, 1-based positions, version and hash', async () => {
    const s = await captureSelection('chapters/ch2.typ', fakeModel(TEXT), { startLineNumber: 3, startColumn: 1, endLineNumber: 4, endColumn: 19 });
    expect(s).toEqual({
      relativePath: 'chapters/ch2.typ',
      selectedText: 'Let $A$ be a matrix.\n$ A v = lambda v $',
      start: { line: 3, column: 1 },
      end: { line: 4, column: 19 },
      documentVersion: 7,
      contentHash: await sha256(TEXT),
    });
    expect(selectionLabel(s)).toBe('chapters/ch2.typ:3–4');
  });

  it('drops the trailing line when a whole-line selection ends at column 1', async () => {
    const s = await captureSelection('a.typ', fakeModel(TEXT), { startLineNumber: 3, startColumn: 1, endLineNumber: 5, endColumn: 1 });
    expect(s.end).toEqual({ line: 4, column: 19 });
    expect(s.selectedText).toBe('Let $A$ be a matrix.\n$ A v = lambda v $');
    expect(selectionLabel(s)).toBe('a.typ:3–4');
  });

  it('records the cursor when nothing is selected', async () => {
    const s = await captureSelection('a.typ', fakeModel(TEXT), { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 5 });
    expect(s.selectedText).toBe('');
    expect(selectionLabel(s)).toBe('a.typ:3:5');
    expect(formatSelectionContext(s, false)).toBe('The cursor is in a.typ at line 3, column 5.');
  });

  it('handles non-ASCII text with UTF-16 columns', async () => {
    const text = 'λ ≤ μ → ν\nnext';
    const s = await captureSelection('m.typ', fakeModel(text), { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 6 });
    expect(s.selectedText).toBe('≤ μ');
  });
});

describe('formatSelectionContext', () => {
  it('includes the exact text and range, and marks stale selections', async () => {
    const s = await captureSelection('c.typ', fakeModel(TEXT), { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 21 });
    const fresh = formatSelectionContext(s, false);
    expect(fresh).toContain('<selection path="c.typ" start="3:1" end="3:21">\nLet $A$ be a matrix.\n</selection>');
    expect(fresh).not.toContain('changed');
    expect(formatSelectionContext(s, true)).toContain('the buffer changed after this was selected');
  });
});
