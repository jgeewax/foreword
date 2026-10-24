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
