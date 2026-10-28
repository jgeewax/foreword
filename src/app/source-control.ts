// Source Control: the author's own Git repository, when the book is in one.
// As VS Code's: what's changed since the last commit (stage, unstage,
// discard), committing (and amending, and undoing the last commit), pulling,
// pushing, syncing and fetching, branches, and the recent commits, each with
// "what changed" in words (the same view as History). Separate from History,
// which keeps its own snapshots and never touches this repository; Discard
// has History keep the book first.
import { showContextMenu, type MenuEntry } from '../lib/context-menu';
import { errorMessage, ipc, type GitBranch, type GitCommit, type GitFile, type GitStatus } from '../lib/ipc';
import type { ChangedFile } from './history';
import { proseDiff } from './prose-diff';

/** What changed, for the Source Control dialog: uncommitted changes, or one commit. */
export type GitChangesView = {
  title: string;
  subtitle: string;
  /** Uncommitted changes: the files can be opened at the change. */
  working: boolean;
  files: ChangedFile[] | null;
  more: number;
  error?: string;
};

export type GitState = {
  status: 'off' | 'loading' | 'ready' | 'error';
  /** null: the book isn't in a Git repository. */
  repo: GitStatus | null;
  log: GitCommit[];
  /** How many commits the graph asks for (Load More adds a page). */
  limit: number;
  /** What's running. */
  busy: 'commit' | 'pull' | 'push' | 'sync' | 'fetch' | 'discard' | 'branch' | null;
  error: string | null;
  view: GitChangesView | null;
  /** The commit message being written (kept while the view is closed; Undo Last Commit puts one back). */
  message: string;
};

/** How many files aren't committed, staged or not (the activity bar's badge). */
export const uncommitted = (repo: GitStatus | null) => (repo ? new Set([...repo.staged, ...repo.files].map((f) => f.path)).size : 0);

/** Files with a conflict (Merge Changes), and the rest of what's changed and not staged (Changes). */
export const conflicts = (repo: GitStatus) => repo.files.filter((f) => f.status === 'U');
export const unstaged = (repo: GitStatus) => repo.files.filter((f) => f.status !== 'U');

/** What the big button under the message does: Commit, or, with nothing to commit, VS Code's Sync Changes or Publish Branch. */
export function mainAction(repo: GitStatus): 'commit' | 'sync' | 'publish' {
  if (repo.staged.length || repo.files.length || !repo.branch) return 'commit';
  if (!repo.upstream) return 'publish';
  return repo.ahead || repo.behind ? 'sync' : 'commit';
}

/** Commits in the graph at first, and added by each Load More. */
export const LOG_PAGE = 50;

export const initialGit: GitState = { status: 'off', repo: null, log: [], limit: LOG_PAGE, busy: null, error: null, view: null, message: '' };

export type GitHost = {
  get(): GitState;
  set(patch: Partial<GitState>): void;
  report(text: string, tone: 'info' | 'error'): void;
  confirm(message: string, title: string, ok: string): Promise<boolean>;
  prompt(request: { title: string; label: string; okLabel: string; value?: string }): Promise<string | null>;
  /** Before Discard: open files among these saved, and the book kept in History. Throws if it couldn't be. */
  keep(paths: string[]): Promise<void>;
  /** A new file, discarded: to the Trash. */
  trash(path: string): Promise<void>;
  /** After Discard: open files shown as they are on disk now, and History's version of the book after it. */
  discarded(paths: string[], trashed: string[]): Promise<void>;
  /** Add to .gitignore: a line for this book file in the book's .gitignore. */
  ignore(path: string): Promise<void>;
};

/** Files shown in one dialog (the rest are counted). */
const VIEW_LIMIT = 40;

/** Branches of each kind in Checkout to… (the last committed to first). */
const BRANCH_LIMIT = 30;

