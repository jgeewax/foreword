// TODOs the author left in the book: `// TODO: …` and `FIXME` comments,
// `/* TODO … */` blocks, and `#todo[…]` / `#todo("…")` calls (as in drafting
// packages). Shown in the To do tab and offered as chat suggestions.

export type Todo = {
  path: string;
  /** 1-based. */
  line: number;
  text: string;
  /** How it was written: a whole-line comment can be removed by "Done". */
  kind: 'line-comment' | 'inline-comment' | 'block-comment' | 'call';
  /** A FIXME (something to fix), not a TODO. */
  fix?: boolean;
  /** The heading it's under (any level), without markup; null before the first. */
  section?: string | null;
  /** The book's line it sits by, as written: what comes before an inline comment, else the next line of text (the one before, at the end). */
  near?: string;
};

const LINE = /^(\s*)\/\/\s*(TODO|FIXME)(?=[:\s]|$)[:\s-]*(.*)$/i;
// After whitespace only (so not the // in a URL), and followed by ":" or a space.
const INLINE = /(?:^|\s)\/\/\s*(TODO|FIXME)(?=[:\s]|$)[:\s-]*(.*)$/i;
const BLOCK = /\/\*\s*(TODO|FIXME)\b[:\s-]*([^\n]*?)\s*(\*\/|$)/i;
const CALL = /#todo(?:\(\s*"((?:[^"\\]|\\.)*)"\s*\)|\[([^\]\n]*)\])/;
const MD = /^\s*(?:[-*]\s+\[ \]\s+|(?:TODO|FIXME)\b[:\s-]*)(.*)$/i;

