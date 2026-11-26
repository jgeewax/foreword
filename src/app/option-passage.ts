// The passage an Options reply is about, found again when an option is picked
// (studio.ts applyOption). It's followed through edits by two decorations in
// its file's model, so typing elsewhere, moving the cursor or selecting
// something else doesn't move it; this says whether what it holds now is still
// safe to swap out: the passage as it was asked about, or an option put in it
// (the assistant's words, not the author's). Offsets are into the whole buffer.
import { wordPieces } from './prose-diff';

/** Where the passage is now, and whether an option can go in without losing the author's work. */
export type PassageAt =
  /** It holds the passage as asked about, or an option put in it: safe to replace. */
  | { kind: 'ours'; start: number; end: number }
  /** The author has changed it since: replacing it would lose what they wrote. */
  | { kind: 'changed'; start: number; end: number; now: string }
  /** Deleted since: nothing's left of it but its place. */
  | { kind: 'deleted'; at: number }
  /** Not followed (its file was closed meanwhile) and its words aren't in the file just once. */
  | { kind: 'lost' };

export type Span = { start: number; end: number };

/**
 * Where the passage is in `doc`. `tracked`: its two decorations' ranges, or
 * null when it isn't followed any more. `outer` grows with typing at its
 * edges, so it takes in every change to the passage, and holds it exactly
 * after an undo or anything else that swaps it whole; `inner` never grows, so
 * it holds the passage when the author writes right beside it. (Neither alone
 * will do: an edit at the passage's end leaves the end of what's typed outside
 * `inner`, and an undo leaves `inner` over only part of what comes back.)
 * `ours`: what it may hold, the latest first: the option in use, the others put
 * in before, the passage as asked about. `hint`: where it was last seen, for
 * when it isn't followed.
 */
export function locatePassage(doc: string, tracked: { outer: Span; inner: Span } | null, ours: readonly string[], hint: number | null): PassageAt {
  const texts = [...new Set(ours)];
  if (tracked) {
    for (const r of [tracked.outer, tracked.inner]) if (texts.includes(doc.slice(r.start, r.end))) return { kind: 'ours', ...r };
    const { start, end } = tracked.outer;
    const now = doc.slice(start, end);
    return now ? { kind: 'changed', start, end, now } : { kind: 'deleted', at: start };
  }
  // Found by its words: where it was last seen, or the only place they are. A bare insertion point has none.
  for (const t of texts) {
    if (!t) continue;
    if (hint != null && doc.startsWith(t, hint)) return { kind: 'ours', start: hint, end: hint + t.length };
    const first = doc.indexOf(t);
    if (first >= 0 && doc.indexOf(t, first + 1) < 0) return { kind: 'ours', start: first, end: first + t.length };
  }
  return { kind: 'lost' };
}

/** How far from the line a reply names its words may be, when they're in the file more than once (it counts loosely). */
const NEAR = 60;

/** 1-based line of `offset` in `doc`. */
const lineAt = (doc: string, offset: number) => {
  let n = 1;
  for (let i = doc.indexOf('\n'); i >= 0 && i < offset; i = doc.indexOf('\n', i + 1)) n++;
  return n;
};

/** Of the places `found`, the one place there is, or the one nearest `line` (and nearer than any other). */
function pick(doc: string, found: Span[], line: number | null): Span | null {
  if (found.length === 1) return found[0];
  if (!found.length || line == null) return null;
  const near = found.map((s) => ({ s, d: Math.abs(lineAt(doc, s.start) - line) })).sort((a, b) => a.d - b.d);
  return near[0].d <= NEAR && near[1].d > near[0].d ? near[0].s : null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where the passage an Options reply names is in `doc` (its file as it is
 * now), from its words (`find`) and the line it gives (`line`, null if none):
 * the one place the words are, or the one nearest that line. Tried as written,
 * then without blank space at its ends, without quotes around it, and last
 * with its spaces, line breaks and quote marks matched loosely (an assistant
 * retypes them). Null if they aren't there, or are in more than one place and
 * none is the nearest.
 */
export function findPassage(doc: string, find: string, line: number | null): Span | null {
  const trimmed = find.trim();
  if (!trimmed) return null;
  const unquoted = trimmed.replace(/^["“'`](.*)["”'`]$/s, '$1');
  for (const words of new Set([find, trimmed, unquoted])) {
    const found: Span[] = [];
    for (let at = doc.indexOf(words); at >= 0; at = doc.indexOf(words, at + 1)) found.push({ start: at, end: at + words.length });
    const hit = pick(doc, found, line);
    if (hit) return hit;
    if (found.length) return null;
  }
  const loose = unquoted
    .trim()
    .split(/\s+/)
    .map((w) => escape(w).replace(/['‘’]/g, "['‘’]").replace(/["“”]/g, '["“”]'))
    .join('\\s+');
  const found = [...doc.matchAll(new RegExp(loose, 'g'))].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  return pick(doc, found, line);
}

/** How many lines a reply's place may be off the selection's and still mean it (it's given the selection's lines, but may count loosely). */
const SLACK = 3;

/**
 * Whether the place a reply names (`at`: its file, and its lines if it gives
 * them) is somewhere other than the passage it was asked about (`asked`):
 * another file, or lines clear of it. Then options whose words aren't found
 * there are about that place, not the selection, and mustn't go over it.
 */
export function namesElsewhere(at: { path: string; line?: number; endLine?: number }, asked: { path: string; start: { line: number }; end: { line: number } }): boolean {
  if (at.path !== asked.path) return true;
  if (at.line == null) return false;
  return (at.endLine ?? at.line) < asked.start.line - SLACK || at.line > asked.end.line + SLACK;
}

/**
 * An option as it goes in. In place of a passage, as written. In at the start
 * of a line with nothing replaced (a reply's `at: file:503:1`), as lines of
 * its own: ended with a line break if it isn't, so it doesn't run into the
 * line it goes before, or close up the blank line between two paragraphs.
 */
export function optionText(text: string, asked: { text: string; start: { column: number } }): string {
  return !asked.text && asked.start.column === 1 && text && !text.endsWith('\n') ? `${text}\n` : text;
}

/** Which of ours the author's version comes from (the fewest characters changed): what the card shows them changing. */
export function closestOurs(now: string, ours: readonly string[]): string {
  let best = ours[0] ?? '';
  let cost = Infinity;
  for (const t of new Set(ours)) {
    const c = wordPieces(t, now).reduce((n, p) => n + (p.kind === 'same' ? 0 : p.text.length), 0);
    if (c < cost) [best, cost] = [t, c];
  }
  return best;
}
