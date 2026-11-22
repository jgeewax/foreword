import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookStore, mergeTaskRecords, readSession, readUnsaved, Saver, unsavedName } from './book-state';
import type { TaskRecord } from './tasks';

/** The app's data folder for one book, as book_state.rs keeps it. */
const disk = vi.hoisted(() => new Map<string, string>());
const ipcMock = vi.hoisted(() => ({
  bookStateRead: vi.fn(async (_root: string, name: string) => disk.get(name) ?? null),
  bookStateWrite: vi.fn(async (_root: string, name: string, text: string) => void disk.set(name, text)),
  bookStateRemove: vi.fn(async (_root: string, name: string) => void disk.delete(name)),
  bookStateList: vi.fn(async (_root: string, folder: string) => [...disk].filter(([n]) => n.startsWith(`${folder}/`)).map(([, t]) => t)),
}));
vi.mock('../lib/ipc', () => ({ ipc: ipcMock }));

const ROOT = '/books/a';
const nothingBefore = { session: {}, tasks: [] };

beforeEach(() => {
  disk.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('Saver', () => {
  it('writes the latest value a moment after the first change, however long the changes go on', async () => {
    const written: number[] = [];
    const saver = new Saver(500, 'test');
    for (let i = 1; i <= 8; i++) {
      saver.schedule(async () => void written.push(i));
      await vi.advanceTimersByTimeAsync(100);
    }
    // Eight changes 100 ms apart: one write by 500 ms (the fifth's value), one after.
    expect(written).toEqual([5]);
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toEqual([5, 8]);
  });

  it('writes one at a time, in order; flush writes now; cancel drops what waits', async () => {
    const log: string[] = [];
    const saver = new Saver(1000, 'test');
    let release!: () => void;
    saver.schedule(async () => {
      log.push('a start');
      await new Promise<void>((r) => (release = r));
      log.push('a end');
    });
    void saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    saver.schedule(async () => void log.push('b'));
    const done = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['a start']);
    release();
    await done;
    expect(log).toEqual(['a start', 'a end', 'b']);
    saver.schedule(async () => void log.push('c'));
    saver.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(log).toEqual(['a start', 'a end', 'b']);
  });

  it('keeps going after a write fails', async () => {
    const saver = new Saver(10, 'test');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    saver.schedule(async () => {
      throw new Error('disk full');
    });
    await saver.flush();
    let wrote = false;
    saver.schedule(async () => void (wrote = true));
    await saver.flush();
    expect(wrote).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('readSession', () => {
  it('keeps what makes sense and drops the rest', () => {
    const s = readSession({
      tabs: ['one.typ', 2, 'two.typ'],
      active: 'two.typ',
      views: { 'one.typ': { cursorState: [] }, 'bad.typ': 'x' },
      task: 'ses_1',
      draft: 'Half a',
      sidebar: 'search',
      previewTarget: 'cover',
      previewChapter: 'one.typ',
      previewPlace: { book: { page: 3, offset: 0.25 }, cover: { page: -1, offset: 0 }, 'chapter:one.typ': { page: 1, offset: 2 } },
      previewScope: 'chapter',
    });
    expect(s).toEqual({
      tabs: ['one.typ', 'two.typ'],
      active: 'two.typ',
      views: { 'one.typ': { cursorState: [] } },
      task: 'ses_1',
      draft: 'Half a',
      sidebar: 'search',
      previewTarget: 'cover',
      previewChapter: 'one.typ',
      previewPlace: { book: { page: 3, offset: 0.25 } },
      previewScope: 'chapter',
    });
    expect(readSession(null)).toEqual(readSession({}));
    expect(readSession('nonsense').tabs).toEqual([]);
    expect(readSession({ previewTarget: 'elsewhere' }).previewTarget).toBe('book');
    // Never chosen (a session from before the book had its own): the window decides.
    expect(readSession({}).previewScope).toBeNull();
    expect(readSession({ previewScope: 'part' }).previewScope).toBeNull();
  });
});

describe('mergeTaskRecords', () => {
  const rec = (id: string, updated: number, rest: Partial<TaskRecord> = {}): TaskRecord => ({ id, status: 'open', updated, ...rest });

  it('has every task from either, the later copy of one in both', () => {
    const file = [rec('a', 5, { title: 'From the file' }), rec('b', 9, { status: 'done' })];
    const page = [rec('a', 7, { title: 'Renamed by an older Foreword' }), rec('b', 3), rec('c', 1)];
    const merged = mergeTaskRecords(file, page);
    expect(merged.map((r) => `${r.id}:${r.title ?? ''}:${r.status}`)).toEqual(['a:Renamed by an older Foreword:open', 'b::done', 'c::open']);
  });

  it('of two copies changed at once, the file’s, with what only the other has', () => {
    const merged = mergeTaskRecords([rec('a', 5, { title: 'Mine' })], [rec('a', 5, { title: 'Theirs', kept: true })]);
    expect(merged).toEqual([{ id: 'a', status: 'open', updated: 5, title: 'Mine', kept: true }]);
  });
});

describe('unsaved text', () => {
  it('reads what was kept, and names each file’s own place', () => {
    const kept = { path: 'ch/one.typ', text: 'new', diskText: 'old', diskHash: 'h1', at: 3 };
    expect(readUnsaved(JSON.stringify(kept))).toEqual(kept);
    expect(readUnsaved(JSON.stringify({ ...kept, diskHash: null }))?.diskHash).toBeNull();
    expect(readUnsaved('{"path":"x"}')).toBeNull();
    expect(readUnsaved('{')).toBeNull();
    expect(unsavedName('ch/one.typ')).toMatch(/^unsaved\/[0-9a-f]{16}\.json$/);
    expect(unsavedName('ch/one.typ')).toBe(unsavedName('ch/one.typ'));
    expect(unsavedName('ch/one.typ')).not.toBe(unsavedName('ch/two.typ'));
  });
});

describe('BookStore', () => {
  it('starts from what the page storage had, then keeps its own files', async () => {
    const tasks = [{ id: 't1', status: 'open' as const, updated: 1 }];
    const book = await BookStore.open(ROOT, { session: { tabs: ['one.typ'], active: 'one.typ' }, tasks });
    expect(book.session.tabs).toEqual(['one.typ']);
    expect(book.tasks).toEqual(tasks);
    await book.flush();
    expect(JSON.parse(disk.get('tasks.json')!)).toEqual(tasks);
    expect(JSON.parse(disk.get('session.json')!).active).toBe('one.typ');
    // Next time, its own files: the page storage's tabs (an older Foreword's) don't count.
    const again = await BookStore.open(ROOT, { session: { tabs: ['other.typ'] }, tasks: [] });
    expect(again.session.tabs).toEqual(['one.typ']);
    expect(again.tasks).toEqual(tasks);
  });

  it('keeps changes a moment after they come, and everything waiting as it closes', async () => {
    const book = await BookStore.open(ROOT, nothingBefore);
    await book.flush();
    book.updateSession({ active: 'two.typ' });
    book.setTasks([{ id: 't2', status: 'done' }]);
    expect(JSON.parse(disk.get('session.json')!).active).toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    expect(JSON.parse(disk.get('session.json')!).active).toBe('two.typ');
    expect(JSON.parse(disk.get('tasks.json')!)).toEqual([{ id: 't2', status: 'done' }]);
    book.updateSession({ draft: 'Unsent' });
    await book.close();
    expect(JSON.parse(disk.get('session.json')!).draft).toBe('Unsent');
    // Closed: nothing after is kept (closing the book's files, a reset window).
    book.updateSession({ draft: '' });
    book.keepUnsaved('one.typ', () => null, 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(disk.get('session.json')!).draft).toBe('Unsent');
  });

  it('keeps a file’s unsaved text while there is some, and lets it go once saved', async () => {
    const book = await BookStore.open(ROOT, nothingBefore);
    let unsaved: { text: string } | null = { text: 'typed' };
    const now = () => (unsaved ? { path: 'one.typ', text: unsaved.text, diskText: 'saved', diskHash: 'h', at: 1 } : null);
    book.keepUnsaved('one.typ', now);
    unsaved = { text: 'typed more' };
    await vi.advanceTimersByTimeAsync(1100);
    expect(readUnsaved(disk.get(unsavedName('one.typ'))!)?.text).toBe('typed more');
    // Reopened with it: there for the editor to put back.
    expect((await BookStore.open(ROOT, nothingBefore)).unsaved.map((u) => u.text)).toEqual(['typed more']);
    unsaved = null;
    book.keepUnsaved('one.typ', now, 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(disk.has(unsavedName('one.typ'))).toBe(false);
  });
});
