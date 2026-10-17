// Book history (TODO #8): automatic snapshots in an app-owned Git repo (see
// src-tauri/src/history.rs), plus browsing, diffs and restores. The author's
// own Git repo is never touched. Restores are ordinary conflict-checked file
// writes: files with unsaved edits, or changed since, are skipped and named.
// The current state is always saved first, so every restore can be undone
// from History too.
import { ask } from '@tauri-apps/plugin-dialog';
import type { Documents } from '../editor/documents';
import { errorMessage, ipc, type FileChange, type Version } from '../lib/ipc';
import { proseDiff, type ProseDiff } from './prose-diff';

export type HistoryDiff = {
  path: string;
  version: Version;
  before: string | null;
  after: string | null;
  error?: string;
};

/** One file in the "what changed" view. */
export type ChangedFile = {
  path: string;
  status: FileChange['status'];
  diff: ProseDiff | null;
  /** Not shown as text (binary, not UTF-8, …). */
  note?: string;
};

/** What changed: one version against the one before it, or a version against now. */
export type ChangesView = {
  /** The version shown (stepping goes from here). */
  version: Version;
  /** 'version': its parent → it. 'now': it → the current book. */
  mode: 'version' | 'now';
  /** The version the comparison ends at (the version itself, or the current state). */
  to: string;
  files: ChangedFile[] | null;
  /** Files over the display limit. */
  more: number;
  error?: string;
};

export type HistoryState = {
  status: 'off' | 'starting' | 'ready' | 'unavailable';
  error?: string;
  versions: Version[];
  /** The expanded version and its changed files (null while loading). */
  open: { id: string; changes: FileChange[] | null } | null;
  diff: HistoryDiff | null;
  changes: ChangesView | null;
  busy: boolean;
};

export const initialHistory: HistoryState = { status: 'off', versions: [], open: null, diff: null, changes: null, busy: false };

/** Files shown in one "what changed" view (the rest are counted). */
const CHANGES_LIMIT = 40;

export type HistoryHost = {
  get(): HistoryState;
  set(patch: Partial<HistoryState>): void;
  docs(): Documents | null;
  agentRunning(): boolean;
  report(text: string, tone: 'info' | 'error'): void;
};

/** Edits are grouped into one version after this much quiet. */
export const SAVE_SNAPSHOT_DELAY_MS = 10_000;
const LIST_LIMIT = 300;

export type RestoreReport = { restored: string[]; skipped: { path: string; why: string }[]; kept: string[] };

type Wording = { done: string; none: string };
const RESTORE: Wording = { done: 'Restored', none: 'Nothing needed restoring.' };
const UNDO: Wording = { done: 'Undid the changes in', none: 'Nothing was undone.' };

/** One-line summary of a restore, for the toast. */
export function describeRestore(r: RestoreReport, words: Wording = RESTORE): string {
  const parts: string[] = [];
  parts.push(r.restored.length ? `${words.done} ${listFiles(r.restored)}.` : words.none);
  if (r.skipped.length) parts.push(`Skipped ${r.skipped.map((s) => `${base(s.path)} (${s.why})`).join(', ')}.`);
  if (r.kept.length) parts.push(`Left ${listFiles(r.kept)} in place (added later; delete by hand if you don't want ${r.kept.length > 1 ? 'them' : 'it'}).`);
  return parts.join(' ');
}

const base = (p: string) => p.split('/').pop() ?? p;
const listFiles = (paths: string[]) => (paths.length <= 3 ? paths.map(base).join(', ') : `${paths.length} files`);
const shorten = (s: string, n = 60) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
};

export class History {
  private timer: number | undefined;
  private started = false;
  /** Overridable for the self-test (native dialogs can't be clicked from JS). */
  confirm: (message: string, title: string) => Promise<boolean> = (message, title) => ask(message, { title, kind: 'warning' });

  constructor(private readonly host: HistoryHost) {}

  private get state() {
    return this.host.get();
  }

  /** Set up the repo for the open workspace and record what changed since last time. */
  async start(exclude: string[]) {
    this.host.set({ ...initialHistory, status: 'starting' });
    try {
      await ipc.historyInit(exclude);
      this.started = true;
      const first = (await ipc.historyList(1)).length === 0;
      await ipc.historySnapshot('opened', first ? 'Started keeping history' : 'Changed outside Typst Studio: {files}');
      this.host.set({ status: 'ready' });
      await this.refresh();
    } catch (e) {
      this.started = false;
      this.host.set({ status: 'unavailable', error: errorMessage(e) });
    }
  }

  /** Before the workspace closes: record pending edits. */
  async stop() {
    clearTimeout(this.timer);
    if (this.started) await this.checkpoint().catch(() => {});
    this.started = false;
    this.host.set(initialHistory);
  }

