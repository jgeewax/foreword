// Open documents: one Monaco model per file, kept in sync with Tinymist.
// Disk is authoritative (SPEC §4); buffers are working copies. Saves are
// conflict-checked; external changes reload clean buffers and flag dirty ones.
import { ipc, isCmdError } from '../lib/ipc';
import type { TypstService } from '../services/typst';
import { blankLinesAroundHeadings, headingRanges } from './format';
import { applyLspEdits, relativeToUri, toLspChanges, toMarker, type LspDiagnostic } from './lsp-convert';
import { languageFor, monaco } from './monaco';
import { minimalEdit, smallEdits } from './text-edit';

/** How long a save waits for the formatter before saving the text as it is (VS Code: 750 ms). */
export const FORMAT_TIMEOUT_MS = 1500;

/**
 * What formatting did: `syntax-error` when typstyle can't parse the file,
 * `changed` when the text changed while it worked (so its edits were dropped),
 * `unavailable` for files that aren't Typst or when Tinymist isn't running.
 */
export type FormatOutcome = 'formatted' | 'unchanged' | 'syntax-error' | 'changed' | 'timeout' | 'unavailable';

export type Doc = {
  path: string;
  uri: string;
  model: monaco.editor.ITextModel;
  /** Hash of the file on disk as last read or written by us; null = not on disk. */
  diskHash: string | null;
  savedAltVersion: number;
  isTypst: boolean;
  lspOpen: boolean;
};

export type DocumentHooks = {
  onEdit(path: string): void;
  onDirtyChange(path: string, dirty: boolean): void;
  onConflict(path: string, message: string | null): void;
};

export class Documents {
  private docs = new Map<string, Doc>();
  private dirty = new Map<string, boolean>();

  constructor(
    private readonly root: string,
    private readonly typst: TypstService,
    private readonly hooks: DocumentHooks,
  ) {}

  get(path: string) {
    return this.docs.get(path);
  }

  all() {
    return [...this.docs.values()];
  }

  isDirty(doc: Doc) {
    return doc.model.getAlternativeVersionId() !== doc.savedAltVersion;
  }

  async open(path: string): Promise<Doc> {
    const existing = this.docs.get(path);
    if (existing) return existing;
    const { text, hash } = await ipc.fsRead(path);
    const raced = this.docs.get(path);
    if (raced) return raced;
    const uri = relativeToUri(path, this.root);
    const model = monaco.editor.createModel(text, languageFor(path), monaco.Uri.parse(uri));
    const doc: Doc = {
      path,
      uri,
      model,
      diskHash: hash,
      savedAltVersion: model.getAlternativeVersionId(),
      isTypst: path.endsWith('.typ'),
      lspOpen: false,
    };
    model.onDidChangeContent((e) => {
      if (doc.lspOpen) this.typst.didChange(uri, model.getVersionId(), toLspChanges(e.changes));
      this.hooks.onEdit(path);
      this.updateDirty(doc);
    });
    this.docs.set(path, doc);
    this.openInLsp(doc);
    return doc;
  }

  /** (Re)send didOpen for Typst documents, e.g. after Tinymist (re)starts. */
  syncLsp() {
    for (const doc of this.docs.values()) {
      doc.lspOpen = false;
      this.openInLsp(doc);
    }
  }

  private openInLsp(doc: Doc) {
    if (!doc.isTypst || doc.lspOpen || !this.typst.running) return;
    this.typst.didOpen(doc.uri, doc.model.getValue(), doc.model.getVersionId());
    doc.lspOpen = true;
  }

  private updateDirty(doc: Doc) {
    const dirty = this.isDirty(doc);
    if (this.dirty.get(doc.path) !== dirty) {
      this.dirty.set(doc.path, dirty);
      this.hooks.onDirtyChange(doc.path, dirty);
    }
  }

