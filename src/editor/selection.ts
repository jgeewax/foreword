// Selection context attached to agent messages (SPEC §2 workflow 2, §4).
// Lines and columns are 1-based, as shown in the editor.

export type SourceSelection = {
  relativePath: string;
  selectedText: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
  /** Monaco model version id when captured. */
  documentVersion: number;
  /** sha-256 of the whole buffer when captured. */
  contentHash: string;
};

export type EditorRange = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };

export type SelectionSource = {
  getValue(): string;
  getValueInRange(range: EditorRange): string;
  getLineMaxColumn(line: number): number;
  getVersionId(): number;
};

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function captureSelection(relativePath: string, model: SelectionSource, range: EditorRange): Promise<SourceSelection> {
  const isEmpty = range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn;
  let end = { line: range.endLineNumber, column: range.endColumn };
  // Selecting whole lines leaves the caret at column 1 of the next line; that line isn't part of it.
  if (!isEmpty && end.column === 1 && end.line > range.startLineNumber) {
    end = { line: end.line - 1, column: model.getLineMaxColumn(end.line - 1) };
  }
  const start = { line: range.startLineNumber, column: range.startColumn };
  return {
    relativePath,
    selectedText: isEmpty
      ? ''
      : model.getValueInRange({ startLineNumber: start.line, startColumn: start.column, endLineNumber: end.line, endColumn: end.column }),
    start,
    end,
    documentVersion: model.getVersionId(),
    contentHash: await sha256(model.getValue()),
  };
}

/** `chapters/eigen.typ:32–39`, `…:32`, or `…:32:5` for a bare cursor. */
export function selectionLabel(s: SourceSelection): string {
  if (!s.selectedText) return `${s.relativePath}:${s.start.line}:${s.start.column}`;
  if (s.start.line === s.end.line) return `${s.relativePath}:${s.start.line}`;
  return `${s.relativePath}:${s.start.line}–${s.end.line}`;
}

/** Text block appended to the user's message so the agent gets the exact context. */
export function formatSelectionContext(s: SourceSelection, stale: boolean): string {
  const where = `${s.relativePath} lines ${s.start.line}:${s.start.column}–${s.end.line}:${s.end.column}`;
  const staleNote = stale ? ' (the buffer changed after this was selected; re-read the file)' : '';
  if (!s.selectedText) {
    return `The cursor is in ${s.relativePath} at line ${s.start.line}, column ${s.start.column}${staleNote}.`;
  }
  return `Selected in the editor: ${where}${staleNote}\n<selection path="${s.relativePath}" start="${s.start.line}:${s.start.column}" end="${s.end.line}:${s.end.column}">\n${s.selectedText.replace(/\n$/, '')}\n</selection>`;
}