/** Git's statuses as History's (added, modified, deleted). */
const asChange = (s: GitFile['status']): ChangedFile['status'] => (s === 'A' || s === '?' ? 'A' : s === 'D' ? 'D' : 'M');

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Discard's question, as VS Code asks it, but saying where things go: back as staged or committed, new files to the Trash, and History keeps a copy. */
export function discardQuestion(files: GitFile[], repo: GitStatus, all = false): { title: string; message: string; ok: string } {
  const keeps = 'History keeps the book as it is now, so you can go back.';
  const fresh = files.filter((f) => f.status === '?').length;
  if (files.length === 1) {
    const f = files[0];
    if (f.status === '?') {
      return {
        title: 'Discard Changes',
        message: `“${nameOf(f.path)}” is new, not in Git yet, so discarding it moves it to the Trash.\n\nYou can put it back from the Trash in Finder, and History keeps a copy.`,
        ok: 'Move to Trash',
      };
    }
    const back = repo.staged.some((s) => s.path === f.path) ? 'as you staged it' : 'as it was at the last commit';
    return { title: 'Discard Changes', message: `Discard the changes in “${nameOf(f.path)}”? ${f.status === 'D' ? 'It comes back' : 'It goes back'} ${back}.\n\n${keeps}`, ok: 'Discard File' };
  }
  const n = files.length;
  const where =
    fresh === n
      ? 'They’re new, not in Git yet, so they go to the Trash.'
      : `They go back as they were at the last commit (or as you staged them)${fresh ? `, and ${fresh === 1 ? 'the new one, not in Git yet, goes' : `the ${fresh} new ones, not in Git yet, go`} to the Trash` : ''}.`;
  return { title: all ? 'Discard All Changes' : 'Discard Changes', message: `Discard ${all ? 'all the' : 'the'} changes in ${n} files? ${where}\n\n${keeps}`, ok: all ? `Discard All ${n} Files` : `Discard ${n} Files` };
}

/** Checkout to…: Create New Branch…, the branches here (the one checked out ticked), then a remote's that aren't here yet. */
export function branchEntries(branches: GitBranch[], pick: (b: GitBranch) => void, create: () => void): MenuEntry[] {
  const local = branches.filter((b) => b.kind === 'local');
  // origin/main when main is here already: it's the same branch.
  const remote = branches.filter((b) => b.kind === 'remote' && !local.some((l) => l.name === b.name.slice(b.name.indexOf('/') + 1)));
  return [
    { label: 'Create New Branch…', action: create },
    'separator',
    ...local.slice(0, BRANCH_LIMIT).map((b): MenuEntry => ({ label: b.name, checked: b.current, enabled: !b.current, action: () => pick(b) })),
    'separator',
    ...remote.slice(0, BRANCH_LIMIT).map((b): MenuEntry => ({ label: b.name, action: () => pick(b) })),
  ];
}

export class SourceControl {
  constructor(private readonly host: GitHost) {}

  private get state() {
    return this.host.get();
  }

  /** The commit message being written. */
  get message() {
    return this.state.message;
  }

  setMessage(text: string) {
    this.host.set({ message: text });
  }

  private refreshes = 0;

  /** Status and recent commits (quietly: a failure leaves the last known state). */
  async refresh() {
    // Refreshes overlap (files changing, a push finishing): the newest one wins.
    const n = ++this.refreshes;
    if (this.state.status === 'off') this.host.set({ status: 'loading' });
    try {
      const repo = await ipc.gitStatus();
      const log = repo ? await ipc.gitLog(this.state.limit) : [];
      if (n === this.refreshes) this.host.set({ status: 'ready', repo, log, error: null });
    } catch (e) {
      if (n === this.refreshes) this.host.set({ status: 'error', error: errorMessage(e) });
    }
  }

  /** The next page of older commits in the graph. */
  async loadMore() {
    this.host.set({ limit: this.state.limit + LOG_PAGE });
    await this.refresh();
  }

  reset() {
    this.refreshes++; // the last book's refresh, still running, is dropped
    this.host.set(initialGit);
  }

  /**
   * Commit (what's staged, or every change in the book), as VS Code's
   * button and its menu: `amend` into the last commit (an empty message
   * keeps its own); `then` push or sync. The box empties once it's in.
   */
  async commit(message: string, { amend = false, then }: { amend?: boolean; then?: 'push' | 'sync' } = {}): Promise<boolean> {
    if ((!message.trim() && !amend) || this.state.busy) return false;
    this.host.set({ busy: 'commit' });
    let ok = false;
    try {
      const short = await ipc.gitCommit(message, amend);
      const subject = message.trim().split('\n')[0];
      this.host.report(amend ? `Amended the last commit, ${short}${subject ? `: ${subject}` : ''}` : `Committed ${short}: ${subject}`, 'info');
      ok = true;
      if (this.state.message === message) this.host.set({ message: '' });
    } catch (e) {
      this.host.report(`Couldn't ${amend ? 'amend' : 'commit'}: ${errorMessage(e)}`, 'error');
    } finally {
      this.host.set({ busy: null });
      await this.refresh();
    }
    if (ok && then === 'push') await this.push();
    if (ok && then === 'sync') await this.sync();
    return ok;
  }

