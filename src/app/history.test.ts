import { describe, expect, it, vi } from 'vitest';
import type { Documents } from '../editor/documents';
import type { FileChange, Version } from '../lib/ipc';
import { describeRestore, History, initialHistory, type HistoryState } from './history';

const ipcMock = vi.hoisted(() => ({
  historyInit: vi.fn(),
  historyList: vi.fn(),
  historySnapshot: vi.fn(),
  historyChanges: vi.fn(),
  historyFile: vi.fn(),
}));
vi.mock('../lib/ipc', () => ({ ipc: ipcMock, errorMessage: (e: unknown) => String(e instanceof Error ? e.message : e) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn() }));

describe('describeRestore', () => {
  it('names restored, skipped and kept files', () => {
    expect(
      describeRestore({
        restored: ['chapters/ch1.typ'],
        skipped: [{ path: 'chapters/ch2.typ', why: 'unsaved edits' }],
        kept: ['chapters/new.typ'],
      }),
    ).toBe("Restored ch1.typ. Skipped ch2.typ (unsaved edits). Left new.typ in place (added later; delete by hand if you don't want it).");
  });

  it('summarises long lists and says when nothing changed', () => {
    expect(describeRestore({ restored: ['a', 'b', 'c', 'd'], skipped: [], kept: [] })).toBe('Restored 4 files.');
    expect(describeRestore({ restored: [], skipped: [], kept: [] })).toBe('Nothing needed restoring.');
  });
});

describe('what changed: versions, or the book as it is now', () => {
  const version = (id: string, parent: string | null): Version => ({ id, parent, time: 0, label: id, kind: 'save', files: 1, added: 1, deleted: 0 });
  const change = (path: string, status: FileChange['status'] = 'M'): FileChange => ({ path, status, added: 1, deleted: 0 });

  /** History over made-up versions (v1, then v2, the latest), with these files open (their text, unsaved words and all). */
  async function rig(open: Record<string, string>) {
    let s: HistoryState = initialHistory;
    const docs = { get: (p: string) => (p in open ? { model: { getValue: () => open[p] } } : undefined) } as unknown as Documents;
    const history = new History({ get: () => s, set: (patch) => (s = { ...s, ...patch }), docs: () => docs, agentRunning: () => false, report: () => {} });
    ipcMock.historyInit.mockResolvedValue({ gitDir: '/g', git: 'git' });
    ipcMock.historyList.mockResolvedValue([version('v2', 'v1'), version('v1', null)]);
    ipcMock.historySnapshot.mockResolvedValue(null);
    ipcMock.historyChanges.mockResolvedValue([change('a.typ'), change('b.typ'), change('gone.typ', 'D')]);
    ipcMock.historyFile.mockImplementation(async (id: string, path: string) => (id === 'v2' && path === 'gone.typ' ? null : `${path} at ${id}\n`));
    await history.start([]);
    return { history, state: () => s };
  }

  it('compared with now, each file is the file as it is, unsaved words too: its diff edits it', async () => {
    const { history, state } = await rig({ 'a.typ': 'a.typ, unsaved\n' });
    await history.compareWithNow(version('v1', null));
    expect(state().changes?.files?.map((f) => [f.path, f.live, f.after])).toEqual([
      ['a.typ', true, 'a.typ, unsaved\n'],
      ['b.typ', true, 'b.typ at v2\n'],
      // Gone now: nothing to edit.
      ['gone.typ', false, null],
    ]);
    expect(state().changes?.files?.[0].diff?.hunks.length).toBe(1);
  });

  it('between two versions, read-only: the newer side is that version, not the file', async () => {
    const { history, state } = await rig({ 'a.typ': 'a.typ, unsaved\n' });
    await history.showChanges(version('v2', 'v1'));
    expect(state().changes?.files?.map((f) => [f.path, !!f.live, f.after])).toEqual([
      ['a.typ', false, 'a.typ at v2\n'],
      ['b.typ', false, 'b.typ at v2\n'],
      ['gone.typ', false, null],
    ]);
  });
});
