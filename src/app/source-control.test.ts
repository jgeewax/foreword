import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitFile, GitStatus } from '../lib/ipc';
import { SourceControl, branchEntries, discardQuestion, initialGit, mainAction, type GitHost, type GitState } from './source-control';

const ipcMock = vi.hoisted(() => ({
  gitStatus: vi.fn(),
  gitLog: vi.fn(),
  gitDiscard: vi.fn(),
  gitCommit: vi.fn(),
  gitUndoCommit: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitStage: vi.fn(),
  fsRead: vi.fn(),
}));
vi.mock('../lib/ipc', () => ({ ipc: ipcMock, errorMessage: (e: unknown) => String(e instanceof Error ? e.message : e) }));


const repo = (over: Partial<GitStatus> = {}): GitStatus => ({ root: '/book', prefix: '', branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, staged: [], files: [], ...over });
const file = (path: string, status: GitFile['status'] = 'M'): GitFile => ({ path, status });

/** A SourceControl over a made-up state, recording what it asked and did. */
function rig(state: Partial<GitState> = {}, answers: { confirm?: boolean; prompt?: string | null; keep?: Error } = {}) {
  let s: GitState = { ...initialGit, status: 'ready', repo: repo(), ...state };
  const calls: string[] = [];
  const host: GitHost = {
    get: () => s,
    set: (patch) => (s = { ...s, ...patch }),
    report: (text, tone) => calls.push(`${tone}: ${text}`),
    confirm: async (message, title, ok) => (calls.push(`confirm ${title} [${ok}]: ${message}`), answers.confirm ?? true),
    prompt: async (r) => (calls.push(`prompt ${r.title}`), answers.prompt ?? null),
    keep: async (paths) => {
      calls.push(`keep ${paths.join(' ')}`);
      if (answers.keep) throw answers.keep;
    },
    trash: async (path) => void calls.push(`trash ${path}`),
    discarded: async (paths, trashed) => void calls.push(`discarded ${paths.join(' ')} | ${trashed.join(' ')}`),
    ignore: async (path) => void calls.push(`ignore ${path}`),
  };
  return { git: new SourceControl(host), calls, state: () => s };
}

beforeEach(() => {
  for (const f of Object.values(ipcMock)) f.mockReset();
  ipcMock.gitStatus.mockResolvedValue(repo());
  ipcMock.gitLog.mockResolvedValue([]);
});

describe('Discard Changes', () => {
  it('asks as VS Code does, saying where things go', () => {
    const r = repo({ staged: [file('b.typ')] });
    expect(discardQuestion([file('ch/a.typ')], r)).toEqual({
      title: 'Discard Changes',
      message: 'Discard the changes in “a.typ”? It goes back as it was at the last commit.\n\nHistory keeps the book as it is now, so you can go back.',
      ok: 'Discard File',
    });
    expect(discardQuestion([file('b.typ')], r).message).toContain('It goes back as you staged it.');
    expect(discardQuestion([file('gone.typ', 'D')], r).message).toContain('It comes back as it was at the last commit.');
    expect(discardQuestion([file('new.typ', '?')], r)).toMatchObject({ ok: 'Move to Trash', message: expect.stringContaining('“new.typ” is new, not in Git yet') });
    expect(discardQuestion([file('a.typ'), file('n1.typ', '?'), file('n2.typ', '?')], r, true)).toEqual({
      title: 'Discard All Changes',
      message:
        'Discard all the changes in 3 files? They go back as they were at the last commit (or as you staged them), and the 2 new ones, not in Git yet, go to the Trash.\n\nHistory keeps the book as it is now, so you can go back.',
      ok: 'Discard All 3 Files',
    });
    expect(discardQuestion([file('n1.typ', '?'), file('n2.typ', '?')], r).ok).toBe('Discard 2 Files');
  });

  it('keeps the book in History, restores tracked files and trashes new ones', async () => {
    const { git, calls } = rig();
    await git.discard([file('a.typ'), file('new.typ', '?'), file('both.typ', 'U')], true);
    expect(ipcMock.gitDiscard).toHaveBeenCalledWith(['a.typ']);
    // A conflict is left out (it's in Merge Changes); History first, then the files.
    expect(calls.slice(1)).toEqual(['keep a.typ new.typ', 'trash new.typ', 'discarded a.typ | new.typ', 'info: Discarded the changes in 2 files. History has the book as it was.']);
  });

  it('does nothing when cancelled, or when History can’t keep a copy', async () => {
    const no = rig({}, { confirm: false });
    await no.git.discard([file('a.typ')]);
    expect(no.calls).toHaveLength(1);
    const failing = rig({}, { keep: new Error('disk full') });
    await failing.git.discard([file('a.typ')]);
    expect(ipcMock.gitDiscard).not.toHaveBeenCalled();
    expect(failing.calls.at(-1)).toBe("error: Nothing was discarded: History couldn't keep a copy first (disk full).");
    expect(failing.state().busy).toBe(null);
  });
});