/** A heading's words, without markup: `== Added constants <added>`, `#heading(level: 2)[Exercises I]`, `## Notes`; null if the line isn't one. */
export function headingText(line: string, markdown = false): string | null {
  if (!markdown) line = line.replace(/\s\/\/.*$/, '');
  const m = markdown ? /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) : (/^\s*=+\s+(.+?)\s*(<[\w:.-]+>)?\s*$/.exec(line) ?? /^\s*#heading\([^)]*\)\[(.+)\]\s*(<[\w:.-]+>)?\s*$/.exec(line));
  return m ? m[1].replace(/[*_`]/g, '').replace(/\\(.)/g, '$1').trim() || null : null;
}

/** A line that's only a comment, or nothing: not the book's text. */
const quiet = (line: string) => /^\s*(\/\/.*|\/\*.*|\*.*\*\/\s*)?$/.test(line);

export function parseTodos(text: string, path: string): Todo[] {
  const todos: Todo[] = [];
  const markdown = path.endsWith('.md');
  const lines = text.split('\n');
  let section: string | null = null;
  /** The line of text next to line `i` (0-based): the next one that isn't a comment or blank, else the one before. */
  const nearLine = (i: number) => {
    for (let j = i + 1; j < lines.length && j <= i + 6; j++) if (!quiet(lines[j]) && !CALL.test(lines[j])) return lines[j].trim();
    for (let j = i - 1; j >= 0 && j >= i - 6; j--) if (!quiet(lines[j]) && !CALL.test(lines[j])) return lines[j].trim();
    return '';
  };
  lines.forEach((raw, i) => {
    const line = i + 1;
    const push = (t: string, kind: Todo['kind'], fix: boolean, near: string) => {
      const clean = t.replace(/\s*\*\/\s*$/, '').trim();
      todos.push({ path, line, text: clean || '(no description)', kind, fix, section, near });
    };
    const heading = headingText(raw, markdown);
    if (heading) section = heading;
    if (markdown) {
      const m = MD.exec(raw);
      if (m && (/\[ \]/.test(raw) || /^\s*(TODO|FIXME)\b/i.test(raw))) push(m[1], 'line-comment', /^\s*FIXME\b/i.test(raw), nearLine(i));
      return;
    }
    let m: RegExpExecArray | null;
    if ((m = LINE.exec(raw))) return push(m[3], 'line-comment', /^fixme$/i.test(m[2]), nearLine(i));
    if ((m = BLOCK.exec(raw))) {
      const rest = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim();
      return push(m[2], 'block-comment', /^fixme$/i.test(m[1]), rest || nearLine(i));
    }
    if ((m = CALL.exec(raw))) {
      const rest = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim();
      return push(m[1] ?? m[2] ?? '', 'call', false, rest || nearLine(i));
    }
    if ((m = INLINE.exec(raw))) push(m[2], 'inline-comment', /^fixme$/i.test(m[1]), raw.slice(0, m.index).trim());
  });
  return todos;
}

/**
 * The TODO on a line, for the editor's hover and right-click menu, with its
 * columns (1-based, Monaco's): from its `//`, `/*` or `#todo` to where it ends.
 * With a column, only if that column is on it.
 */
export function todoAt(lineText: string, path: string, line: number, column?: number): { todo: Todo; from: number; to: number; fix: boolean } | null {
  if (path.endsWith('.md')) return null;
  const [todo] = parseTodos(lineText, path);
  if (!todo) return null;
  const m = (todo.kind === 'block-comment' ? BLOCK : todo.kind === 'call' ? CALL : INLINE).exec(lineText);
  if (!m) return null;
  const lead = /^\s*/.exec(m[0])![0].length;
  const from = m.index + lead + 1;
  const to = todo.kind === 'block-comment' || todo.kind === 'call' ? m.index + m[0].length + 1 : lineText.length + 1;
  if (column !== undefined && (column < from || column > to)) return null;
  return { todo: { ...todo, line }, from, to, fix: todo.kind !== 'call' && /^fixme$/i.test(m[1]) };
}

/** Whether Done can take the TODO out by itself: a `// TODO` comment, not a block comment or a #todo call. */
export const removable = (t: Todo) => t.kind === 'line-comment' || t.kind === 'inline-comment';

/** The line without its TODO (for "Done"); null when that isn't a simple edit. */
export function withoutTodo(lineText: string, todo: Todo): string | null {
  if (todo.kind === 'line-comment') return '';
  if (todo.kind === 'inline-comment') return lineText.replace(INLINE, '').replace(/\s+$/, '');
  return null;
}

/** A TODO Done took out, and what was around it, so Undo can put it back where it was. */
export type DoneTodo = { todo: Todo; was: string; before: string | null; after: string | null };

/** The text without the TODO (Done), and how to put it back; null when Done can't take it out by itself. */
export function takeOutTodo(text: string, todo: Todo): { text: string; done: DoneTodo } | null {
  const lines = text.split('\n');
  const i = todo.line - 1;
  const was = lines[i];
  const next = was === undefined ? null : withoutTodo(was, todo);
  if (next === null) return null;
  const done: DoneTodo = { todo, was, before: i > 0 ? lines[i - 1] : null, after: i + 1 < lines.length ? lines[i + 1] : null };
  if (next === '') lines.splice(i, 1);
  else lines[i] = next;
  return { text: lines.join('\n'), done };
}

/**
 * The text with a TODO Done took out put back (Undo): a whole line between
 * the lines it was between, or the comment at the end of its line, wherever
 * that is now, nearest the line it was on. Null if the text around it changed
 * too much to tell, or it's back already.
 */
export function restoreTodo(text: string, done: DoneTodo): string | null {
  const lines = text.split('\n');
  const at = done.todo.line - 1;
  const nearest = (fits: (i: number) => boolean, last: number) => {
    let best = -1;
    for (let i = 0; i <= last; i++) if (fits(i) && (best < 0 || Math.abs(i - at) < Math.abs(best - at))) best = i;
    return best;
  };
  if (lines[at] === done.was) return null;
  if (done.todo.kind === 'line-comment') {
    const i = nearest((i) => (done.before === null ? i === 0 : lines[i - 1] === done.before) && (done.after === null ? i === lines.length : lines[i] === done.after), lines.length);
    if (i < 0) return null;
    lines.splice(i, 0, done.was);
    return lines.join('\n');
  }
  const stripped = withoutTodo(done.was, done.todo);
  const i = stripped === null ? -1 : nearest((i) => lines[i] === stripped, lines.length - 1);
  if (i < 0) return null;
  lines[i] = done.was;
  return lines.join('\n');
}

/**
 * The TODOs to offer first: the open file's, then the rest of its chapter's
 * (`chapter`: the chapter's files, in order), then the book's, each as found.
 */
export function nearestTodos(todos: Todo[], active: string | null, chapter: string[]): Todo[] {
  const rank = (t: Todo) => (t.path === active ? -1 : chapter.includes(t.path) ? chapter.indexOf(t.path) : chapter.length);
  return [...todos].sort((a, b) => rank(a) - rank(b));
}

/** The chat message for working on a TODO. */
export function todoPrompt(todo: Todo): string {
  return `Work on this TODO in ${todo.path} (line ${todo.line}): “${todo.text}”. When it's done, remove the TODO itself.`;
}
