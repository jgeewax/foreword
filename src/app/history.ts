// Book history (TODO #8): automatic snapshots in an app-owned Git repo (see
// src-tauri/src/history.rs), plus browsing, diffs and restores. The author's
// own Git repo is never touched. Restores are ordinary conflict-checked file
// writes: files with unsaved edits, or changed since, are skipped and named.
// Undoing a turn takes out only its changes (merge.ts), around the author's
// later ones, unsaved edits included. The current state is always saved
// first, so every restore can be undone from History too.
import { ask } from '@tauri-apps/plugin-dialog';
import type { Documents } from '../editor/documents';
import { merge3 } from '../editor/merge';
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
  /** The text before and after (null: the file didn't exist), for the side-by-side diff. */
  before?: string | null;
  after?: string | null;
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
  /** Only the versions that changed this file (null: all). */
  filter: string | null;
  busy: boolean;
  /** Where the versions are kept: the app's own Git repo for this book, and the git it uses. */
  repo: { gitDir: string; git: string } | null;
};

export const initialHistory: HistoryState = { status: 'off', versions: [], open: null, diff: null, changes: null, filter: null, busy: false, repo: null };

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
      const repo = await ipc.historyInit(exclude);
      this.started = true;
      const first = (await ipc.historyList(1)).length === 0;
      await ipc.historySnapshot('opened', first ? 'Started keeping history' : 'Changed outside Foreword: {files}');
      this.host.set({ status: 'ready', repo });
      await this.refresh();
    } catch (e) {
      this.started = false;
      this.host.set({ status: 'unavailable', error: errorMessage(e) });
    }
  }

  /** The history repo in Finder. */
  async reveal() {
    try {
      await ipc.historyReveal();
    } catch (e) {
      this.host.report(`Couldn't show it in Finder: ${errorMessage(e)}`, 'error');
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
    const filter = this.state.filter;
    const versions = await ipc.historyList(LIST_LIMIT, filter);
    if (this.state.filter === filter) this.host.set({ versions });
  }

  /** Show only the versions that changed `path` (null: every version). */
  async setFilter(path: string | null) {
    this.host.set({ filter: path, open: null });
    await this.refresh().catch((e) => this.host.report(`History: ${errorMessage(e)}`, 'error'));
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
    return (await this.snapshot(kind, label)).head;
  }

  /** A version, if anything changed: the version the book is at now, and the new one (null when nothing changed). */
  private async snapshot(kind: string, label: string): Promise<{ head: string | null; created: string | null }> {
    if (!this.started) return { head: null, created: null };
    clearTimeout(this.timer);
    const v = await ipc.historySnapshot(kind, label);
    if (v) await this.refresh();
    return { head: v?.id ?? this.state.versions[0]?.id ?? (await ipc.historyList(1))[0]?.id ?? null, created: v?.id ?? null };
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
  /** After an agent turn: its changes are one version. Returns the version the book is at now, and the agent's (null if it changed nothing). */
  async afterAgent(message: string): Promise<{ head: string | null; created: string | null }> {
    try {
      return await this.snapshot('agent', `Agent: ${shorten(message) || 'changes'}`);
    } catch (e) {
      console.warn('history: snapshot after agent turn failed', e);
      return { head: null, created: null };
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
            return { path: c.path, status: c.status, diff: proseDiff(before, after), before, after };
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
   * Undo what one version changed (an agent turn), file by file. Changes made
   * since stay: the version's own changes are taken out around them, and an
   * open file's unsaved edits are kept. A file changed since in the same words
   * is left alone.
   */
  async undoVersion(version: Version) {
    if (!version.parent) return;
    const ok = await this.confirm(
      `Undo the changes from “${version.label}”?\n\nWhat you changed since stays. A file where you changed the same words is left alone. Your current version is saved in History first.`,
      'Undo changes',
    );
    if (!ok) return;
    const parent = version.parent;
    await this.run(async () => {
      await this.checkpoint();
      const report: RestoreReport = { restored: [], skipped: [], kept: [] };
      for (const change of await ipc.historyChanges(null, version.id)) {
        const [then, now] = await Promise.all([ipc.historyFile(version.id, change.path).catch(() => undefined), this.diskText(change.path)]);
        if (then === undefined) {
          report.skipped.push({ path: change.path, why: 'not a text file' });
        } else if (change.status === 'A') {
          if (now === then) report.kept.push(change.path);
          else report.skipped.push({ path: change.path, why: 'changed since' });
        } else if (then === null || now === null) {
          // Deleted by the turn (or since): put back only if that's still so.
          if (now === then) await this.restoreFrom(parent, change.path, report);
          else report.skipped.push({ path: change.path, why: 'changed since' });
        } else {
          let before: string | null;
          try {
            before = await ipc.historyFile(parent, change.path);
          } catch (e) {
            report.skipped.push({ path: change.path, why: errorMessage(e) });
            continue;
          }
          if (before === null) {
            report.kept.push(change.path);
            continue;
          }
          const undone = merge3(then, now, before);
          if (undone.conflicts.length) report.skipped.push({ path: change.path, why: 'changed since, in the same places' });
          else await this.writeBack(change.path, undone.text, report, { mergeUnsaved: true });
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

  private async diskText(path: string): Promise<string | null> {
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

  /**
   * Write a file; an open one's buffer takes the change as one undoable edit
   * (so ⌘Z in the editor also works). One with unsaved edits is skipped, or,
   * with `mergeUnsaved`, has the change merged in around them.
   */
  private async writeBack(path: string, text: string, report: RestoreReport, { mergeUnsaved = false } = {}) {
    const docs = this.host.docs();
    const doc = docs?.get(path);
    if (doc && docs!.isDirty(doc) && !mergeUnsaved) {
      report.skipped.push({ path, why: 'unsaved edits' });
      return;
    }
    try {
      const hash = await ipc.fsHash(path);
      if (hash !== null && (await ipc.fsRead(path)).text === text) return;
      if (doc) await docs!.writeThrough(path, text);
      else await ipc.fsWrite(path, text, hash);
      report.restored.push(path);
    } catch (e) {
      report.skipped.push({ path, why: errorMessage(e) });
    }
  }
}
