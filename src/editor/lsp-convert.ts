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

/** An outline entry (DocumentSymbol, or the older flat SymbolInformation with `location`). */
export type LspSymbol = { name: string; kind: number; range?: LspRange; location?: { range: LspRange }; children?: LspSymbol[] };

/** A server's edit (formatting): unlike `contentChanges`, every range is in the original text. */
export type LspTextEdit = { range: LspRange; newText: string };

export function applyLspEdits(text: string, edits: readonly LspTextEdit[]): string {
  const at = edits.map((e) => ({ start: offsetAt(text, e.range.start), end: offsetAt(text, e.range.end), text: e.newText })).sort((a, b) => b.start - a.start);
  for (const e of at) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}

export type LspDiagnostic = { range: LspRange; message: string; severity?: number; source?: string };
export type MarkerSeverityLevel = 'error' | 'warning' | 'info' | 'hint';
export type Marker = MonacoRange & { message: string; severity: MarkerSeverityLevel; source?: string };

export function toMonacoRange(r: LspRange): MonacoRange {
  return { startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 };
}

export function toMarker(d: LspDiagnostic): Marker {
  const severity: MarkerSeverityLevel = d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : d.severity === 4 ? 'hint' : 'info';
  return { ...toMonacoRange(d.range), message: d.message, severity, source: d.source };
}

export type LspLocation = { uri: string; range: LspRange };
export type LspLocationLink = { originSelectionRange?: LspRange; targetUri: string; targetRange: LspRange; targetSelectionRange: LspRange };

/** Where something is defined: its file, the whole definition, its name in it, and (if the server says) the name that was asked about. */
export type Definition = { uri: string; range: LspRange; nameRange: LspRange; originRange?: LspRange };

/** textDocument/definition's answer (a Location, Locations or LocationLinks) as a list. */
export function definitions(result: LspLocation | LspLocation[] | LspLocationLink[] | null | undefined): Definition[] {
  const list: (LspLocation | LspLocationLink)[] = result == null ? [] : Array.isArray(result) ? result : [result];
  return list.map((d) =>
    'targetUri' in d
      ? { uri: d.targetUri, range: d.targetRange, nameRange: d.targetSelectionRange, originRange: d.originSelectionRange }
      : { uri: d.uri, range: d.range, nameRange: d.range },
  );
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