  async refresh() {
    if (!this.started) return;
    const versions = await ipc.historyList(LIST_LIMIT);
    this.host.set({ versions });
  }

  /** After a save or a change on disk: snapshot once things are quiet. */
  scheduleSave() {
    if (!this.started) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      // Changes during an agent turn belong to that turn's version.
      if (this.host.agentRunning()) return this.scheduleSave();
      void this.checkpoint();
    }, SAVE_SNAPSHOT_DELAY_MS);
  }

  /** Record the current state now (if it changed). Returns the latest version id. */
  async checkpoint(kind = 'save', label = 'Edited {files}'): Promise<string | null> {
    if (!this.started) return null;
    clearTimeout(this.timer);
    const v = await ipc.historySnapshot(kind, label);
    if (v) await this.refresh();
    return v?.id ?? this.state.versions[0]?.id ?? (await ipc.historyList(1))[0]?.id ?? null;
  }

  /** A named version (always recorded, even with no changes). */
  async saveNamed(name: string) {
    if (!this.started || !name.trim()) return;
    clearTimeout(this.timer);
    await ipc.historySnapshot('milestone', name.trim(), true);
    await this.refresh();
  }

  /** Before an agent turn: everything the author did so far is its own version. */
  async beforeAgent() {
    try {
      await this.checkpoint();
    } catch (e) {
      console.warn('history: snapshot before agent turn failed', e);
    }
  }

  /** After an agent turn: what it changed becomes one version (none if it changed nothing). */
  async afterAgent(message: string) {
    try {
      await this.checkpoint('agent', `Agent: ${shorten(message) || 'changes'}`);
    } catch (e) {
      console.warn('history: snapshot after agent turn failed', e);
    }
  }

  async toggle(id: string) {
    if (this.state.open?.id === id) return this.host.set({ open: null });
    this.host.set({ open: { id, changes: null } });
    try {
      const changes = await ipc.historyChanges(null, id);
      if (this.state.open?.id === id) this.host.set({ open: { id, changes } });
    } catch (e) {
      this.host.report(`Couldn't load that version: ${errorMessage(e)}`, 'error');
      this.host.set({ open: null });
    }
  }

  /** What one version changed in a file (its parent → it). */
  async showDiff(version: Version, path: string) {
    try {
      const [before, after] = await Promise.all([
        version.parent ? ipc.historyFile(version.parent, path) : Promise.resolve(null),
        ipc.historyFile(version.id, path),
      ]);
      this.host.set({ diff: { path, version, before, after } });
    } catch (e) {
      this.host.set({ diff: { path, version, before: null, after: null, error: errorMessage(e) } });
    }
  }

  closeDiff() {
    this.host.set({ diff: null });
  }

  /** What `version` changed (from the version before it), file by file, word by word. */
  async showChanges(version: Version) {
    await this.loadChanges({ version, mode: 'version', to: version.id, files: null, more: 0 }, version.parent, version.id);
  }

  /** Everything that changed since `version`, up to the book as it is now. */
  async compareWithNow(version: Version) {
    this.host.set({ changes: { version, mode: 'now', to: '', files: null, more: 0 } });
    let head: string | null;
    try {
      head = await this.checkpoint();
    } catch (e) {
      this.host.set({ changes: { version, mode: 'now', to: '', files: [], more: 0, error: errorMessage(e) } });
      return;
    }
    if (!head) return;
    await this.loadChanges({ version, mode: 'now', to: head, files: null, more: 0 }, version.id, head);
  }

  /** In the "what changed" view: the next older (+1) or newer (−1) version. */
  async stepChanges(direction: 1 | -1) {
    const current = this.state.changes;
    if (!current || current.mode !== 'version') return;
    const i = this.state.versions.findIndex((v) => v.id === current.version.id);
    const next = i < 0 ? undefined : this.state.versions[i + direction];
    if (next) await this.showChanges(next);
  }

  closeChanges() {
    this.host.set({ changes: null });
  }

  private async loadChanges(view: ChangesView, from: string | null, to: string) {
    this.host.set({ changes: view });
    const still = () => this.state.changes?.version.id === view.version.id && this.state.changes.mode === view.mode;
    try {
      const all = from === to ? [] : await ipc.historyChanges(from, to);
      const shown = all.slice(0, CHANGES_LIMIT);
      const files = await Promise.all(
        shown.map(async (c): Promise<ChangedFile> => {
          if (c.added === null) return { path: c.path, status: c.status, diff: null, note: 'not a text file' };
          try {
            const [before, after] = await Promise.all([from ? ipc.historyFile(from, c.path) : Promise.resolve(null), ipc.historyFile(to, c.path)]);
            return { path: c.path, status: c.status, diff: proseDiff(before, after) };
          } catch (e) {
            return { path: c.path, status: c.status, diff: null, note: errorMessage(e) };
          }
        }),
      );
      if (still()) this.host.set({ changes: { ...view, files, more: all.length - shown.length } });
    } catch (e) {
      if (still()) this.host.set({ changes: { ...view, files: [], error: errorMessage(e) } });
    }
  }

  /** Put one file back as it was in `version`. */
  async restoreFile(version: Version, path: string) {
    await this.run(async () => {
      await this.checkpoint();
      const report: RestoreReport = { restored: [], skipped: [], kept: [] };
      const text = await ipc.historyFile(version.id, path);
      if (text === null) report.skipped.push({ path, why: "it didn't exist in that version" });
      else await this.writeBack(path, text, report);
      if (report.restored.length) await ipc.historySnapshot('restore', `Restored ${base(path)} from “${shorten(version.label, 40)}”`);
      return report;
    });
  }

  /** Put every file that changed since `version` back as it was then. */
  async restoreVersion(version: Version) {
    const ok = await this.confirm(
      `Put the book back as it was at “${version.label}”?\n\nFiles changed since then are restored. Files added since then are left alone. Your current version is saved in History first, so you can come back to it.`,
      'Restore this version',
    );
    if (!ok) return;
    await this.run(async () => {
      const head = await this.checkpoint();
      const report: RestoreReport = { restored: [], skipped: [], kept: [] };
      if (!head || head === version.id) return report;
      for (const change of await ipc.historyChanges(version.id, head)) {
        if (change.status === 'A') {
          report.kept.push(change.path);
          continue;
        }
        await this.restoreFrom(version.id, change.path, report);
      }
      if (report.restored.length) await ipc.historySnapshot('restore', `Restored the book to “${shorten(version.label, 40)}”`);
      return report;
    });
  }

  /**
   * Undo what one version changed (an agent turn), file by file, but only
   * where the file is still exactly as that version left it.
   */
  async undoVersion(version: Version) {
    if (!version.parent) return;
    const ok = await this.confirm(
      `Undo the changes from “${version.label}”?\n\nFiles you changed since then are left alone. Your current version is saved in History first.`,
      'Undo changes',
    );
    if (!ok) return;
    const parent = version.parent;
    await this.run(async () => {
      await this.checkpoint();
      const report: RestoreReport = { restored: [], skipped: [], kept: [] };
      for (const change of await ipc.historyChanges(null, version.id)) {
        const [then, now] = await Promise.all([ipc.historyFile(version.id, change.path).catch(() => undefined), this.currentText(change.path)]);
        if (then === undefined || now !== then) {
          report.skipped.push({ path: change.path, why: then === undefined ? 'not a text file' : 'changed since' });
        } else if (change.status === 'A') {
          report.kept.push(change.path);
        } else {
          await this.restoreFrom(parent, change.path, report);
        }
      }
      if (report.restored.length) await ipc.historySnapshot('restore', `Undid “${shorten(version.label, 40)}”`);
      return report;
    }, UNDO);
  }

  private async run(fn: () => Promise<RestoreReport>, words = RESTORE) {
    if (this.state.busy) return;
    this.host.set({ busy: true });
    try {
      const report = await fn();
      this.host.report(describeRestore(report, words), report.skipped.length ? 'error' : 'info');
      this.host.set({ diff: null, open: null, changes: null });
    } catch (e) {
      this.host.report(`History: ${errorMessage(e)}`, 'error');
    } finally {
      this.host.set({ busy: false });
      await this.refresh().catch(() => {});
    }
  }

  private async currentText(path: string): Promise<string | null> {
    const doc = this.host.docs()?.get(path);
    if (doc && this.host.docs()!.isDirty(doc)) return doc.model.getValue();
    try {
      return (await ipc.fsRead(path)).text;
    } catch {
      return null;
    }
  }

  private async restoreFrom(id: string, path: string, report: RestoreReport) {
    let text: string | null;
    try {
      text = await ipc.historyFile(id, path);
    } catch (e) {
      report.skipped.push({ path, why: errorMessage(e) });
      return;
    }
    // Restoring a file that didn't exist yet would mean deleting it: left to the author.
    if (text === null) report.kept.push(path);
    else await this.writeBack(path, text, report);
  }

  /** Conflict-checked write; open buffers are reloaded (so ⌘Z in the editor also works). */
  private async writeBack(path: string, text: string, report: RestoreReport) {
    const docs = this.host.docs();
    const doc = docs?.get(path);
    if (doc && docs!.isDirty(doc)) {
      report.skipped.push({ path, why: 'unsaved edits' });
      return;
    }
    try {
      const hash = await ipc.fsHash(path);
      if (hash !== null && (await ipc.fsRead(path)).text === text) return;
      await ipc.fsWrite(path, text, hash);
      if (doc) await docs!.reload(path);
      report.restored.push(path);
    } catch (e) {
      report.skipped.push({ path, why: errorMessage(e) });
    }
  }
}
