// Three-way merge (diff3): a file the author and another program (an
// assistant, git, another editor) both changed since `base`, the text they
// started from. Each side's changes to `base` are combined; where both changed
// the same lines they're compared word by word (a Typst paragraph is one
// line, so two edits in one paragraph are usually still apart), and only words
// both changed differently conflict. A conflict keeps the author's ("mine").
import { proseTokens } from '../app/prose-diff';
import { diff } from '../lib/diff';
import { smallEdits, type OffsetEdit } from './text-edit';

/** A passage both sides changed differently, in the merged text (which has mine there). */
export type Conflict = {
  start: number;
  end: number;
  /** The passage in the merged text: mine, with their changes where they don't collide. */
  mine: string;
  /** The same passage with theirs where they collide. */
  theirs: string;
};

/** What happened to one changed passage, at its place in the merged text (`theirs`: their version of it, unchanged where only mine changed it). */
export type Region = Conflict & {
  /** Only mine changed it; only theirs; both alike (or apart, word by word); both differently. */
  kind: 'mine' | 'theirs' | 'both' | 'conflict';
};

export type MergeResult = {
  text: string;
  conflicts: Conflict[];
  /** Every passage either side changed, in order. */
  regions: Region[];
};

/** Past this many changed lines (or words, in one passage) a diff stops looking for the smallest edits (see lib/diff.ts). */
const MAX_LINE_EDITS = 2000;
const MAX_WORD_EDITS = 1000;

/** One side's change: base items [a0, a1) became that side's [b0, b1). */
type Hunk = { side: 0 | 1; a0: number; a1: number; b0: number; b1: number };

/** A stretch of the merge: base items and each side's items for them. */
type Chunk = { kind: 'same' | Region['kind']; base: string[]; sides: [string[], string[]] };

function hunksOf(base: readonly string[], other: readonly string[], side: 0 | 1, maxEdits: number): Hunk[] {
  const runs = diff(base, other, Object.is, maxEdits);
  const out: Hunk[] = [];
  for (let i = 0; i < runs.length; ) {
    if (runs[i].type === 'equal') {
      i++;
      continue;
    }
    const { a: a0, b: b0 } = runs[i];
    while (i < runs.length && runs[i].type !== 'equal') i++;
    out.push({ side, a0, b0, a1: runs[i]?.a ?? base.length, b1: runs[i]?.b ?? other.length });
  }
  return out;
}

/**
 * Whether two changes, one from each side, touch the same base items. Changes
 * that only meet end to end don't: each side's items stay in order. An insertion
 * meets a change around it, or another insertion at the same place (which goes
 * first can't be told).
 */
function overlaps(x: Hunk, y: Hunk) {
  const xIns = x.a0 === x.a1;
  const yIns = y.a0 === y.a1;
  if (xIns && yIns) return x.a0 === y.a0;
  if (xIns) return y.a0 < x.a0 && x.a0 < y.a1;
  if (yIns) return x.a0 < y.a0 && y.a0 < x.a1;
  return x.a0 < y.a1 && y.a0 < x.a1;
}

