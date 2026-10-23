// The places in the book an assistant's reply points to, so the chat can make
// them links to that place in the editor: `chapters/one.typ:42`, `one.typ:42-48`,
// `one.typ#L42`, "one.typ, line 42", "one.typ (lines 42–48)", "lines 3–5 of
// one.typ", or a Markdown link to a file. Only the book's own files count: a
// name is looked up among them (from the book's folder, as a whole path, or by
// the end of its path when that ends one file's path only), so a time or a
// version number is never taken for one. In prose, only a name with a line is
// a link; a name alone is one in `code` or a Markdown link.

import type { Block, Inline } from './markdown';
import { tildePath } from './paths';

export type SourceRef = { path: string; line?: number; column?: number; endLine?: number };

/** The book's files by every name a reply may give them (null: more than one file ends so). */
export type BookFiles = { names: Map<string, string | null>; roots: string[] };

export function bookFiles(files: string[], root: string | null): BookFiles {
  const names = new Map<string, string | null>();
  const own = new Set(files);
  for (const f of files) names.set(f, f);
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      const end = parts.slice(i).join('/');
      if (own.has(end)) continue; // a file's own path is always that file
      names.set(end, names.has(end) && names.get(end) !== f ? null : f);
    }
  }
  const roots = root ? [...new Set([root, tildePath(root)])].map((r) => `${r.replace(/\/+$/, '')}/`) : [];
  return { names, roots };
}

const RANGE = String.raw`(?:\s?[-–—]\s?L?|\s(?:to|through)\s)`;
/**
 * A line after a file's name: :42, :42:7, :42-48 | #L42, #L42C7, #L42-L48 |
 * ", line 42", " at line 42", " lines 42 to 48" | " (line 42)", " (lines 42–48)".
 */
const SUFFIX = String.raw`(?::(\d+)(?::(\d+))?(?:${RANGE}(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?(\d+))?|(?:,|\s(?:at|on|in))?\s[Ll]ines?\s(\d+)(?:${RANGE}(\d+))?|\s\([Ll]ines?\s(\d+)(?:${RANGE}(\d+))?\))`;
/** A line before it: "line 42 of ", "lines 42–48 in ". */
const PREFIX = String.raw`\b[Ll]ines?\s(\d+)(?:${RANGE}(\d+))?\s(?:of|in)\s`;

const suffixes = () => new RegExp(SUFFIX, 'g');
const prefixes = () => new RegExp(PREFIX, 'g');
const SUFFIX_START = new RegExp(`^${SUFFIX}`);
const SUFFIX_END = new RegExp(`${SUFFIX}$`);
const PREFIX_END = new RegExp(`${PREFIX}$`);
/** What a path is made of, so a name can't start or end in the middle of one. */
const PATHISH = /[\p{L}\p{N}_.~/\\-]/u;
const NAMEISH = /[\p{L}\p{N}_/-]/u;
/** How far a name may run (a whole path from the book's folder can be long). */
const REACH = 400;

type Lines = Pick<SourceRef, 'line' | 'column' | 'endLine'>;

function suffixLines(m: RegExpExecArray): Lines {
  return lines(m[1] ?? m[4] ?? m[7] ?? m[9], m[2] ?? m[5], m[3] ?? m[6] ?? m[8] ?? m[10]);
}

function lines(line: string, column?: string, end?: string): Lines {
  const n = Number(line);
  const out: Lines = { line: Math.max(1, n) };
  if (column && Number(column) >= 1) out.column = Number(column);
  if (end && Number(end) > n) out.endLine = Number(end);
  return out;
}

/** The book file a name is, as written in a reply (from the book's folder, its whole path, ./…). */
function fileNamed(book: BookFiles, written: string): string | null {
  let name = written.replace(/^\.\//, '');
  const root = book.roots.find((r) => name.startsWith(r));
  if (root) name = name.slice(root.length);
  return book.names.get(name) ?? null;
}

/** A whole name, as in `code` or a link's address: a file, or a place in one. */
export function refNamed(book: BookFiles, written: string): SourceRef | null {
  let s = written.trim();
  if (s.startsWith('file://')) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
    } catch {
      return null;
    }
  } else if (/%[0-9a-f]{2}/i.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {}
  }
  const path = fileNamed(book, s);
  if (path) return { path };
  const m = SUFFIX_END.exec(s);
  const at = m && fileNamed(book, s.slice(0, m.index));
  return at ? { path: at, ...suffixLines(m) } : null;
}