  /** Commit from a menu or the palette: with the box's message, or one asked for when the box is empty (as VS Code asks). */
  async commitAsking(opts: { amend?: boolean; then?: 'push' | 'sync' } = {}): Promise<boolean> {
    let message = this.state.message;
    if (!message.trim() && !opts.amend) {
      const staged = (this.state.repo?.staged.length ?? 0) > 0;
      const okLabel = opts.then === 'push' ? 'Commit & Push' : opts.then === 'sync' ? 'Commit & Sync' : 'Commit';
      message = (await this.host.prompt({ title: staged ? 'Commit the staged changes' : 'Commit every change in the book', label: 'Message', okLabel })) ?? '';
      if (!message.trim()) return false;
    }
    return this.commit(message, opts);
  }

  /**
   * Undo Last Commit, as VS Code's: the branch goes back one commit, what it
   * changed is staged again, and its message is back in the box (unless
   * something is being written there). Asked first if it's on the remote.
   */
  async undoLastCommit() {
    const repo = this.state.repo;
    if (!repo || this.state.busy) return;
    const last = this.state.log.find((c) => c.head);
    if (repo.upstream && repo.ahead === 0) {
      const ok = await this.host.confirm(
        `${last ? `“${last.subject}”` : 'The last commit'} is on ${repo.upstream} already. Undo it here and the remote has a commit you don’t, so Push is refused until you pull it back in.\n\nUndo it anyway?`,
        'Undo Last Commit',
        'Undo Commit',
      );
      if (!ok) return;
    }
    this.host.set({ busy: 'commit' });
    try {
      const message = await ipc.gitUndoCommit();
      if (!this.state.message.trim()) this.host.set({ message });
      this.host.report(`Undid “${message.split('\n')[0]}”: what it changed is staged again.`, 'info');
    } catch (e) {
      this.host.report(`Couldn't undo the last commit: ${errorMessage(e)}`, 'error');
    } finally {
      this.host.set({ busy: null });
      await this.refresh();
    }
  }

  async pull() {
    await this.remote('pull', () => ipc.gitPull(), () => 'Up to date with the remote.');
  }

  async push() {
    await this.remote('push', () => ipc.gitPush(), () => 'Sent to the remote.');
  }

  /** Publish Branch: its first push, to origin, which it follows from then on. */
  async publish() {
    const branch = this.state.repo?.branch;
    await this.remote('push', () => ipc.gitPush(), () => `Published ${branch ?? 'the branch'}: it’s on the remote now.`);
  }

  /** Sync Changes, as VS Code's: pull, then push (a branch not on the remote yet is published). */
  async sync() {
    const upstream = this.state.repo?.upstream;
    await this.remote(
      'sync',
      async () => {
        if (upstream) await ipc.gitPull();
        return ipc.gitPush();
      },
      () => (upstream ? `In step with ${upstream}.` : 'Published: the branch is on the remote now.'),
    );
  }

  /** Fetch: what's new on the remote, without changing the book (Pull brings it in). */
  async fetch() {
    await this.remote('fetch', () => ipc.gitFetch(), () => {
      const behind = this.state.repo?.behind ?? 0;
      return behind ? `Fetched: ${behind} new commit${behind === 1 ? '' : 's'} to pull.` : 'Fetched: nothing new on the remote.';
    });
  }

  private async remote(kind: 'pull' | 'push' | 'sync' | 'fetch', run: () => Promise<string>, done: () => string) {
    if (this.state.busy) return;
    this.host.set({ busy: kind });
    let ok = false;
    try {
      await run();
      ok = true;
    } catch (e) {
      this.host.report(errorMessage(e), 'error');
    } finally {
      this.host.set({ busy: null });
      await this.refresh();
    }
    if (ok) this.host.report(done(), 'info');
  }

  /** Stage files for the next commit (`.`: every change in the book), as VS Code's +. */
  async stage(paths: string[]) {
    await this.index(() => ipc.gitStage(paths), "Couldn't stage");
  }

