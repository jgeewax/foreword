// Source Control: the author's own Git repository, when the book is in one.
// What's changed since the last commit, committing, pulling and pushing, and
// the recent commits, each with "what changed" in words (the same view as
// History). Separate from History, which keeps its own snapshots and never
// touches this repository.
import { errorMessage, ipc, type GitCommit, type GitFile, type GitStatus } from '../lib/ipc';
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
  /** What's running: a commit, a pull or a push. */
  busy: 'commit' | 'pull' | 'push' | null;
  error: string | null;
  view: GitChangesView | null;
};

/** How many files aren't committed, staged or not (the activity bar's badge). */
export const uncommitted = (repo: GitStatus | null) => (repo ? new Set([...repo.staged, ...repo.files].map((f) => f.path)).size : 0);

/** Commits in the graph at first, and added by each Load More. */
export const LOG_PAGE = 50;

export const initialGit: GitState = { status: 'off', repo: null, log: [], limit: LOG_PAGE, busy: null, error: null, view: null };

export type GitHost = {
  get(): GitState;
  set(patch: Partial<GitState>): void;
  report(text: string, tone: 'info' | 'error'): void;
};

/** Files shown in one dialog (the rest are counted). */
const VIEW_LIMIT = 40;

/** Git's statuses as History's (added, modified, deleted). */
const asChange = (s: GitFile['status']): ChangedFile['status'] => (s === 'A' || s === '?' ? 'A' : s === 'D' ? 'D' : 'M');

export class SourceControl {
  constructor(private readonly host: GitHost) {}

  /** The commit message being written, kept while the view is closed. */
  message = '';

  private get state() {
    return this.host.get();
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
    this.message = '';
    this.host.set(initialGit);
  }

  /** Commit every change in the book; `push`: then send it to the remote. */
  async commit(message: string, push = false): Promise<boolean> {
    if (!message.trim() || this.state.busy) return false;
    this.host.set({ busy: 'commit' });
    let ok = false;
    try {
      const short = await ipc.gitCommit(message);
      this.host.report(`Committed ${short}: ${message.trim().split('\n')[0]}`, 'info');
      ok = true;
    } catch (e) {
      this.host.report(`Couldn't commit: ${errorMessage(e)}`, 'error');
    } finally {
      this.host.set({ busy: null });
      await this.refresh();
    }
    if (ok && push) await this.push();
    return ok;
  }

  async pull() {
    await this.remote('pull', () => ipc.gitPull(), 'Up to date with the remote.');
  }

  async push() {
    await this.remote('push', () => ipc.gitPush(), 'Sent to the remote.');
  }

  private async remote(kind: 'pull' | 'push', run: () => Promise<string>, done: string) {
    if (this.state.busy) return;
    this.host.set({ busy: kind });
    try {
      await run();
      this.host.report(done, 'info');
    } catch (e) {
      this.host.report(errorMessage(e), 'error');
    } finally {
      this.host.set({ busy: null });
      await this.refresh();
    }
  }

  /** Stage files for the next commit (`.`: every change in the book), as VS Code's +. */
  async stage(paths: string[]) {
    await this.index(() => ipc.gitStage(paths), "Couldn't stage");
  }

  /** Take files out of the next commit (`.`: all of them); their changes stay. */
  async unstage(paths: string[]) {
    await this.index(() => ipc.gitUnstage(paths), "Couldn't unstage");
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
