// What Foreword keeps of a book on this Mac besides its files and chats
// (book_state.rs): the window as the author left it (session.json), the
// book's tasks (tasks.json), and what's typed in its files but not saved yet
// (unsaved/). Each is written a moment after it changes, however long the
// changes go on, and flushed to the disk: quitting, a crash, a force quit or
// the Mac going down loses that moment at most, and opening the book again is
// the same as never having closed it.

import { ipc } from '../lib/ipc';
import { readTaskRecords, type TaskRecord } from './tasks';

/**
 * Writes one file: the latest value, at most `delay` ms after the first change
 * since the last write (however long the changes go on); one write at a time,
 * in order.
 */
export class Saver {
  private job: (() => Promise<void>) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly delay: number,
    private readonly what: string,
  ) {}

  /** `job` (the write) in a moment, unless a newer one takes its place first. */
  schedule(job: () => Promise<void>, delay = this.delay) {
    this.job = job;
    if (this.timer === undefined) this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** What's waiting, written now; resolves once every write so far is done. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const job = this.job;
    this.job = null;
    if (job) this.chain = this.chain.then(job).catch((e) => console.warn(`keeping ${this.what}`, e));
    return this.chain;
  }

  /** What's waiting is dropped. */
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.job = null;
  }
}

/** A place in the preview: the page at its top (from 0), and how far down that page (0 to 1). */
export type PreviewPlace = { page: number; offset: number };

/** The book's window as the author left it. */
export type BookSession = {
  /** The files' tabs in order, and the file in front. */
  tabs: string[];
  active: string | null;
  /** Each open file's cursor, selection and scroll (Monaco's view state). */
  views: Record<string, unknown>;
  /** The task shown in the chat (null: a new one), and the message being written in it. */
  task: string | null;
  draft: string;
  /** The sidebar's view. */
  sidebar: string | null;
  /** What the preview showed (the book or its cover), the chapter it last showed alone, and where it was in each ("book", "cover", "chapter:<path>"). */
  previewTarget: 'book' | 'cover';
  previewChapter: string | null;
  previewPlace: Record<string, PreviewPlace>;
};

const EMPTY: BookSession = { tabs: [], active: null, views: {}, task: null, draft: '', sidebar: null, previewTarget: 'book', previewChapter: null, previewPlace: {} };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPlace = (v: unknown): v is PreviewPlace => isObject(v) && Number.isInteger(v.page) && (v.page as number) >= 0 && typeof v.offset === 'number' && v.offset >= 0 && v.offset <= 1;

/** What can be used of a session (as kept, or put together from before it was): anything else is as for a book never opened. */
export function readSession(raw: unknown): BookSession {
  if (!isObject(raw)) return { ...EMPTY };
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    tabs: Array.isArray(raw.tabs) ? raw.tabs.filter((t): t is string => typeof t === 'string') : [],
    active: text(raw.active),
    views: isObject(raw.views) ? Object.fromEntries(Object.entries(raw.views).filter(([, v]) => isObject(v))) : {},
    task: text(raw.task),
    draft: text(raw.draft) ?? '',
    sidebar: text(raw.sidebar),
    previewTarget: raw.previewTarget === 'cover' ? 'cover' : 'book',
    previewChapter: text(raw.previewChapter),
    previewPlace: isObject(raw.previewPlace) ? Object.fromEntries(Object.entries(raw.previewPlace).filter((e): e is [string, PreviewPlace] => isPlace(e[1]))) : {},
  };
}

/**
 * The book's tasks from its file and from the page's storage, where Foreword
 * kept them before (and an older Foreword still does): every task in either.
 * Of a task in both, the copy changed later wins; if neither was, the file's,
 * with what only the other has (a note made as the book closed).
 */
export function mergeTaskRecords(file: readonly TaskRecord[], page: readonly TaskRecord[]): TaskRecord[] {
  const byId = new Map(file.map((r) => [r.id, r]));
  for (const r of page) {
    const f = byId.get(r.id);
    if (!f) byId.set(r.id, r);
    else if ((r.updated ?? 0) > (f.updated ?? 0)) byId.set(r.id, { ...f, ...r });
    else byId.set(r.id, { ...r, ...f });
  }
  return [...byId.values()];
}

