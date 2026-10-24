// Spelling and grammar in the editor, as Word and Google Docs do it: each open
// file is checked (in Rust, proof/) when it opens and a moment after typing
// stops, and its mistakes are squiggles on its model, so they stay through tab
// switches and move with the text until the next check. The word being typed
// isn't flagged until the caret leaves it. Fixes, ignoring and learning words
// come from the hover, the right-click menu and ⌘. (EditorPane).
import { errorMessage, ipc, type DialectHint, type ProofIssue, type ProofOptions, type WordScope } from '../lib/ipc';
import type { Doc, Documents } from '../editor/documents';
import { monaco } from '../editor/monaco';
import { countIssues, heldBack, ISSUE_CLASS, ISSUE_RULER, nextIssue, type IssueCounts } from './proofing-core';

/** A moment after the last keystroke, as the other marks wait (EditorPane's 300 ms, the TODO scan's 400). */
export const CHECK_DELAY_MS = 400;

export type ProofingState = {
  /** Each open file's mistakes, by kind (the status bar). */
  counts: Record<string, IssueCounts>;
  /** Languages in a file that aren't checked. */
  unchecked: Record<string, string[]>;
};

export const initialProofing: ProofingState = { counts: {}, unchecked: {} };

export type ProofingHost = {
  docs(): Documents | null;
  editor(): monaco.editor.IStandaloneCodeEditor | null;
  /** What to check for, or null when checking is off or no book is open (its `ignored` is the session's). */
  options(): ProofOptions | null;
  set(update: (s: ProofingState) => ProofingState): void;
  log(text: string): void;
  /** Turn a rule off for this book (`book`) or every book. */
  disableRule(rule: string, scope: WordScope): void;
  /** A file's words are spelled as in another English: perhaps check the book as that. */
  dialect(hint: DialectHint): void;
};

/** A mistake shown, and its squiggle (which follows the text as it's edited). */
type Shown = { issue: ProofIssue; decoration: string };

type FileState = {
  /** The last check's mistakes, and the version of the text it checked. */
  issues: ProofIssue[];
  version: number;
  shown: Shown[];
  /** Bumped at each paint: a hover's links name a mistake as `generation:index`. */
  generation: number;
  timer?: number;
  /** Where the last edit ended (offset after it), for holding back the word being typed. */
  edited: number | null;
  /** A misspelling held back, shown once the caret leaves it. */
  held: ProofIssue | null;
};

/** A mistake under the pointer or caret: which, and where it is now. */
export type Found = { id: string; path: string; issue: ProofIssue; range: monaco.Range };

export class Proofing {
  private files = new Map<string, FileState>();
  private subscriptions = new Map<string, monaco.IDisposable>();
  /** Mistakes ignored this session ("Ignore"), by key. */
  private ignored = new Set<string>();
  private composing = false;

  constructor(private readonly host: ProofingHost) {}

  private file(path: string): FileState {
    let f = this.files.get(path);
    if (!f) {
      f = { issues: [], version: -1, shown: [], generation: 0, edited: null, held: null };
      this.files.set(path, f);
    }
    return f;
  }

  /** A file opened: checked now, and a moment after each edit. */
  opened(doc: Doc) {
    if (this.subscriptions.has(doc.path)) return;
    this.subscriptions.set(
      doc.path,
      doc.model.onDidChangeContent((e) => this.edited(doc, e)),
    );
    this.schedule(doc.path, 0);
  }

  closed(path: string) {
    this.subscriptions.get(path)?.dispose();
    this.subscriptions.delete(path);
    clearTimeout(this.files.get(path)?.timer);
    this.files.delete(path);
    this.host.set((s) => {
      const counts = { ...s.counts };
      const unchecked = { ...s.unchecked };
      delete counts[path];
      delete unchecked[path];
      return { counts, unchecked };
    });
  }

  /** The editor's caret and IME: what's held back follows them. Returns its cleanup. */
  attach(editor: monaco.editor.IStandaloneCodeEditor): () => void {
    const subs = [
      editor.onDidChangeCursorPosition(() => {
        const path = this.pathOf(editor.getModel());
        const f = path ? this.files.get(path) : undefined;
        if (!path || !f?.held) return;
        const caret = this.caret(editor.getModel()!);
        if (caret === null || caret < f.held.start || caret > f.held.end) {
          f.edited = null;
          this.paint(path);
        }
      }),
      editor.onDidCompositionStart(() => (this.composing = true)),
      editor.onDidCompositionEnd(() => {
        this.composing = false;
        const path = this.pathOf(editor.getModel());
        if (path) this.schedule(path);
      }),
    ];
    return () => subs.forEach((s) => s.dispose());
  }