  /** Take files out of the next commit (`.`: all of them); their changes stay. */
  async unstage(paths: string[]) {
    await this.index(() => ipc.gitUnstage(paths), "Couldn't unstage");
  }

  /** Merge Changes' +: staged as resolved. Asked first, as VS Code asks, if Git's conflict markers are still in. */
  async resolve(paths: string[]) {
    const marked: string[] = [];
    for (const p of paths) {
      const text = await ipc.fsRead(p).then((r) => r.text, () => '');
      if (/^(<{7}|>{7})( |$)/m.test(text)) marked.push(p);
    }
    if (marked.length) {
      const which = marked.length === 1 ? `“${nameOf(marked[0])}” still has` : `${marked.length} files still have`;
      if (!(await this.host.confirm(`${which} Git’s conflict markers (<<<<<<< and >>>>>>>). Stage ${marked.length === 1 ? 'it' : 'them'} anyway, as resolved?`, 'Merge Conflicts', 'Stage Anyway'))) return;
    }
    await this.stage(paths);
  }

  private async index(run: () => Promise<void>, failed: string) {
    if (this.state.busy) return;
    try {
      await run();
    } catch (e) {
      this.host.report(`${failed}: ${errorMessage(e)}`, 'error');
    }
    await this.refresh();
  }

  /**
   * Discard Changes, as VS Code's (files in Changes; `all`: Discard All
   * Changes): each goes back as staged, or as committed, and a new file, not
   * in Git yet, goes to the Trash. Asked first; History keeps the book as it
   * is before anything goes, and if it can't, nothing is discarded.
   */
  async discard(files: GitFile[], all = false) {
    const repo = this.state.repo;
    const list = files.filter((f) => f.status !== 'U');
    if (!repo || this.state.busy || !list.length) return;
    const ask = discardQuestion(list, repo, all);
    if (!(await this.host.confirm(ask.message, ask.title, ask.ok))) return;
    this.host.set({ busy: 'discard' });
    const tracked = list.filter((f) => f.status !== '?').map((f) => f.path);
    const fresh = list.filter((f) => f.status === '?').map((f) => f.path);
    const trashed: string[] = [];
    const failed: string[] = [];
    try {
      await this.host.keep(list.map((f) => f.path));
    } catch (e) {
      this.host.set({ busy: null });
      this.host.report(`Nothing was discarded: History couldn't keep a copy first (${errorMessage(e)}).`, 'error');
      return;
    }
    try {
      if (tracked.length) await ipc.gitDiscard(tracked);
    } catch (e) {
      failed.push(errorMessage(e));
    }
    for (const p of fresh) {
      try {
        await this.host.trash(p);
        trashed.push(p);
      } catch (e) {
        failed.push(`${p}: ${errorMessage(e)}`);
      }
    }
    await this.host.discarded(tracked, trashed).catch(() => {});
    this.host.set({ busy: null });
    if (failed.length) this.host.report(`Couldn't discard everything: ${failed.join('; ')}`, 'error');
    else this.host.report(`Discarded ${list.length === 1 ? `the changes in ${nameOf(list[0].path)}` : `the changes in ${list.length} files`}. History has the book as it was.`, 'info');
    await this.refresh();
  }

  /** Add to .gitignore (a new file's menu, as VS Code's): Git leaves it out from then on. */
  async ignore(path: string) {
    try {
      await this.host.ignore(path);
    } catch (e) {
      this.host.report(`Couldn't add it to .gitignore: ${errorMessage(e)}`, 'error');
    }
    await this.refresh();
  }

  /** Checkout to…, as VS Code's branch picker: a menu of the branches, with Create New Branch… first. */
  async pickBranch() {
    if (!this.state.repo || this.state.busy) return;
    let branches: GitBranch[];
    try {
      branches = await ipc.gitBranches();
    } catch (e) {
      this.host.report(`Couldn't list the branches: ${errorMessage(e)}`, 'error');
      return;
    }
    await showContextMenu(branchEntries(branches, (b) => void this.checkout(b.name, b.kind === 'remote'), () => void this.createBranch()));
  }

