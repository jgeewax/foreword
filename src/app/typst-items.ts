// The statements and expressions in a stretch of Typst, one level deep: in
// markup, the text and each thing a `#` starts (`#set …`, `#{ … }`,
// `#part("…")`); in code, each statement or expression, up to its line's end
// or a `;`. Not a parser: enough of Typst's syntax (brackets, strings,
// comments, raw text, maths) to know where each one starts and ends. Pure; the
// chapter preview uses it to keep a main file's setup and leave out its pages.

/**
 * One statement or expression, or a run of markup's own text.
 * - text: markup's words, headings, labels, comments and maths.
 * - statement: `let`, `set`, `show`, `import`, `include`, `if`, `for`, … (`keyword`).
 * - code, markup: a `{ … }` or `[ … ]` block, `inner` its inside.
 * - call: a name and the calls and fields after it, as `counter(page).update(1)`:
 *   `names` (`counter`, `update`), `args` (each `(…)`, brackets included) and
 *   `bodies` (each `[…]`, inside only).
 * - other: any other expression.
 * In markup, `start` is at its `#`.
 */
export type Item = {
  kind: 'text' | 'statement' | 'code' | 'markup' | 'call' | 'other';
  start: number;
  end: number;
  keyword?: string;
  inner?: Span;
  names?: string[];
  args?: Span[];
  bodies?: Span[];
};

export type Span = { start: number; end: number };

const KEYWORDS = new Set(['let', 'set', 'show', 'import', 'include', 'if', 'for', 'while', 'context', 'return', 'break', 'continue']);
const IDENT = /[\p{L}_][\p{L}\p{N}_-]*/uy;

/** The items between `from` and `to` in `s`, read as markup or as the inside of a code block. */
export function scanItems(s: string, from: number, to: number, mode: 'markup' | 'code'): Item[] {
  return reader(s).items(from, to, mode);
}

/** The index after the bracket that closes the `(`, `[` or `{` at `i` in `s`. */
export function closing(s: string, i: number): number {
  return reader(s).close(i);
}

