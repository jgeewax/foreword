// "@path" in the chat's message box, as in Claude Code: a file or folder of the
// book, named where it fits in what's written ("is @figures/plot.png clear?").
// Typing "@" lists the book's files; picking one writes its path. Each one a
// message names goes with it as an attached file (studio.send), so the
// assistant knows to open it, and a picture goes in the message itself.

import { fuzzyMatch } from '../lib/fuzzy';

/** A file or folder of the book (a folder's path without its last "/"). */
export type BookEntry = { path: string; dir: boolean };

/** The "@…" being typed at the caret; `quoted` when it began @" (a path with spaces). */
export type MentionToken = { from: number; to: number; typed: string; quoted: boolean };

/** What goes before an "@": the start of the box, a space or an opening bracket (not "jo@mail.com"). */
const LEAD = String.raw`(?:^|[\s(\[])`;
const TYPING = new RegExp(`${LEAD}@(?:"([^"\\n]*)|([^\\s"]*))$`);
const MENTION = new RegExp(`${LEAD}@(?:"([^"\\n]+)"|([^\\s"]+))`, 'g');

/** The "@…" at the caret, if the caret is at its end (not in the middle of a word). */
export function mentionToken(text: string, caret = text.length): MentionToken | null {
  const m = TYPING.exec(text.slice(0, caret));
  if (!m || /^\S/.test(text.slice(caret))) return null;
  const quoted = m[1] !== undefined;
  const typed = quoted ? m[1] : m[2];
  return { from: caret - typed.length - (quoted ? 2 : 1), to: caret, typed, quoted };
}

