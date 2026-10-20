// The files a Typst file includes, read the way Typst reads it: `#include "…"`
// in markup and `include "…"` in code, as in `#{ include "…" }` or
// `#chapter(include "…")`, but not in comments, strings, raw text or maths.
// Pure; the book's chapter order and the EPUB export use it.

/**
 * An `include "…"` in the text: its path as written, where it is (`start` at
 * the word include, `end` after the path), whether it's in code rather than a
 * `#include` in markup, and whether the text turns heading numbers off around
 * it with `set heading(numbering: none)`, as a book does for its preface.
 */
export type IncludeAt = { spec: string; start: number; end: number; code: boolean; unnumbered: boolean };

// Keywords that start a statement running to the end of the line after a # in markup.
const STATEMENT = new Set(['let', 'set', 'show', 'include', 'import', 'if', 'for', 'while', 'context', 'return']);
const IDENT = /[\p{L}_][\p{L}\p{N}_-]*/uy;

/** The includes in a Typst file, in order. Follows `set heading(numbering: …)` through the blocks it's scoped to. */
export function scanIncludes(text: string): IncludeAt[] {
  const s = text;
  const out: IncludeAt[] = [];
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

  // Markup up to its closing ']' (or the end): returns the index after it.
  const markup = (i: number, close: string, none: boolean): number => {
    while (i < s.length) {
      const c = s[i];
      if (c === close) return i + 1;
      const j = skip(i, false);
      if (j !== i) i = j;
      else if (c === '\\') i += 2;
      else if (c === '[') i = markup(i + 1, ']', none);
      else if (c === '#') ({ end: i, none } = embedded(i + 1, none));
      else i++;
    }
    return i;
  };

  // What follows a # in markup: a block, a statement (#set …, #include …), or a call chain (#chapter(…)[…]).
  const embedded = (i: number, none: boolean): { end: number; none: boolean } => {
    if (s[i] === '{') return { end: code(i + 1, '}', none).end, none };
    if (s[i] === '(') return { end: code(i + 1, ')', none).end, none };
    if (s[i] === '[') return { end: markup(i + 1, ']', none), none };
    const name = word(i);
    if (!name) return { end: i, none };
    if (STATEMENT.has(name)) return code(i, '\n', none, i);
    for (i += name.length; ; ) {
      if (s[i] === '(') i = code(i + 1, ')', none).end;
      else if (s[i] === '[') i = markup(i + 1, ']', none);
      else if (s[i] === '.' && word(i + 1)) i += 1 + word(i + 1)!.length;
      else return { end: i, none };
    }
  };

  // Code up to its closing '}' or ')' (or, for a statement in markup starting at `statement`, the line's end): returns the index after it, and the numbering then.
  const code = (i: number, close: string, none: boolean, statement = -1): { end: number; none: boolean } => {
    while (i < s.length) {
      const c = s[i];
      if (c === close) return { end: close === '\n' ? i : i + 1, none };
      if (close === '\n' && (c === ';' || c === ']' || c === '}' || c === ')')) return { end: c === ';' ? i + 1 : i, none };
      const j = skip(i, true);
      if (j !== i) i = j;
      else if (c === '{') i = code(i + 1, '}', none).end;
      else if (c === '(') i = code(i + 1, ')', none).end;
      else if (c === '[') i = markup(i + 1, ']', none);
      else if (word(i)) {
        const start = i;
        const name = word(i)!;
        i += name.length;
        const included = name === 'include' && /^\s+"([^"\n]+)"/.exec(s.slice(i, i + 1024));
        if (included) {
          i += included[0].length;
          out.push({ spec: included[1], start, end: i, code: start !== statement, unnumbered: none });
        }
        const set = name === 'set' && /^\s+heading\s*\(/.exec(s.slice(i, i + 64));
        if (set) {
          const args = i + set[0].length;
          i = code(args, ')', none).end;
          if (/\bnumbering\s*:\s*none\b/.test(s.slice(args, i - 1))) none = true;
          else if (/\bnumbering\s*:/.test(s.slice(args, i - 1))) none = false;
        }
      } else i++;
    }
    return { end: i, none };
  };

  markup(0, '', false);
  return out;
}
