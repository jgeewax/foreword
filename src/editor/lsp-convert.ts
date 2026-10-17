// Monaco ↔ LSP conversions. Monaco is 1-based (lines and UTF-16 columns), LSP
// is 0-based with UTF-16 `character` offsets, so conversion is a plain shift.

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspContentChange = { range: LspRange; text: string };

export type MonacoRange = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
export type MonacoContentChange = { range: MonacoRange; text: string };

/**
 * One Monaco content-change event → LSP `contentChanges`. Monaco emits a
 * multi-edit event's changes in an order that applies sequentially (later
 * positions first), which is exactly LSP's semantics, so order is preserved.
 */
export function toLspChanges(changes: readonly MonacoContentChange[]): LspContentChange[] {
  return changes.map((c) => ({
    range: {
      start: { line: c.range.startLineNumber - 1, character: c.range.startColumn - 1 },
      end: { line: c.range.endLineNumber - 1, character: c.range.endColumn - 1 },
    },
    text: c.text,
  }));
}

export function offsetAt(text: string, pos: LspPosition): number {
  let offset = 0;
  for (let line = 0; line < pos.line; line++) {
    const nl = text.indexOf('\n', offset);
    if (nl < 0) return text.length;
    offset = nl + 1;
  }
  return Math.min(offset + pos.character, text.length);
}

/** Apply LSP changes in order (reference implementation; used by tests). */
export function applyLspChanges(text: string, changes: readonly LspContentChange[]): string {
  for (const c of changes) {
    text = text.slice(0, offsetAt(text, c.range.start)) + c.text + text.slice(offsetAt(text, c.range.end));
  }
  return text;
}

export type LspDiagnostic = { range: LspRange; message: string; severity?: number; source?: string };
export type MarkerSeverityLevel = 'error' | 'warning' | 'info' | 'hint';
export type Marker = MonacoRange & { message: string; severity: MarkerSeverityLevel; source?: string };

export function toMarker(d: LspDiagnostic): Marker {
  const severity: MarkerSeverityLevel = d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : d.severity === 4 ? 'hint' : 'info';
  return {
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
    message: d.message,
    severity,
    source: d.source,
  };
}

/** file:// URI → workspace-relative path, or null if outside `root`. */
export function uriToRelative(uri: string, root: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(uri).pathname);
  } catch {
    return null;
  }
  const prefix = root.endsWith('/') ? root : root + '/';
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

export function relativeToUri(rel: string, root: string): string {
  const abs = (root.endsWith('/') ? root : root + '/') + rel;
  return 'file://' + abs.split('/').map(encodeURIComponent).join('/');
}