  /** Switch to a branch (a remote's, as one of its own that follows it). Git refuses if a change in the book would be lost. */
  async checkout(branch: string, remote = false) {
    if (this.state.busy) return;
    this.host.set({ busy: 'branch' });
    try {
      await ipc.gitCheckout(branch, remote);
      this.host.report(`On ${remote ? branch.slice(branch.indexOf('/') + 1) : branch} now.`, 'info');
    } catch (e) {
      this.host.report(errorMessage(e), 'error');
    } finally {
      this.host.set({ busy: null });
      await this.refresh();
    }
  }

  /** Create Branch…: from where the book is now (uncommitted changes come along), and switched to. */
  async createBranch() {
    const repo = this.state.repo;
    if (!repo || this.state.busy) return;
    const from = repo.branch ? `from ${repo.branch}` : 'from this commit';
    const name = (await this.host.prompt({ title: 'Create Branch', label: `A name for the new branch (${from}, with the book as it is now)`, okLabel: 'Create Branch' }))?.trim();
    if (!name) return;
    this.host.set({ busy: 'branch' });
    try {
      await ipc.gitCreateBranch(name);
      this.host.report(`On ${name} now, a new branch ${from}.`, 'info');
    } catch (e) {
      this.host.report(errorMessage(e), 'error');
    } finally {
      this.host.set({ busy: null });
      await this.refresh();
    }
  }

  /**
   * What's changed (`only`: one file), as VS Code's diffs: Staged Changes
   * from the last commit to what's staged; Changes from what's staged (the
   * last commit, if nothing is) to the file as it is.
   */
  async showWorking(only?: string, staged = false) {
    const repo = this.state.repo;
    if (!repo) return;
    const files = (staged ? repo.staged : repo.files).filter((f) => !only || f.path === only);
    const branch = repo.branch ? ` on ${repo.branch}` : '';
    if (staged) {
      await this.show({ title: only ? `Staged changes to ${only}` : 'Staged for the next commit', subtitle: `Since the last commit${branch}`, working: false }, files, async (f) => [
        f.status === 'A' ? null : await ipc.gitFile('HEAD', f.path),
        f.status === 'D' ? null : await ipc.gitFile(':0', f.path),
      ]);
      return;
    }
    await this.show({ title: only ? `Changes to ${only}` : 'Not committed yet', subtitle: repo.staged.length ? 'Not staged yet' : `Since the last commit${branch}`, working: true }, files, async (f) => [
      f.status === '?' ? null : await ipc.gitFile(f.status === 'U' ? 'HEAD' : ':0', f.path),
      f.status === 'D' ? null : (await ipc.fsRead(f.path)).text,
    ]);
  }

  /** What one commit changed in the book. */
  async showCommit(c: GitCommit) {
    const when = new Date(c.time * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    this.host.set({ view: { title: c.subject, subtitle: `${c.short} · ${c.author} · ${when}`, working: false, files: null, more: 0 } });
    try {
      const files = await ipc.gitCommitFiles(c.hash);
      await this.show({ title: c.subject, subtitle: `${c.short} · ${c.author} · ${when}`, working: false }, files, async (f) => [
        c.parents.length > 0 && f.status !== 'A' ? await ipc.gitFile(`${c.hash}^`, f.path) : null,
        f.status === 'D' ? null : await ipc.gitFile(c.hash, f.path),
      ]);
    } catch (e) {
      this.host.set({ view: { title: c.subject, subtitle: '', working: false, files: [], more: 0, error: errorMessage(e) } });
    }
  }

  private async show(head: Omit<GitChangesView, 'files' | 'more'>, files: GitFile[], texts: (f: GitFile) => Promise<[string | null, string | null]>) {
    this.host.set({ view: { ...head, files: null, more: Math.max(0, files.length - VIEW_LIMIT) } });
    const changed = await Promise.all(
      files.slice(0, VIEW_LIMIT).map(async (f): Promise<ChangedFile> => {
        try {
          const [before, after] = await texts(f);
          return { path: f.path, status: asChange(f.status), diff: proseDiff(before, after), before, after };
        } catch (e) {
          return { path: f.path, status: asChange(f.status), diff: null, note: errorMessage(e) };
        }
      }),
    );
    if (this.state.view?.title === head.title) this.host.set({ view: { ...head, files: changed, more: Math.max(0, files.length - VIEW_LIMIT) } });
  }

  closeView() {
    this.host.set({ view: null });
  }
}
