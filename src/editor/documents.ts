// Open documents: one Monaco model per file, kept in sync with Tinymist.
// Disk is authoritative (SPEC §4); buffers are working copies. Saves are
// conflict-checked. A file changed on disk (by an assistant, git, another
// editor) is merged into its buffer, unsaved edits and all (merge.ts): where
// both changed the same words the buffer keeps the author's, and a question
// card offers the other version. Nothing the author typed or saved is dropped.
import { errorMessage, ipc, isCmdError } from '../lib/ipc';
import type { TypstService } from '../services/typst';
import { blankLinesAroundHeadings, headingRanges, singleBlankLines } from './format';
import { applyLspEdits, relativeToUri, toLspChanges, toMarker, type LspDiagnostic } from './lsp-convert';
import { merge3, reconcile, type Question } from './merge';
import { languageFor, monaco } from './monaco';
import { smallEdits } from './text-edit';

/** How long a save waits for the formatter before saving the text as it is (VS Code: 750 ms). */
export const FORMAT_TIMEOUT_MS = 1500;

/**
 * What formatting did: `syntax-error` when typstyle can't parse the file,
 * `changed` when the text changed while it worked (so its edits were dropped),
 * `unavailable` for files that aren't Typst or when Tinymist isn't running.
 */
export type FormatOutcome = 'formatted' | 'unchanged' | 'syntax-error' | 'changed' | 'timeout' | 'unavailable';

/** A passage the merge asks about: the buffer has the author's; `theirs` is what the other version has there. */
export type MergeQuestion = {
  id: string;
  kind: Question['kind'];
  /** The passage as merged, and the other version of it. */
  mine: string;
  theirs: string;
  /** Who made the other version: the assistant at work then, or null (another program). */
  by: string | null;
};

type Asked = MergeQuestion & { decoration: string };

export type Doc = {
  path: string;
  uri: string;
  model: monaco.editor.ITextModel;
  /** Hash of the file on disk as last read or written by us; null = not on disk. */
  diskHash: string | null;
  /** The text with that hash: what both sides of a merge start from. */
  diskText: string;
  /** What an assistant at work may last have read: older than diskText when the author saved during its turn. */
  seenText: string;
  savedAltVersion: number;
  isTypst: boolean;
  lspOpen: boolean;
  questions: Asked[];
  /** Saves, merges and reloads of this file, one at a time. */
  queue: Promise<unknown>;
};

export type DocumentHooks = {
  onEdit(path: string): void;
  onDirtyChange(path: string, dirty: boolean): void;
  onConflict(path: string, message: string | null): void;
  onQuestions(path: string, questions: MergeQuestion[]): void;
  /** The assistant at work in the book now (its name), or null. */
  agentAtWork(): string | null;
};