  /**
   * Format a Typst buffer with Tinymist's typstyle, then blank lines around
   * headings (format.ts), as one undoable step. The edits are cut down to
   * what changed, so the cursor stays put. Nothing happens if the text changes
   * while the formatter works.
   */
  async format(path: string, timeoutMs = FORMAT_TIMEOUT_MS): Promise<FormatOutcome> {
    const doc = this.docs.get(path);
    if (!doc?.isTypst || !doc.lspOpen || !this.typst.running) return 'unavailable';
    const { model } = doc;
    const deadline = Date.now() + timeoutMs;
    const ask = async <T>(request: Promise<T>): Promise<T | 'timeout' | 'unavailable'> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()))));
      return Promise.race([request, timeout])
        .catch(() => 'unavailable' as const)
        .finally(() => clearTimeout(timer));
    };
    const version = model.getVersionId();
    const before = model.getValue();
    const edits = await ask(this.typst.format(doc.uri));
    if (edits === 'timeout' || edits === 'unavailable') return edits;
    if (edits === null) return 'syntax-error';
    if (model.isDisposed() || model.getVersionId() !== version) return 'changed';
    model.pushStackElement();
    let changed = this.replaceText(model, before, applyLspEdits(before, edits));
    // The headings come from Tinymist's syntax tree of the formatted text (not
    // lines inside equations or raw blocks that start with `=`).
    const formatted = model.getVersionId();
    const symbols = await ask(this.typst.documentSymbols(doc.uri));
    if (Array.isArray(symbols) && !model.isDisposed() && model.getVersionId() === formatted) {
      const text = model.getValue();
      changed = this.replaceText(model, text, blankLinesAroundHeadings(text, headingRanges(symbols))) || changed;
    }
    if (!model.isDisposed()) model.pushStackElement();
    return changed ? 'formatted' : 'unchanged';
  }

  /** Turn the model's text (`before`) into `after` with small edits, in the open undo step. False if they're the same. */
  private replaceText(model: monaco.editor.ITextModel, before: string, after: string): boolean {
    const changes = smallEdits(before, after);
    if (!changes.length) return false;
    model.pushEditOperations(
      [],
      changes.map((c) => ({ range: monaco.Range.fromPositions(model.getPositionAt(c.start), model.getPositionAt(c.end)), text: c.text })),
      () => null,
    );
    return true;
  }

  /**
   * Write the buffer to disk if the file is still the version we loaded.
   * `overwrite` is the explicit "keep my version" conflict resolution;
   * `format` formats a Typst file first (format on save).
   */
  async save(path: string, { overwrite = false, format = false } = {}) {
    const doc = this.docs.get(path);
    if (!doc) return;
    if (format) {
      const outcome = await this.format(path);
      if (outcome === 'timeout') void ipc.uiLog(`format on save: no answer from Tinymist in ${FORMAT_TIMEOUT_MS} ms; ${path} saved unformatted`);
      if (doc.model.isDisposed()) return;
    }
    const text = doc.model.getValue();
    const altVersion = doc.model.getAlternativeVersionId();
    const expected = overwrite ? await ipc.fsHash(path) : doc.diskHash;
    try {
      doc.diskHash = await ipc.fsWrite(path, text, expected);
    } catch (e) {
      if (isCmdError(e) && e.kind === 'conflict') this.hooks.onConflict(path, e.message);
      throw e;
    }
    doc.savedAltVersion = altVersion;
    this.updateDirty(doc);
    this.hooks.onConflict(path, null);
    if (doc.lspOpen) this.typst.didSave(doc.uri);
  }

  /** Flush all dirty buffers (before agent runs). Returns paths that failed. */
  async saveAll(): Promise<{ path: string; error: unknown }[]> {
    const failures: { path: string; error: unknown }[] = [];
    for (const doc of this.docs.values()) {
      if (!this.isDirty(doc)) continue;
      try {
        await this.save(doc.path);
      } catch (error) {
        failures.push({ path: doc.path, error });
      }
    }
    return failures;
  }

  /** Discard the buffer and load what's on disk (also the "reload" conflict resolution). */
  async reload(path: string) {
    const doc = this.docs.get(path);
    if (!doc) return;
    const { text, hash } = await ipc.fsRead(path);
    const edit = minimalEdit(doc.model.getValue(), text);
    if (edit) {
      const start = doc.model.getPositionAt(edit.start);
      const end = doc.model.getPositionAt(edit.end);
      // An undo step of its own: ⌘Z takes off the reload, not the typing before it too.
      doc.model.pushStackElement();
      doc.model.pushEditOperations(
        [],
        [{ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: edit.text }],
        () => null,
      );
      doc.model.pushStackElement();
    }
    doc.diskHash = hash;
    doc.savedAltVersion = doc.model.getAlternativeVersionId();
    this.updateDirty(doc);
    this.hooks.onConflict(path, null);
  }

  /** Filesystem watcher callback: reconcile open buffers with disk. */
  async diskChanged(paths: string[]) {
    for (const path of new Set(paths)) {
      const doc = this.docs.get(path);
      if (!doc) continue;
      const hash = await ipc.fsHash(path);
      if (hash === doc.diskHash) continue; // our own write, or nothing changed
      if (hash === null) {
        this.hooks.onConflict(path, 'The file was deleted on disk.');
      } else if (!this.isDirty(doc)) {
        await this.reload(path);
      } else {
        this.hooks.onConflict(path, 'The file changed on disk while you had unsaved edits.');
      }
    }
  }

  setDiagnostics(path: string, diagnostics: LspDiagnostic[]) {
    const doc = this.docs.get(path);
    if (!doc) return;
    const severity = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info, hint: monaco.MarkerSeverity.Hint };
    monaco.editor.setModelMarkers(
      doc.model,
      'tinymist',
      diagnostics.map((d) => {
        const m = toMarker(d);
        return { ...m, severity: severity[m.severity] };
      }),
    );
  }

  close(path: string) {
    const doc = this.docs.get(path);
    if (!doc) return;
    if (doc.lspOpen) this.typst.didClose(doc.uri);
    doc.model.dispose();
    this.docs.delete(path);
    this.dirty.delete(path);
  }

  dispose() {
    for (const path of [...this.docs.keys()]) this.close(path);
  }
}