  private pathOf(model: monaco.editor.ITextModel | null): string | null {
    if (!model) return null;
    return this.host.docs()?.all().find((d) => d.model === model)?.path ?? null;
  }

  /** The caret's offset in `model`, if the editor shows it. */
  private caret(model: monaco.editor.ITextModel): number | null {
    const editor = this.host.editor();
    const pos = editor?.getModel() === model ? editor.getPosition() : null;
    return pos ? model.getOffsetAt(pos) : null;
  }

  private edited(doc: Doc, e: monaco.editor.IModelContentChangedEvent) {
    const f = this.file(doc.path);
    // The squiggles under an edit go at once (the check after the pause puts back any still wrong).
    const touched = new Set<string>();
    let last = 0;
    for (const c of e.changes) {
      const [a, b] = [c.rangeOffset, c.rangeOffset + c.text.length];
      last = Math.max(last, b);
      for (const s of f.shown) {
        const r = doc.model.getDecorationRange(s.decoration);
        if (!r) continue;
        const [start, end] = [doc.model.getOffsetAt(r.getStartPosition()), doc.model.getOffsetAt(r.getEndPosition())];
        if (start <= b && a <= end) touched.add(s.decoration);
      }
    }
    if (touched.size) {
      doc.model.deltaDecorations([...touched], []);
      f.shown = f.shown.filter((s) => !touched.has(s.decoration));
    }
    f.edited = last;
    this.schedule(doc.path);
  }

  schedule(path: string, delay = CHECK_DELAY_MS) {
    const f = this.file(path);
    clearTimeout(f.timer);
    f.timer = window.setTimeout(() => void this.check(path), delay);
  }

  /** Check every open file again (a word learned, a setting changed). */
  recheckAll() {
    for (const doc of this.host.docs()?.all() ?? []) this.schedule(doc.path, 0);
  }

  async check(path: string) {
    const doc = this.host.docs()?.get(path);
    if (!doc || doc.model.isDisposed()) return;
    const options = this.host.options();
    if (!options) {
      this.show(path, [], [], doc.model.getVersionId());
      return;
    }
    // Typing through an input method: wait for the word to be finished.
    if (this.composing) return this.schedule(path);
    const version = doc.model.getVersionId();
    try {
      const res = await ipc.proofCheck(path, version, doc.model.getValue(), { ...options, ignored: [...this.ignored] });
      if (res.stale || doc.model.isDisposed() || doc.model.getVersionId() !== version || !this.subscriptions.has(path)) return;
      this.show(path, res.issues, res.unchecked, version);
      if (res.dialect) this.host.dialect(res.dialect);
    } catch (e) {
      this.host.log(`spelling: ${path}: ${errorMessage(e)}`);
    }
  }

  private show(path: string, issues: ProofIssue[], unchecked: string[], version: number) {
    const f = this.file(path);
    f.issues = issues;
    f.version = version;
    this.paint(path);
    this.host.set((s) => ({ counts: { ...s.counts, [path]: countIssues(issues) }, unchecked: { ...s.unchecked, [path]: unchecked } }));
  }

  /**
   * Squiggles for the last check's mistakes, but the word being typed. Only
   * while the text is the one checked: after an edit, the squiggles there
   * already follow it, and the next check paints again.
   */
  private paint(path: string) {
    const doc = this.host.docs()?.get(path);
    const f = this.files.get(path);
    if (!doc || !f || doc.model.isDisposed() || doc.model.getVersionId() !== f.version) return;
    const { model } = doc;
    const caret = this.caret(model);
    f.held = null;
    const shown = f.issues.filter((i) => {
      if (!heldBack(i, caret, f.edited)) return true;
      f.held = i;
      return false;
    });
    const ids = model.deltaDecorations(
      f.shown.map((s) => s.decoration),
      shown.map((i) => ({
        range: monaco.Range.fromPositions(model.getPositionAt(i.start), model.getPositionAt(i.end)),
        options: {
          className: ISSUE_CLASS[i.kind],
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          overviewRuler: { color: ISSUE_RULER[i.kind], position: monaco.editor.OverviewRulerLane.Right },
        },
      })),
    );
    f.shown = shown.map((issue, i) => ({ issue, decoration: ids[i] }));
    f.generation++;
  }