function reader(s: string) {
  const word = (i: number) => ((IDENT.lastIndex = i), IDENT.exec(s)?.[0] ?? null);
  const until = (i: number, end: string) => ((i = s.indexOf(end, i)) < 0 ? s.length : i);

  // Past a comment, raw text, maths, or (in code) a string at i; i itself if there's none.
  const skip = (i: number, code: boolean): number => {
    const [c, d] = [s[i], s[i + 1]];
    if (c === '/' && d === '*') return until(i + 2, '*/') + 2;
    // In markup, the // of a link (https://…) isn't a comment.
    if (c === '/' && d === '/' && (code || s[i - 1] !== ':')) return until(i, '\n');
    if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      return n === 2 ? i + 2 : until(i + n, '`'.repeat(n)) + n;
    }
    if (c === '$' || (code && c === '"')) {
      let j = i + 1;
      while (j < s.length && s[j] !== c && !(c === '"' && s[j] === '\n')) j += s[j] === '\\' ? 2 : 1;
      return j + 1;
    }
    return i;
  };

  // Markup up to its closing `close`: the index after it.
  const markup = (i: number, close: string): number => {
    while (i < s.length) {
      const c = s[i];
      if (c === close) return i + 1;
      const j = skip(i, false);
      if (j !== i) i = j;
      else if (c === '\\') i += 2;
      else if (c === '[') i = markup(i + 1, ']');
      else if (c === '#') i = Math.max(expression(i, i + 1, true).end, i + 1);
      else i++;
    }
    return i;
  };

  // Code up to its closing `close`: the index after it.
  const code = (i: number, close: string): number => {
    while (i < s.length) {
      const c = s[i];
      if (c === close) return i + 1;
      const j = skip(i, true);
      if (j !== i) i = j;
      else if (c === '{') i = code(i + 1, '}');
      else if (c === '(') i = code(i + 1, ')');
      else if (c === '[') i = markup(i + 1, ']');
      else i++;
    }
    return i;
  };

  // Where a statement or expression from i ends: at its line's end (in code, an
  // `else` on the next line goes on), a `;` (in markup, after it), or the
  // bracket around it.
  const endOf = (i: number, inMarkup: boolean): number => {
    while (i < s.length) {
      const c = s[i];
      if (c === '\n') {
        const more = inMarkup ? null : /^\s*else\b/.exec(s.slice(i, i + 64));
        if (!more) return i;
        i += more[0].length;
      } else if (c === ';') return inMarkup ? i + 1 : i;
      else if (c === '}' || c === ')' || c === ']') return i;
      else {
        const j = skip(i, true);
        if (j !== i) i = j;
        else if (c === '{') i = code(i + 1, '}');
        else if (c === '(') i = code(i + 1, ')');
        else if (c === '[') i = markup(i + 1, ']');
        else i++;
      }
    }
    return i;
  };

  const close = (i: number): number => (s[i] === '[' ? markup(i + 1, ']') : code(i + 1, s[i] === '(' ? ')' : '}'));
  // The inside of the brackets from `open` to `end` (after the closing one, if it's there).
  const inside = (open: number, end: number): Span => ({ start: open + 1, end: end > open + 1 && ')]}'.includes(s[end - 1]) ? end - 1 : end });

  // A name and the calls and fields after it.
  const chain = (start: number, i: number): Item => {
    const names = [word(i)!];
    const args: Span[] = [];
    const bodies: Span[] = [];
    for (i += names[0].length; ; ) {
      const field = s[i] === '.' ? word(i + 1) : null;
      if (s[i] === '(' || s[i] === '[') {
        const end = close(i);
        if (s[i] === '(') args.push({ start: i, end });
        else bodies.push(inside(i, end));
        i = end;
      } else if (field) {
        names.push(field);
        i += 1 + field.length;
      } else return { kind: 'call', start, end: i, names, args, bodies };
    }
  };

  // An expression from i (its `#` at `start`, in markup).
  const expression = (start: number, i: number, inMarkup: boolean): Item => {
    const c = s[i];
    if (c === '{' || c === '[') {
      const end = close(i);
      return { kind: c === '{' ? 'code' : 'markup', start, end, inner: inside(i, end) };
    }
    const name = word(i);
    const path = name === 'include' && /^\s+"[^"\n]*"/.exec(s.slice(i + 7, i + 1031));
    if (path) return { kind: 'statement', keyword: 'include', start, end: i + 7 + path[0].length };
    if (name && KEYWORDS.has(name)) return { kind: 'statement', keyword: name, start, end: endOf(i, inMarkup) };
    if (name) {
      const call = chain(start, i);
      if (inMarkup) return call;
      // In code, a call is the whole expression or it's part of another (`a.b() + 1`).
      const end = endOf(call.end, false);
      return /^\s*$/.test(s.slice(call.end, end).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')) ? call : { kind: 'other', start, end };
    }
    if (inMarkup) return { kind: 'other', start, end: c === '(' ? close(i) : skip(i, true) };
    return { kind: 'other', start, end: endOf(i, false) };
  };

  const items = (from: number, to: number, mode: 'markup' | 'code'): Item[] => {
    const out: Item[] = [];
    const add = (item: Item) => {
      item.end = Math.min(Math.max(item.end, item.start + 1), to);
      out.push(item);
      return item.end;
    };
    let i = from;
    if (mode === 'code') {
      while (i < to) {
        const j = s[i] === '/' ? skip(i, true) : i;
        if (j !== i) i = j;
        else if (/[\s;]/.test(s[i])) i++;
        else i = add(expression(i, i, false));
      }
      return out;
    }
    let text = -1;
    while (i < to) {
      const c = s[i];
      if (c === '#' && (word(i + 1) || '{[("'.includes(s[i + 1] ?? ' '))) {
        if (text >= 0) out.push({ kind: 'text', start: text, end: i });
        text = -1;
        i = add(expression(i, i + 1, true));
        continue;
      }
      if (text < 0) text = i;
      const j = skip(i, false);
      if (j !== i) i = j;
      else if (c === '\\') i += 2;
      else if (c === '[') i = markup(i + 1, ']');
      else i++;
    }
    if (text >= 0 && to > text) out.push({ kind: 'text', start: text, end: to });
    return out;
  };

  return { items, close };
}
