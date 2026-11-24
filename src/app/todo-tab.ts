// The To do tab (TodoTab.tsx): the book's TODOs, or one chapter's, grouped
// and in the book's order, each with the line of the book it sits by. A TODO
// marked done keeps its row (struck through, with Undo) until the tab is left,
// so nothing moves under the pointer. Pure; studio.ts finds the chapters.
import type { DoneTodo, Todo } from './todos';

export type TodoScope = 'book' | 'chapter';

/** A chapter of the book and its files (the chapter, then what it includes), in order. */
export type BookChapter = { path: string; files: string[] };

/** Which TODOs show: TODO and FIXME can each be hidden. */
export type TodoKinds = { todo: boolean; fix: boolean };

export type TodoRow = { key: string; todo: Todo; done: DoneTodo | null };
export type TodoGroup = { key: string; title: string; sub: string | null; here: boolean; rows: TodoRow[]; open: number };

/** What tells a TODO apart: where it is and what it says. */
export const todoKey = (t: Pick<Todo, 'path' | 'line' | 'text'>) => `${t.path}:${t.line}:${t.text}`;

/** A TODO to find again after the lines move (a TODO above it taken out, text typed): its file and words, near its line. */
export type TodoRef = Pick<Todo, 'path' | 'line' | 'text'>;

/** A done TODO that's back in the text (⌘Z in the editor, or Undo): its row is the TODO's own again. */
function isBack(d: DoneTodo, todos: Todo[]): boolean {
  return todos.some((t) => t.path === d.todo.path && t.text === d.todo.text && Math.abs(t.line - d.todo.line) <= 2);
}

const kindOn = (t: Todo, kinds: TodoKinds) => (t.fix ? kinds.fix : kinds.todo);

function matches(t: Todo, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${t.text}\n${t.near ?? ''}`.toLowerCase().includes(q);
}

export type TodoGroupsInput = {
  todos: Todo[];
  done: DoneTodo[];
  scope: TodoScope;
  /** The chapter shown (Chapter), with its files; null when the file isn't in one (then just that file). */
  chapter: BookChapter | null;
  /** The book's chapters, in order (Book). */
  chapters: BookChapter[];
  /** The chapter being written in, for "You're here" (Book). */
  here: string | null;
  /** A file as the author knows it ("3. On Relative Growings"), or undefined. */
  titleOf: (path: string) => string | undefined;
  kinds: TodoKinds;
  query: string;
};

/**
 * The rows the tab lists, in groups: in Chapter, by the heading each TODO is
 * under (the chapter's own title before its first section); in Book, by
 * chapter in the book's order, then each file that's in no chapter (the
 * main file, notes). Done rows stay where they were, struck through.
 */
export function todoGroups(input: TodoGroupsInput): TodoGroup[] {
  const { todos, scope, chapter, chapters, here, titleOf, kinds, query } = input;
  const done = input.done.filter((d) => !isBack(d, todos));
  const rows: TodoRow[] = [
    ...todos.map((todo) => ({ key: todoKey(todo), todo, done: null })),
    ...done.map((d) => ({ key: `done:${todoKey(d.todo)}`, todo: d.todo, done: d })),
  ].filter((r) => kindOn(r.todo, kinds) && matches(r.todo, query));
  const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
  // Book order: each chapter's files, then the rest by path.
  const order = new Map<string, number>();
  for (const c of chapters) for (const f of c.files) if (!order.has(f)) order.set(f, order.size);
  const rank = (p: string) => order.get(p) ?? Number.MAX_SAFE_INTEGER;
  const sorted = (list: TodoRow[], files: (p: string) => number) =>
    [...list].sort((a, b) => files(a.todo.path) - files(b.todo.path) || a.todo.path.localeCompare(b.todo.path) || a.todo.line - b.todo.line || (a.done ? 0 : 1) - (b.done ? 0 : 1));
  const group = (key: string, title: string, sub: string | null, isHere: boolean, list: TodoRow[]): TodoGroup => ({ key, title, sub, here: isHere, rows: list, open: list.filter((r) => !r.done).length });

  if (scope === 'chapter') {
    const files = chapter?.files ?? [];
    const mine = sorted(
      rows.filter((r) => files.includes(r.todo.path)),
      (p) => files.indexOf(p),
    );
    const out: TodoGroup[] = [];
    for (const r of mine) {
      const title = r.todo.section ?? titleOf(r.todo.path) ?? basename(r.todo.path);
      const key = `${r.todo.path}#${title}`;
      const last = out[out.length - 1];
      if (last?.key === key) last.rows.push(r);
      else out.push(group(key, title, files.length > 1 && r.todo.path !== chapter?.path ? basename(r.todo.path) : null, false, [r]));
    }
    for (const g of out) g.open = g.rows.filter((r) => !r.done).length;
    return out;
  }

  const out: TodoGroup[] = [];
  const placed = new Set<string>();
  for (const c of chapters) {
    const list = sorted(
      rows.filter((r) => c.files.includes(r.todo.path) && !placed.has(r.key)),
      (p) => c.files.indexOf(p),
    );
    list.forEach((r) => placed.add(r.key));
    const title = titleOf(c.path);
    if (list.length) out.push(group(c.path, title ?? c.path, title ? basename(c.path) : null, c.path === here, list));
  }
  const rest = sorted(
    rows.filter((r) => !placed.has(r.key)),
    rank,
  );
  for (const r of rest) {
    const last = out[out.length - 1];
    if (last?.key === r.todo.path) {
      last.rows.push(r);
      last.open = last.rows.filter((x) => !x.done).length;
    } else {
      const title = titleOf(r.todo.path);
      out.push(group(r.todo.path, title ?? r.todo.path, title ? basename(r.todo.path) : null, false, [r]));
    }
  }
  return out;
}

