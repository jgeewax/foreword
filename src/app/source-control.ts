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
  /** What's running: a commit, a pull or a push. */
  busy: 'commit' | 'pull' | 'push' | null;
  error: string | null;
  view: GitChangesView | null;
};

export const initialGit: GitState = { status: 'off', repo: null, log: [], busy: null, error: null, view: null };

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

  private get state() {
    return this.host.get();
  }

  /** Status and recent commits (quietly: a failure leaves the last known state). */
  async refresh() {
    if (this.state.status === 'off') this.host.set({ status: 'loading' });
    try {
      const repo = await ipc.gitStatus();
      const log = repo ? await ipc.gitLog(20) : [];
      this.host.set({ status: 'ready', repo, log, error: null });
    } catch (e) {
      this.host.set({ status: 'error', error: errorMessage(e) });
    }
  }

  reset() {
    this.host.set(initialGit);
  }

  async commit(message: string): Promise<boolean> {
    if (!message.trim() || this.state.busy) return false;
    this.host.set({ busy: 'commit' });
    try {
      const short = await ipc.gitCommit(message);
      this.host.report(`Committed ${short}: ${message.trim().split('\n')[0]}`, 'info');
      return true;
    } catch (e) {
      this.host.report(`Couldn't commit: ${errorMessage(e)}`, 'error');
      return false;
    } finally {
      this.host.set({ busy: null });
      await this.refresh();
    }
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

  /** What's changed since the last commit (`only`: one file). */
  async showWorking(only?: string) {
    const repo = this.state.repo;
    if (!repo) return;
    const files = repo.files.filter((f) => !only || f.path === only);
    const branch = repo.branch ? ` on ${repo.branch}` : '';
    await this.show({ title: only ? `Changes to ${only}` : 'Not committed yet', subtitle: `Since the last commit${branch}`, working: true }, files, async (f) => [
      f.status === 'A' || f.status === '?' ? null : await ipc.gitFile('HEAD', f.path),
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
        c.parent && f.status !== 'A' ? await ipc.gitFile(`${c.hash}^`, f.path) : null,
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