/** What's typed in a file and not saved: its text in the editor, and the text on disk it was typed over (a merge's starting point, if the file has changed on disk since). */
export type UnsavedText = { path: string; text: string; diskText: string; diskHash: string | null; at: number };

export function readUnsaved(text: string): UnsavedText | null {
  try {
    const v = JSON.parse(text);
    return isObject(v) && typeof v.path === 'string' && typeof v.text === 'string' && typeof v.diskText === 'string' && (typeof v.diskHash === 'string' || v.diskHash === null)
      ? { path: v.path, text: v.text, diskText: v.diskText, diskHash: v.diskHash, at: typeof v.at === 'number' ? v.at : 0 }
      : null;
  } catch {
    return null;
  }
}

/** A file's name for a path: two 32-bit FNV-1a hashes of it. */
export function unsavedName(path: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619) >>> 0;
    return h.toString(16).padStart(8, '0');
  };
  return `unsaved/${fnv(2166136261)}${fnv(0x9e3779b9)}.json`;
}

const SESSION = 'session.json';
const TASKS = 'tasks.json';

function parse(text: string | null): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** One book's state, for the window it's open in: read when it opens, written as it changes, and flushed as it closes. */
export class BookStore {
  private sessionSaver = new Saver(500, 'where the book was left');
  private tasksSaver = new Saver(300, 'the book’s tasks');
  private unsavedSavers = new Map<string, Saver>();
  private closed = false;

  private constructor(
    readonly root: string,
    public session: BookSession,
    public tasks: TaskRecord[],
    /** What was typed and not saved when the book was last open. */
    readonly unsaved: UnsavedText[],
  ) {}

  /**
   * The book's state as kept. `before`: as Foreword kept it in the page's
   * storage before it had these files (and an older Foreword still does),
   * which a book kept that way starts from.
   */
  static async open(root: string, before: { session: Partial<BookSession>; tasks: TaskRecord[] }): Promise<BookStore> {
    const read = (name: string) => ipc.bookStateRead(root, name).catch((e) => (console.warn(`reading ${name}`, e), null));
    const [session, tasks, unsaved] = await Promise.all([read(SESSION), read(TASKS), ipc.bookStateList(root, 'unsaved').catch(() => [] as string[])]);
    const kept = readTaskRecords(parse(tasks));
    const book = new BookStore(root, readSession(parse(session) ?? before.session), mergeTaskRecords(kept, before.tasks), unsaved.flatMap((t) => readUnsaved(t) ?? []));
    // In its files from now on.
    if (JSON.stringify(book.tasks) !== JSON.stringify(kept)) book.setTasks(book.tasks);
    if (!session) book.updateSession({});
    return book;
  }

  updateSession(patch: Partial<BookSession>) {
    if (this.closed) return;
    this.session = { ...this.session, ...patch };
    this.sessionSaver.schedule(() => ipc.bookStateWrite(this.root, SESSION, JSON.stringify(this.session)));
  }

  setTasks(records: TaskRecord[]) {
    if (this.closed) return;
    this.tasks = records;
    this.tasksSaver.schedule(() => ipc.bookStateWrite(this.root, TASKS, JSON.stringify(this.tasks)));
  }

  /**
   * A file's unsaved text, kept a moment after it changes: `now` gives it when
   * it's written (null: nothing unsaved, so nothing's kept).
   */
  keepUnsaved(path: string, now: () => UnsavedText | null, delay?: number) {
    if (this.closed) return;
    let saver = this.unsavedSavers.get(path);
    if (!saver) this.unsavedSavers.set(path, (saver = new Saver(1000, `the unsaved text of ${path}`)));
    const name = unsavedName(path);
    saver.schedule(async () => {
      if (this.closed) return;
      const unsaved = now();
      await (unsaved ? ipc.bookStateWrite(this.root, name, JSON.stringify(unsaved)) : ipc.bookStateRemove(this.root, name));
    }, delay);
  }

  /** Everything waiting, written now. */
  async flush() {
    await Promise.all([this.sessionSaver.flush(), this.tasksSaver.flush(), ...[...this.unsavedSavers.values()].map((s) => s.flush())]);
  }

  /** The book is closing: what's waiting is written, and nothing after (closing its files keeps their unsaved text). */
  async close() {
    await this.flush();
    this.closed = true;
    for (const s of [this.sessionSaver, this.tasksSaver, ...this.unsavedSavers.values()]) s.cancel();
  }
}
