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
};

const LINE = /^(\s*)\/\/\s*(TODO|FIXME)(?=[:\s]|$)[:\s-]*(.*)$/i;
// After whitespace only (so not the // in a URL), and followed by ":" or a space.
const INLINE = /(?:^|\s)\/\/\s*(TODO|FIXME)(?=[:\s]|$)[:\s-]*(.*)$/i;
const BLOCK = /\/\*\s*(TODO|FIXME)\b[:\s-]*([^\n]*?)\s*(\*\/|$)/i;
const CALL = /#todo(?:\(\s*"((?:[^"\\]|\\.)*)"\s*\)|\[([^\]\n]*)\])/;
const MD = /^\s*(?:[-*]\s+\[ \]\s+|(?:TODO|FIXME)\b[:\s-]*)(.*)$/i;

export function parseTodos(text: string, path: string): Todo[] {
  const todos: Todo[] = [];
  const markdown = path.endsWith('.md');
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const push = (t: string, kind: Todo['kind']) => {
      const clean = t.replace(/\s*\*\/\s*$/, '').trim();
      todos.push({ path, line, text: clean || '(no description)', kind });
    };
    if (markdown) {
      const m = MD.exec(raw);
      if (m && (/\[ \]/.test(raw) || /^\s*(TODO|FIXME)\b/i.test(raw))) push(m[1], 'line-comment');
      return;
    }
    let m: RegExpExecArray | null;
    if ((m = LINE.exec(raw))) return push(m[3], 'line-comment');
    if ((m = BLOCK.exec(raw))) return push(m[2], 'block-comment');
    if ((m = CALL.exec(raw))) return push(m[1] ?? m[2] ?? '', 'call');
    if ((m = INLINE.exec(raw))) push(m[2], 'inline-comment');
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

/** The chat message for working on a TODO. */
export function todoPrompt(todo: Todo): string {
  return `Work on this TODO in ${todo.path} (line ${todo.line}): “${todo.text}”. When it's done, remove the TODO itself.`;
}