let questionIds = 0;

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
      diskText: text,
      seenText: text,
      savedAltVersion: model.getAlternativeVersionId(),
      isTypst: path.endsWith('.typ'),
      lspOpen: false,
      questions: [],
      queue: Promise.resolve(),
    };
    model.onDidChangeContent((e) => {
      if (doc.lspOpen) this.typst.didChange(uri, model.getVersionId(), toLspChanges(e.changes));
      this.hooks.onEdit(path);
      this.updateDirty(doc);
      if (doc.questions.length) this.settleQuestions(doc);
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
   * headings and one blank line at most in a row (format.ts), as one undoable step. The edits are cut down to
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
    if (!model.isDisposed() && model.getVersionId() === formatted) {
      const text = model.getValue();
      const spaced = Array.isArray(symbols) ? blankLinesAroundHeadings(text, headingRanges(symbols)) : text;
      changed = this.replaceText(model, text, singleBlankLines(spaced)) || changed;
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

  /** Run `fn` after this file's earlier saves, merges and reloads. */
  private exclusive<T>(doc: Doc, fn: () => Promise<T>): Promise<T> {
    const run = doc.queue.then(fn, fn);
    doc.queue = run.catch(() => {});
    return run;
  }

  /**
   * Write the buffer to disk. If the file changed there since we last read it,
   * that change is merged into the buffer first, and the merge is saved.
   * `overwrite` writes over whatever is there (saving a file deleted on disk
   * again); `format` formats a Typst file first (format on save).
   */
  async save(path: string, { overwrite = false, format = false } = {}) {
    const doc = this.docs.get(path);
    if (!doc) return;
    if (format) {
      const outcome = await this.format(path);
      if (outcome === 'timeout') void ipc.uiLog(`format on save: no answer from Tinymist in ${FORMAT_TIMEOUT_MS} ms; ${path} saved unformatted`);
      if (doc.model.isDisposed()) return;
    }
    await this.exclusive(doc, async () => {
      for (let attempt = 0; ; attempt++) {
        if (doc.model.isDisposed()) return;
        const text = doc.model.getValue();
        const altVersion = doc.model.getAlternativeVersionId();
        const expected = overwrite ? await ipc.fsHash(path) : doc.diskHash;
        try {
          doc.diskHash = await ipc.fsWrite(path, text, expected);
        } catch (e) {
          if (!overwrite && attempt < 3 && isCmdError(e) && e.kind === 'conflict' && (await this.pull(doc))) continue;
          if (isCmdError(e) && e.kind === 'conflict') this.hooks.onConflict(path, e.message);
          throw e;
        }
        doc.diskText = text;
        // Saved while an assistant works: it hasn't seen this yet (see merge).
        if (!this.hooks.agentAtWork()) doc.seenText = text;
        doc.savedAltVersion = altVersion;
        this.updateDirty(doc);
        this.hooks.onConflict(path, null);
        if (doc.lspOpen) this.typst.didSave(doc.uri);
        return;
      }
    });
  }

  /** What's on disk now, merged into the buffer. False if the file isn't there. */
  private async pull(doc: Doc): Promise<boolean> {
    const hash = await ipc.fsHash(doc.path);
    if (hash === null) return false;
    if (hash === doc.diskHash) return true;
    const read = await ipc.fsRead(doc.path);
    if (!doc.model.isDisposed() && read.hash !== doc.diskHash) await this.merge(doc, read.text, read.hash);
    return true;
  }

  /**
   * Merge `incoming`, the file's new text on disk, into the buffer, as one
   * undoable step (merge.ts reconcile). What the author typed stays; where both
   * changed the same words, the buffer keeps the author's and asks. A save of
   * the author's that the new text lacks (written from an older copy) goes back
   * on disk.
   */
  private async merge(doc: Doc, incoming: string, hash: string) {
    const { model } = doc;
    // Read and replaced with no wait between: nothing typed meanwhile can be lost.
    const buffer = model.getValue();
    const r = reconcile({ seen: doc.seenText, disk: doc.diskText, buffer, incoming });
    if (r.text !== buffer) {
      model.pushStackElement();
      this.replaceText(model, buffer, r.text);
      model.pushStackElement();
    }
    doc.diskText = incoming;
    doc.diskHash = hash;
    doc.seenText = incoming;
    if (r.questions.length) this.ask(doc, r.questions);
    if (r.repair !== null) {
      try {
        doc.diskHash = await ipc.fsWrite(doc.path, r.repair, hash);
        doc.diskText = r.repair;
      } catch (e) {
        // Changed again meanwhile: the next merge has it. The buffer still has the author's text.
        void ipc.uiLog(`merge: couldn't put the saved text back in ${doc.path}: ${errorMessage(e)}`);
      }
    }
    if (!model.isDisposed() && model.getValue() === doc.diskText) doc.savedAltVersion = model.getAlternativeVersionId();
    this.updateDirty(doc);
    this.hooks.onConflict(doc.path, null);
  }

  /** Every open file's disk text counts as seen: an assistant starting a turn reads what's there. */
  markSeen() {
    for (const doc of this.docs.values()) doc.seenText = doc.diskText;
  }

  // ---- questions: passages a merge couldn't settle ------------------------------------

  private publish(doc: Doc) {
    this.hooks.onQuestions(
      doc.path,
      doc.questions.map(({ decoration: _, ...q }) => q),
    );
  }

  private ask(doc: Doc, questions: Question[]) {
    const { model } = doc;
    const ranges = questions.map((q) => monaco.Range.fromPositions(model.getPositionAt(q.start), model.getPositionAt(q.end)));
    // A newer question about the same passage replaces the older one.
    const replaced = doc.questions.filter((old) => {
      const r = model.getDecorationRange(old.decoration);
      if (!r) return true;
      const [s, e] = [model.getOffsetAt(r.getStartPosition()), model.getOffsetAt(r.getEndPosition())];
      return questions.some((n) => (n.start < e && s < n.end) || n.start === s);
    });
    const ids = model.deltaDecorations(
      replaced.map((q) => q.decoration),
      ranges.map((range) => ({
        range,
        options: {
          inlineClassName: 'merge-question',
          overviewRuler: { color: '#a371f7', position: monaco.editor.OverviewRulerLane.Right },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })),
    );
    const by = this.hooks.agentAtWork();
    doc.questions = [
      ...doc.questions.filter((q) => !replaced.includes(q)),
      ...questions.map((q, i) => ({ id: `mq${++questionIds}`, kind: q.kind, mine: q.mine, theirs: q.theirs, by, decoration: ids[i] })),
    ];
    this.publish(doc);
  }

  /** Questions whose passage now reads as theirs (the author made it so) are settled. */
  private settleQuestions(doc: Doc) {
    const settled = doc.questions.filter((q) => {
      const r = doc.model.getDecorationRange(q.decoration);
      return !r || doc.model.getValueInRange(r) === q.theirs;
    });
    if (settled.length) this.drop(doc, settled);
  }

  private drop(doc: Doc, questions: Asked[]) {
    if (!doc.model.isDisposed()) doc.model.deltaDecorations(questions.map((q) => q.decoration), []);
    doc.questions = doc.questions.filter((q) => !questions.includes(q));
    this.publish(doc);
  }

  questionRange(path: string, id: string): monaco.Range | null {
    const doc = this.docs.get(path);
    const q = doc?.questions.find((x) => x.id === id);
    return (q && doc!.model.getDecorationRange(q.decoration)) || null;
  }

  /** "Use theirs": their version of the passage, keeping what the author changed in it since (undoable). */
  useTheirs(path: string, id: string) {
    const doc = this.docs.get(path);
    const q = doc?.questions.find((x) => x.id === id);
    if (!doc || !q) return;
    const range = doc.model.getDecorationRange(q.decoration);
    if (range) {
      const current = doc.model.getValueInRange(range);
      const text = current === q.mine ? q.theirs : merge3(q.mine, q.theirs, current).text;
      const offset = doc.model.getOffsetAt(range.getStartPosition());
      const { model } = doc;
      model.pushStackElement();
      model.pushEditOperations(
        [],
        smallEdits(current, text).map((c) => ({ range: monaco.Range.fromPositions(model.getPositionAt(offset + c.start), model.getPositionAt(offset + c.end)), text: c.text })),
        () => null,
      );
      model.pushStackElement();
    }
    if (doc.questions.includes(q)) this.drop(doc, [q]);
  }

  /** "Keep mine" (or asked of the assistant): the question goes; the buffer already has the author's. */
  dismissQuestion(path: string, id: string) {
    const doc = this.docs.get(path);
    const q = doc?.questions.find((x) => x.id === id);
    if (doc && q) this.drop(doc, [q]);
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

  /** Discard the buffer's unsaved edits and load what's on disk (Revert File). */
  async reload(path: string) {
    const doc = this.docs.get(path);
    if (!doc) return;
    await this.exclusive(doc, async () => {
      const { text, hash } = await ipc.fsRead(path);
      if (doc.model.isDisposed()) return;
      const before = doc.model.getValue();
      if (before !== text) {
        // An undo step of its own: ⌘Z takes off the reload, not the typing before it too.
        doc.model.pushStackElement();
        this.replaceText(doc.model, before, text);
        doc.model.pushStackElement();
      }
      doc.diskHash = hash;
      doc.diskText = text;
      doc.seenText = text;
      doc.savedAltVersion = doc.model.getAlternativeVersionId();
      if (doc.questions.length) this.drop(doc, doc.questions);
      this.updateDirty(doc);
      this.hooks.onConflict(path, null);
    });
  }

  /**
   * Write `text` to the file (History's restores and undos: the author asked for
   * it) and merge it into the buffer, whose unsaved edits stay.
   */
  async writeThrough(path: string, text: string) {
    const doc = this.docs.get(path);
    if (!doc) {
      await ipc.fsWrite(path, text, await ipc.fsHash(path));
      return;
    }
    await this.exclusive(doc, async () => {
      const hash = await ipc.fsWrite(path, text, await ipc.fsHash(path));
      if (doc.model.isDisposed()) return;
      // Not from an older copy: nothing to protect, so the merge starts from the disk text.
      doc.seenText = doc.diskText;
      await this.merge(doc, text, hash);
    });
  }

  /** Filesystem watcher callback: merge what changed into open buffers. */
  async diskChanged(paths: string[]) {
    for (const path of new Set(paths)) {
      const doc = this.docs.get(path);
      if (!doc) continue;
      try {
        await this.exclusive(doc, async () => {
          if (doc.model.isDisposed()) return;
          const hash = await ipc.fsHash(path);
          if (hash === doc.diskHash) return; // our own write, or nothing changed
          if (hash === null) return this.hooks.onConflict(path, 'The file was deleted on disk.');
          await this.pull(doc);
        });
      } catch (e) {
        // One file that can't be read (gone again, binary now) doesn't stop the others.
        void ipc.uiLog(`disk change: ${path}: ${errorMessage(e)}`);
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
    if (doc.questions.length) {
      doc.questions = [];
      this.publish(doc);
    }
  }

  dispose() {
    for (const path of [...this.docs.keys()]) this.close(path);
  }
}