/** One side's items for base [s, e), with its changes in the cluster applied. */
function sideItems(base: readonly string[], items: readonly string[], cluster: Hunk[], side: 0 | 1, s: number, e: number): string[] {
  const out: string[] = [];
  let pos = s;
  for (const h of cluster) {
    if (h.side !== side) continue;
    out.push(...base.slice(pos, h.a0), ...items.slice(h.b0, h.b1));
    pos = h.a1;
  }
  out.push(...base.slice(pos, e));
  return out;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The merge as chunks: unchanged base between the changed stretches, each with both sides' items. */
function chunks(base: readonly string[], mine: readonly string[], theirs: readonly string[], maxEdits: number): Chunk[] {
  const hunks = [...hunksOf(base, mine, 0, maxEdits), ...hunksOf(base, theirs, 1, maxEdits)].sort((x, y) => x.a0 - y.a0 || x.a1 - y.a1);
  const clusters: Hunk[][] = [];
  for (const h of hunks) {
    const last = clusters[clusters.length - 1];
    if (last && last.some((x) => x.side !== h.side && overlaps(x, h))) last.push(h);
    else clusters.push([h]);
  }
  const out: Chunk[] = [];
  let pos = 0;
  for (const cluster of clusters) {
    const s = Math.min(...cluster.map((h) => h.a0));
    const e = Math.max(...cluster.map((h) => h.a1));
    if (s > pos) out.push({ kind: 'same', base: base.slice(pos, s), sides: [base.slice(pos, s), base.slice(pos, s)] });
    const m = sideItems(base, mine, cluster, 0, s, e);
    const t = sideItems(base, theirs, cluster, 1, s, e);
    const sides = cluster.map((h) => h.side);
    const kind = !sides.includes(1) ? 'mine' : !sides.includes(0) ? 'theirs' : same(m, t) ? 'both' : 'conflict';
    out.push({ kind, base: base.slice(s, e), sides: [m, t] });
    pos = Math.max(pos, e);
  }
  if (pos < base.length) out.push({ kind: 'same', base: base.slice(pos), sides: [base.slice(pos), base.slice(pos)] });
  return out;
}

/** Lines with their line breaks, so joining them gives back the text exactly. */
const lines = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** A passage both changed: merged word by word. `clash` when words collide (`mine` keeps mine there, `theirs` theirs). */
function mergeWords(base: string, mine: string, theirs: string): { mine: string; theirs: string; clash: boolean } {
  let m = '';
  let t = '';
  let clash = false;
  for (const c of chunks(proseTokens(base), proseTokens(mine), proseTokens(theirs), MAX_WORD_EDITS)) {
    if (c.kind === 'conflict') clash = true;
    const picked = c.kind === 'theirs' ? c.sides[1].join('') : c.kind === 'same' ? c.base.join('') : null;
    m += picked ?? c.sides[0].join('');
    t += picked ?? (c.kind === 'conflict' ? c.sides[1] : c.sides[0]).join('');
  }
  return { mine: m, theirs: t, clash };
}

/**
 * Merge `mine` and `theirs`, both changed from `base`. The text has every change
 * from both; where they collide it has mine, and the conflict says what theirs was.
 */
export function merge3(base: string, mine: string, theirs: string): MergeResult {
  if (mine === base && theirs === base) return { text: base, conflicts: [], regions: [] };
  let text = '';
  const regions: Region[] = [];
  for (const c of chunks(lines(base), lines(mine), lines(theirs), MAX_LINE_EDITS)) {
    if (c.kind === 'same') {
      text += c.base.join('');
      continue;
    }
    let kind = c.kind;
    let m = c.sides[kind === 'theirs' ? 1 : 0].join('');
    let t = kind === 'conflict' || kind === 'mine' ? c.sides[1].join('') : m;
    if (kind === 'conflict') {
      const words = mergeWords(c.base.join(''), m, c.sides[1].join(''));
      ({ mine: m, theirs: t } = words);
      if (!words.clash) kind = 'both';
    }
    regions.push({ kind, start: text.length, end: text.length + m.length, mine: m, theirs: t });
    text += m;
  }
  return { text, conflicts: regions.filter((r) => r.kind === 'conflict').map(({ start, end, mine: m, theirs: t }) => ({ start, end, mine: m, theirs: t })), regions };
}

/** Whether `theirs` already has every change `mine` made to `base` (so it was made from mine, or the same). */
export function includes(base: string, mine: string, theirs: string): boolean {
  if (mine === base) return true;
  const r = merge3(base, mine, theirs);
  return !r.conflicts.length && r.text === theirs;
}

/** A passage to ask the author about: both changed it ('clash'), or the new text didn't have a change they had saved ('kept'). */
export type Question = Conflict & { kind: 'clash' | 'kept' };

export type Reconciled = {
  /** The buffer's new text: the author's, with the other program's changes merged in. */
  text: string;
  questions: Question[];
  /** What to write back to disk: the new text with the author's saved changes it lacked; null when it has them all. */
  repair: string | null;
};

/** Where an offset in a text lands after `edits` (in order, not overlapping); `end` keeps an insertion at it outside. */
function mapOffset(edits: OffsetEdit[], pos: number, end: boolean) {
  let delta = 0;
  for (const e of edits) {
    if (e.start > pos || (e.start === pos && (end || e.end > pos))) break;
    if (e.end > pos) return e.start + delta + (end ? e.text.length : 0);
    delta += e.text.length - (e.end - e.start);
  }
  return pos + delta;
}

/**
 * A file changed on disk while open: merge `incoming` into the buffer. `disk`
 * is what was last read or written there; `seen` what the other program may
 * last have read, which is older when the author saved since (an assistant at
 * work in the file didn't see that save).
 *
 * New text made from what was on disk merges as usual. New text made from an
 * older copy lacks the author's saved changes: merged against that copy, they
 * stay, and `repair` puts them back on disk, where a save must stay.
 */
export function reconcile({ seen, disk, buffer, incoming }: { seen: string; disk: string; buffer: string; incoming: string }): Reconciled {
  if (includes(seen, disk, incoming)) {
    const r = merge3(disk, buffer, incoming);
    return { text: r.text, questions: r.conflicts.map((c) => ({ ...c, kind: 'clash' })), repair: null };
  }
  const saved = merge3(seen, disk, incoming);
  const repair = saved.text;
  const r = merge3(disk, buffer, repair);
  const questions: Question[] = r.conflicts.map((c) => ({ ...c, kind: 'clash' }));
  const edits = smallEdits(repair, r.text);
  for (const g of saved.regions) {
    if (g.kind !== 'conflict' && g.kind !== 'mine') continue;
    const start = mapOffset(edits, g.start, false);
    const end = Math.max(start, mapOffset(edits, g.end, true));
    if (questions.some((q) => q.start < end && start < q.end)) continue;
    questions.push({ kind: g.kind === 'mine' ? 'kept' : 'clash', start, end, mine: r.text.slice(start, end), theirs: g.theirs });
  }
  questions.sort((a, b) => a.start - b.start);
  return { text: r.text, questions, repair: repair === incoming ? null : repair };
}
