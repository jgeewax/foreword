// Labels and the references to them in Typst text: `<intro>` put on a heading,
// an equation or a figure, and `@intro` (or `#ref(<intro>)`) pointing at it.
// Pure; the chapter preview and Go to Definition (⌘-click) use them.

const NAME = /[\p{L}_][\p{L}\p{N}_:.-]*/u.source;

// A label, and what's before it when it's written as an argument (`#ref(<x>, form: "page")`, `link(<x>)`):
// then it refers to the label instead. (Not a lookbehind: WebKit takes 150 times as long with one.)
const LABEL = new RegExp(`([(,:]\\s*)?<(${NAME})>`, 'gu');

// `@name` (Typst leaves a final "." or ":" out of it), or a label given to a call.
const REFERENCE = new RegExp(`(?<!\\\\)@(${NAME})|(?<=[(,:]\\s*)<(${NAME})>`, 'gu');

/**
 * Text with comments, raw blocks and maths blanked, where nothing is a heading
 * or a label (an equation's lines often start with "="). Blanks keep the
 * length and the line breaks, so a place in it is the same place in the text.
 */
export function prose(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  const s = text
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_, before: string, comment: string) => before + blank(comment));
  let out = '';
  let math = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] !== undefined && s[i + 1] !== '\n') {
      out += math ? '  ' : c + s[i + 1];
      i++;
    } else if (c === '`' && !math) {
      // Inline raw text, which may hold a "$".
      const end = s.indexOf('`', i + 1);
      const raw = end < 0 ? '' : s.slice(i, end + 1);
      if (raw && !raw.includes('\n')) {
        out += raw;
        i = end;
      } else out += c;
    } else if (c === '$') {
      math = !math;
      out += ' ';
    } else out += math && c !== '\n' ? ' ' : c;
  }
  return out;
}

/**
 * The reference that a place on a line (0-based, between characters, as the
 * pointer is) is in or at the edge of: `@name` (without its `[supplement]`),
 * or `<name>` given to a call (`#ref(<name>)`). Its label's name, and where it
 * starts and ends, `@` and brackets included. Null outside one.
 */
export function referenceAt(line: string, at: number): { name: string; start: number; end: number } | null {
  for (const m of line.matchAll(REFERENCE)) {
    if (m.index > at) break;
    const name = m[1] ? m[1].replace(/[.:]+$/, '') : m[2];
    const end = m[1] ? m.index + 1 + name.length : m.index + m[0].length;
    if (name && at <= end) return { name, start: m.index, end };
  }
  return null;
}

/** The labels a text (as `prose` gives it) puts on things: each one's name, and the offsets of its `<…>`. */
export function labelsPut(s: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  for (const m of s.matchAll(LABEL)) if (m[1] === undefined) out.push({ name: m[2], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Where a text puts the label `name` on something: the offsets of its `<…>`. Comments, raw blocks and maths aside. */
export function labelPlaces(text: string, name: string): { start: number; end: number }[] {
  if (!text.includes(`<${name}>`)) return [];
  return labelsPut(prose(text))
    .filter((l) => l.name === name)
    .map(({ start, end }) => ({ start, end }));
}