/** The rows, in the order they're listed. */
export const todoRows = (groups: TodoGroup[]) => groups.flatMap((g) => g.rows);

/**
 * The row for a TODO picked before the lines moved: the same one if it's
 * there, else the one in the same file with the same words nearest its line
 * (a done row counts), else the one on its line (its words being typed);
 * null if it's gone.
 */
export function findRow(rows: TodoRow[], ref: TodoRef | null): TodoRow | null {
  if (!ref) return null;
  const exact = rows.find((r) => todoKey(r.todo) === todoKey(ref));
  if (exact) return exact;
  let best: TodoRow | null = null;
  for (const r of rows) if (r.todo.path === ref.path && r.todo.text === ref.text && (!best || Math.abs(r.todo.line - ref.line) < Math.abs(best.todo.line - ref.line))) best = r;
  return best ?? rows.find((r) => !r.done && r.todo.path === ref.path && r.todo.line === ref.line) ?? null;
}

/** How many TODOs are left in a scope (whatever's filtered): the Book | Chapter counts. */
export function openCount(todos: Todo[], files: string[] | null): number {
  return files ? todos.filter((t) => files.includes(t.path)).length : todos.length;
}

/**
 * The line a TODO sits by, to show under it: Typst markup read as text
 * (`_constants_` → constants, `---` → —; math keeps its `$`, so `$RR^n$`
 * doesn't read as words), or, for code (a `#figure(`, a `caption: […]`), as
 * written, in the code font.
 */
export function nearText(raw: string | undefined): { text: string; code: boolean } {
  const s = (raw ?? '').trim();
  if (!s) return { text: '', code: false };
  // Code: a #call, a closing bracket, an argument (`caption: [],`), a lone `$`, a comment.
  if (/^[#[)\]}]|^\$\s*$|^\/\/|^[a-z][a-z0-9-]*\s*:\s.*[,([{]\s*$/.test(s)) return { text: s, code: true };
  const text = s
    .replace(/(?<![\\\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu, '$1')
    .replace(/(?<![\\\p{L}\p{N}])\*([^*\n]+)\*(?![\p{L}\p{N}])/gu, '$1')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/(?<!\\)~/g, ' ')
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, code: false };
}