/** Every "@path" in a message, and the path it names: without its quotes, a leading "./" or the stop of the sentence it ends. */
export function mentionsIn(text: string): { from: number; to: number; path: string }[] {
  const out: { from: number; to: number; path: string }[] = [];
  for (const m of text.matchAll(MENTION)) {
    const from = m.index + m[0].indexOf('@');
    let raw = m[1] ?? m[2];
    let to = m.index + m[0].length;
    if (m[2] !== undefined) {
      const trimmed = raw.replace(/[.,;:!?)\]']+$/, '');
      to -= raw.length - trimmed.length;
      raw = trimmed;
    }
    const path = raw.replace(/^\.\//, '');
    if (path) out.push({ from, to, path });
  }
  return out;
}

/** The book's file, or folder, at `path` (a folder may end in "/"), or null: it isn't one. */
export function bookEntry(path: string, files: readonly string[]): BookEntry | null {
  if (!path.endsWith('/') && files.includes(path)) return { path, dir: false };
  const dir = path.replace(/\/+$/, '');
  return dir && files.some((f) => f.startsWith(`${dir}/`)) ? { path: dir, dir: true } : null;
}

/** The book's files and folders a message names, once each. Words that aren't one ("@fig-plot", a Typst label) are just words. */
export function mentionedEntries(text: string, files: readonly string[]): BookEntry[] {
  const out: BookEntry[] = [];
  if (!text.includes('@')) return out;
  for (const { path } of mentionsIn(text)) {
    const entry = bookEntry(path, files);
    if (entry && !out.some((e) => e.path === entry.path)) out.push(entry);
  }
  return out;
}

/** The paths of `files` (those that went with a message) its words name. */
export function mentionedPaths(text: string, files: readonly { path: string }[]): Set<string> {
  const paths = new Set(files.map((f) => f.path));
  return new Set(mentionsIn(text).map((m) => m.path.replace(/\/+$/, '')).filter((p) => paths.has(p)));
}

/** A message's words, cut around its mentions of `files`: a part with a `path` is one. */
export function mentionParts(text: string, files: readonly { path: string }[]): { text: string; path?: string }[] {
  const paths = new Set(files.map((f) => f.path));
  const parts: { text: string; path?: string }[] = [];
  let at = 0;
  for (const m of mentionsIn(text)) {
    const path = m.path.replace(/\/+$/, '');
    if (!paths.has(path)) continue;
    if (m.from > at) parts.push({ text: text.slice(at, m.from) });
    parts.push({ text: text.slice(m.from, m.to), path });
    at = m.to;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

// ---- the list while "@…" is typed ----------------------------------------------------------

/** A row of the list: the matched characters of its path, or of its heading (`inTitle`). */
export type MentionRow = BookEntry & { title?: string; positions: number[]; inTitle: boolean };

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Folders first, then files, by name (chapter 2 before chapter 10). */
const listing = (a: BookEntry, b: BookEntry) => Number(a.dir === false) - Number(b.dir === false) || a.path.localeCompare(b.path, undefined, { numeric: true });

/** The book's files (not Foreword's own), and the folders they're in. */
export function bookEntries(files: readonly string[]): BookEntry[] {
  const book = files.filter((f) => !f.startsWith('.foreword/'));
  const dirs = new Set<string>();
  for (const f of book) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i));
  return [...[...dirs].map((path) => ({ path, dir: true })), ...book.map((path) => ({ path, dir: false }))];
}

/**
 * The list for the "@…" being typed. Nothing yet: the files open (`recent`,
 * the one in front first), then the top of the book. A folder typed up to its
 * "/": what's in it. Else the best matches by path, or by a chapter's heading
 * ("@eigen" finds the chapter called Eigenvalues).
 */
export function mentionMatches(typed: string, files: readonly string[], { recent = [], title = () => undefined }: { recent?: readonly string[]; title?: (path: string) => string | undefined } = {}, max = 40): MentionRow[] {
  const entries = bookEntries(files);
  const row = (e: BookEntry, positions: number[] = [], inTitle = false): MentionRow => ({ ...e, ...(!e.dir && { title: title(e.path) }), positions, inTitle });
  const q = typed.replace(/^\.\//, '');
  if (!q) {
    const open = [...new Set(recent)].filter((p) => entries.some((e) => !e.dir && e.path === p));
    // Hidden files (.foreword.json) only when asked for by name.
    const top = entries.filter((e) => !e.path.includes('/') && !e.path.startsWith('.') && !open.includes(e.path)).sort(listing);
    return [...open.map((path) => row({ path, dir: false })), ...top.map((e) => row(e))].slice(0, max);
  }
  if (q.endsWith('/')) {
    const dir = q.replace(/\/+$/, '');
    const inside = entries.filter((e) => parentOf(e.path) === dir).sort(listing);
    if (inside.length) return inside.slice(0, max).map((e) => row(e));
  }
  const out: (MentionRow & { score: number })[] = [];
  for (const e of entries) {
    const byPath = fuzzyMatch(q, e.dir ? `${e.path}/` : e.path);
    const heading = e.dir ? undefined : title(e.path);
    const byTitle = heading ? fuzzyMatch(q, heading) : null;
    const inTitle = !!byTitle && (!byPath || byTitle.score > byPath.score);
    const best = inTitle ? byTitle : byPath;
    if (!best) continue;
    // Matched only in its folders ("chap" in chapters/two.typ): the folder is what's meant, so it comes first.
    const inFolders = !inTitle && !e.dir && best.positions.length > 0 && best.positions.every((p) => p < parentOf(e.path).length);
    out.push({ ...row(e, best.positions, inTitle), score: best.score + (recent.includes(e.path) ? 1 : 0) - (inFolders ? 4 : 0) });
  }
  return out
    .sort((a, b) => b.score - a.score || listing(a, b))
    .slice(0, max)
    .map(({ score: _, ...r }) => r);
}

/** The message with the "@…" being typed replaced by `entry`'s path, and where the caret goes. A folder keeps the list open, in it. */
export function withMention(text: string, token: MentionToken, entry: BookEntry): { text: string; caret: number } {
  const quote = token.quoted || /\s/.test(entry.path);
  const written = entry.dir ? `@${quote ? '"' : ''}${entry.path}/` : quote ? `@"${entry.path}"` : `@${entry.path}`;
  const after = text.slice(token.to);
  const before = text.slice(0, token.from) + written;
  if (entry.dir) return { text: before + after, caret: before.length };
  // A space after a file, so the next word can follow; past the one there already, if there is.
  if (/^[ \t]/.test(after)) return { text: before + after, caret: before.length + 1 };
  return { text: `${before} ${after}`, caret: before.length + 1 };
}
