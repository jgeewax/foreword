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