describe('committing', () => {
  it('empties the box once committed, and amends with no message', async () => {
    ipcMock.gitCommit.mockResolvedValue('abc1234');
    const { git, state, calls } = rig({ message: 'Chapter two' });
    expect(await git.commit('Chapter two')).toBe(true);
    expect(state().message).toBe('');
    expect(await git.commit('', { amend: true })).toBe(true);
    expect(ipcMock.gitCommit).toHaveBeenLastCalledWith('', true);
    expect(calls.at(-1)).toBe('info: Amended the last commit, abc1234');
    expect(await git.commit('  ')).toBe(false);
  });

  it('asks for a message from a menu when the box is empty', async () => {
    ipcMock.gitCommit.mockResolvedValue('abc1234');
    const { git, calls } = rig({}, { prompt: 'From the menu' });
    await git.commitAsking({ then: 'push' });
    expect(calls[0]).toBe('prompt Commit every change in the book');
    expect(ipcMock.gitCommit).toHaveBeenCalledWith('From the menu', false);
    expect(ipcMock.gitPush).toHaveBeenCalled();
  });

  it('undoes the last commit: its message back in an empty box, asked first if it’s on the remote', async () => {
    ipcMock.gitUndoCommit.mockResolvedValue('Fix the storm\n\nMore words');
    const head = { hash: 'h', short: 'h', subject: 'Fix the storm', author: 'A', time: 0, parents: [], head: true, refs: [] };
    const pushed = rig({ log: [head] }, { confirm: false });
    await pushed.git.undoLastCommit();
    expect(pushed.calls[0]).toMatch(/^confirm Undo Last Commit \[Undo Commit\]: “Fix the storm” is on origin\/main already/);
    expect(ipcMock.gitUndoCommit).not.toHaveBeenCalled();
    const local = rig({ repo: repo({ ahead: 1 }), log: [head] });
    await local.git.undoLastCommit();
    expect(local.state().message).toBe('Fix the storm\n\nMore words');
    expect(local.calls).toEqual(['info: Undid “Fix the storm”: what it changed is staged again.']);
  });
});

describe('the rest of VS Code’s Source Control', () => {
  it('turns Commit into Sync Changes or Publish Branch when there’s nothing to commit', () => {
    expect(mainAction(repo({ files: [file('a.typ')] }))).toBe('commit');
    expect(mainAction(repo({ ahead: 2 }))).toBe('sync');
    expect(mainAction(repo({ behind: 1 }))).toBe('sync');
    expect(mainAction(repo())).toBe('commit');
    expect(mainAction(repo({ upstream: null }))).toBe('publish');
    expect(mainAction(repo({ branch: null, upstream: null }))).toBe('commit');
  });

  it('syncs: pull, then push', async () => {
    const order: string[] = [];
    ipcMock.gitPull.mockImplementation(async () => void order.push('pull'));
    ipcMock.gitPush.mockImplementation(async () => void order.push('push'));
    const { git, calls } = rig({ repo: repo({ ahead: 1, behind: 1 }) });
    await git.sync();
    expect(order).toEqual(['pull', 'push']);
    expect(calls.at(-1)).toBe('info: In step with origin/main.');
  });

  it('stages a conflict as resolved, asking first if its markers are still in', async () => {
    ipcMock.fsRead.mockResolvedValue({ text: 'a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> other\n', hash: 'x' });
    const { git, calls } = rig({}, { confirm: false });
    await git.resolve(['ch/both.typ']);
    expect(calls[0]).toMatch(/^confirm Merge Conflicts \[Stage Anyway\]: “both.typ” still has Git’s conflict markers/);
    expect(ipcMock.gitStage).not.toHaveBeenCalled();
    ipcMock.fsRead.mockResolvedValue({ text: 'resolved\n', hash: 'y' });
    await git.resolve(['ch/both.typ']);
    expect(ipcMock.gitStage).toHaveBeenCalledWith(['ch/both.typ']);
  });

  it('lists branches to check out: Create first, the ones here, then a remote’s not here yet', () => {
    const picked: string[] = [];
    const entries = branchEntries(
      [
        { name: 'main', kind: 'local', current: true },
        { name: 'draft', kind: 'local', current: false },
        { name: 'origin/main', kind: 'remote', current: false },
        { name: 'origin/ideas', kind: 'remote', current: false },
      ],
      (b) => picked.push(b.name),
      () => picked.push('create'),
    );
    const labels = entries.map((e) => (typeof e === 'object' && e ? `${e.label}${'checked' in e && e.checked ? ' ✓' : ''}` : e));
    expect(labels).toEqual(['Create New Branch…', 'separator', 'main ✓', 'draft', 'separator', 'origin/ideas']);
    for (const e of entries) if (typeof e === 'object' && e && 'action' in e) e.action();
    expect(picked).toEqual(['create', 'main', 'draft', 'origin/ideas']);
  });
});