  /** The mistakes at an offset in a file, the narrowest first. */
  at(path: string, offset: number): Found[] {
    const doc = this.host.docs()?.get(path);
    const f = this.files.get(path);
    if (!doc || !f) return [];
    const out: (Found & { size: number })[] = [];
    f.shown.forEach((s, i) => {
      const range = doc.model.getDecorationRange(s.decoration);
      if (!range || range.isEmpty()) return;
      const [a, b] = [doc.model.getOffsetAt(range.getStartPosition()), doc.model.getOffsetAt(range.getEndPosition())];
      if (a <= offset && offset <= b) out.push({ id: `${f.generation}:${i}`, path, issue: s.issue, range, size: b - a });
    });
    return out.sort((x, y) => x.size - y.size);
  }

  /** A mistake named by `at`'s id, if it's still shown. */
  find(path: string, id: string): Found | null {
    const doc = this.host.docs()?.get(path);
    const f = this.files.get(path);
    const [gen, index] = id.split(':').map(Number);
    if (!doc || !f || gen !== f.generation || !f.shown[index]) return null;
    const range = doc.model.getDecorationRange(f.shown[index].decoration);
    return range ? { id, path, issue: f.shown[index].issue, range } : null;
  }

  /** Put a fix in place of the mistake, as one undoable step, if the text there is still what was flagged. */
  fix(found: Found, fix: string) {
    const doc = this.host.docs()?.get(found.path);
    if (!doc || doc.model.getValueInRange(found.range) !== found.issue.word) return;
    const editor = this.host.editor();
    if (editor?.getModel() === doc.model) {
      editor.pushUndoStop();
      editor.executeEdits('proofing', [{ range: found.range, text: fix }]);
      editor.pushUndoStop();
      editor.focus();
    } else {
      doc.model.pushStackElement();
      doc.model.pushEditOperations([], [{ range: found.range, text: fix }], () => null);
      doc.model.pushStackElement();
    }
  }

  /** Take mistakes away at once (ignored, a word learned), before the next check. */
  private drop(which: (i: ProofIssue) => boolean) {
    for (const [path, f] of this.files) {
      const model = this.host.docs()?.get(path)?.model;
      const gone = f.shown.filter((s) => which(s.issue));
      if (!model || !gone.length) continue;
      model.deltaDecorations(gone.map((s) => s.decoration), []);
      f.shown = f.shown.filter((s) => !gone.includes(s));
      f.issues = f.issues.filter((i) => !which(i));
      f.generation++;
      this.host.set((s) => ({ ...s, counts: { ...s.counts, [path]: countIssues(f.issues) } }));
    }
  }

  /** "Ignore": this mistake, in this sentence, for the rest of the session. */
  ignore(found: Found) {
    this.ignored.add(found.issue.key);
    this.drop((i) => i.key === found.issue.key);
  }

  /** "Add to Dictionary": the book's or the author's; every window checks again (the proofing:words event). */
  async learn(word: string, scope: WordScope) {
    await ipc.proofWordsEdit(scope, [word], []);
    this.drop((i) => i.kind === 'spelling' && i.word === word);
    this.recheckAll();
  }

  disableRule(found: Found, scope: WordScope) {
    this.host.disableRule(found.issue.rule, scope);
  }

  /** The next mistake after the caret in the editor's file (or before, going back), selected. */
  next(back = false): Found | null {
    const editor = this.host.editor();
    const model = editor?.getModel();
    const path = this.pathOf(model ?? null);
    const f = path ? this.files.get(path) : undefined;
    if (!editor || !model || !path || !f?.shown.length) return null;
    const ranges = f.shown
      .map((s, i) => ({ i, range: model.getDecorationRange(s.decoration) }))
      .filter((x): x is { i: number; range: monaco.Range } => !!x.range)
      .map((x) => ({ ...x, start: model.getOffsetAt(x.range.getStartPosition()) }))
      .sort((a, b) => a.start - b.start);
    const sel = editor.getSelection();
    const from = sel ? model.getOffsetAt(sel.getStartPosition()) : 0;
    const k = nextIssue(ranges, from, back);
    if (k < 0) return null;
    const { i, range } = ranges[k];
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
    editor.focus();
    return { id: `${f.generation}:${i}`, path, issue: f.shown[i].issue, range };
  }

  /** Every mistake shown in a file now, where it is. */
  list(path: string): Found[] {
    const doc = this.host.docs()?.get(path);
    const f = this.files.get(path);
    if (!doc || !f) return [];
    return f.shown.flatMap((s, i) => {
      const range = doc.model.getDecorationRange(s.decoration);
      return range ? [{ id: `${f.generation}:${i}`, path, issue: s.issue, range }] : [];
    });
  }

  dispose() {
    for (const path of [...this.subscriptions.keys()]) this.closed(path);
  }
}