type Found = { start: number; end: number; to: SourceRef };

/** A line of a reply's text, with the places it points to taken out. */
export function splitRefs(book: BookFiles, text: string): (string | { text: string; to: SourceRef })[] {
  const found: Found[] = [];
  // A name, then its line: the longest name that ends where the line starts.
  for (const m of text.matchAll(suffixes())) {
    const end = m.index;
    for (let start = Math.max(0, end - REACH); start < end; start++) {
      if (start > 0 && PATHISH.test(text[start - 1])) continue;
      const path = fileNamed(book, text.slice(start, end));
      if (path) {
        found.push({ start, end: end + m[0].length, to: { path, ...suffixLines(m) } });
        break;
      }
    }
  }
  // A line, then its name: the longest name that starts where the line ends.
  for (const m of text.matchAll(prefixes())) {
    const start = m.index + m[0].length;
    for (let end = Math.min(text.length, start + REACH); end > start; end--) {
      if (end < text.length && (NAMEISH.test(text[end]) || (text[end] === '.' && /[\p{L}\p{N}]/u.test(text[end + 1] ?? '')))) continue;
      const path = fileNamed(book, text.slice(start, end));
      if (path) {
        found.push({ start: m.index, end, to: { path, ...lines(m[1], undefined, m[2]) } });
        break;
      }
    }
  }
  found.sort((a, b) => a.start - b.start);
  const out: (string | { text: string; to: SourceRef })[] = [];
  let at = 0;
  for (const f of found) {
    if (f.start < at) continue;
    if (f.start > at) out.push(text.slice(at, f.start));
    out.push({ text: text.slice(f.start, f.end), to: f.to });
    at = f.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A reply's inline Markdown with the places it points to as links ("ref"). */
export function linkInlines(nodes: Inline[], book: BookFiles): Inline[] {
  const out: Inline[] = [];
  nodes.forEach((n, k) => {
    switch (n.t) {
      case 'text':
        for (const p of splitRefs(book, n.v)) out.push(typeof p === 'string' ? { t: 'text', v: p } : { t: 'ref', c: [{ t: 'text', v: p.text }], to: p.to });
        return;
      case 'strong':
      case 'em':
        out.push({ ...n, c: linkInlines(n.c, book) });
        return;
      case 'code': {
        const to = refNamed(book, n.v);
        if (!to) break;
        // `one.typ` (line 42), line 42 of `one.typ`: the line is in the words around it.
        const next = nodes[k + 1];
        const prev = nodes[k - 1];
        const after = !to.line && next?.t === 'text' ? SUFFIX_START.exec(next.v) : null;
        const before = !to.line && !after && prev?.t === 'text' ? PREFIX_END.exec(prev.v) : null;
        out.push({ t: 'ref', c: [n], to: after ? { ...to, ...suffixLines(after) } : before ? { ...to, ...lines(before[1], undefined, before[2]) } : to });
        return;
      }
      case 'link': {
        const to = refNamed(book, n.href);
        if (!to) break;
        out.push({ t: 'ref', c: n.c, to });
        return;
      }
    }
    out.push(n);
  });
  return out;
}

/** A reply's Markdown with the places it points to as links (not in code blocks). */
export function linkBlocks(blocks: Block[], book: BookFiles): Block[] {
  const link = (c: Inline[]) => linkInlines(c, book);
  return blocks.map((b) => {
    switch (b.t) {
      case 'heading':
      case 'para':
      case 'quote':
        return { ...b, c: link(b.c) };
      case 'list':
        return { ...b, items: b.items.map(link) };
      case 'table':
        return { ...b, head: b.head.map(link), rows: b.rows.map((r) => r.map(link)) };
      default:
        return b;
    }
  });
}

/** What a link to a place says it does. */
export function refTitle(to: SourceRef): string {
  if (!to.line) return `Open ${to.path}`;
  return `Go to ${to.path}, ${to.endLine ? `lines ${to.line}–${to.endLine}` : `line ${to.line}`}`;
}
