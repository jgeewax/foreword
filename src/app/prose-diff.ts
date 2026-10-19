// What changed between two versions of a file, for reading rather than
// patching: paragraphs (lines) that changed, with the changed words marked,
// a line of context around them, and word counts. Built on src/lib/diff.ts.
import { diff, splitLines } from '../lib/diff';

export type Piece = { kind: 'same' | 'add' | 'del'; text: string };

export type Hunk = {
  /** 1-based line in the newer text where the change starts (where it would be, for a deletion). */
  line: number;
  /** 1-based line in the older text. */
  oldLine: number;
  /** Unchanged lines just before the change. */
  before: string[];
  /** The changed passage, word by word (newlines inside are part of the text). */
  pieces: Piece[];
  /** Unchanged lines just after. */
  after: string[];
};

export type ProseDiff = { hunks: Hunk[]; added: number; removed: number };

const TOKEN = /\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu;
const WORD = /[\p{L}\p{N}]/u;
/** Passages longer than this (in tokens) are shown as replaced, not diffed word by word. */
const MAX_TOKENS = 6000;

export const countWords = (text: string) => (text.match(TOKEN) ?? []).filter((t) => WORD.test(t)).length;

/** A text as words, runs of space and single marks: joined, they give it back exactly. */
export const proseTokens = (text: string) => text.match(TOKEN) ?? [];

/** Word-level pieces for one changed passage, with each run of changes shown as one deletion then one insertion. */
export function wordPieces(oldText: string, newText: string): Piece[] {
  const a = oldText.match(TOKEN) ?? [];
  const b = newText.match(TOKEN) ?? [];
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return clean([{ kind: 'del', text: oldText }, { kind: 'add', text: newText }]);
  const raw: Piece[] = diff(a, b).map((r) => ({
    kind: r.type === 'equal' ? 'same' : r.type === 'delete' ? 'del' : 'add',
    text: (r.type === 'insert' ? b.slice(r.b, r.b + r.n) : a.slice(r.a, r.a + r.n)).join(''),
  }));
  // A lone space or punctuation mark between two changes reads better as part of them.
  for (let i = 1; i < raw.length - 1; i++) {
    const p = raw[i];
    if (p.kind === 'same' && raw[i - 1].kind !== 'same' && raw[i + 1].kind !== 'same' && !WORD.test(p.text) && p.text.length <= 2) {
      raw.splice(i, 1, { kind: 'del', text: p.text }, { kind: 'add', text: p.text });
      i++;
    }
  }
  return clean(raw);
}

/** Merge each cluster of changes into one del + one add, and drop empty pieces. */
function clean(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  let del = '';
  let add = '';
  const flush = () => {
    if (del) out.push({ kind: 'del', text: del });
    if (add) out.push({ kind: 'add', text: add });
    del = add = '';
  };
  for (const p of pieces) {
    if (p.kind === 'del') del += p.text;
    else if (p.kind === 'add') add += p.text;
    else if (p.text) {
      flush();
      const last = out[out.length - 1];
      if (last?.kind === 'same') last.text += p.text;
      else out.push({ ...p });
    }
  }
  flush();
  return out;
}

/** The changes from `before` to `after` (null = the file didn't exist). */
export function proseDiff(before: string | null, after: string | null, context = 1): ProseDiff {
  const a = splitLines(before ?? '');
  const b = splitLines(after ?? '');
  const runs = diff(a, b);
  // Changed blocks: consecutive non-equal runs.
  type Block = { a0: number; a1: number; b0: number; b1: number };
  const blocks: Block[] = [];
  for (const r of runs) {
    if (r.type === 'equal') continue;
    const last = blocks[blocks.length - 1];
    const a1 = r.a + (r.type === 'delete' ? r.n : 0);
    const b1 = r.b + (r.type === 'insert' ? r.n : 0);
    if (last && last.a1 === r.a && last.b1 === r.b) {
      last.a1 = a1;
      last.b1 = b1;
    } else blocks.push({ a0: r.a, a1, b0: r.b, b1 });
  }
  // Blocks close together share their context: one hunk.
  const groups: Block[][] = [];
  for (const blk of blocks) {
    const g = groups[groups.length - 1];
    if (g && blk.a0 - g[g.length - 1].a1 <= 2 * context) g.push(blk);
    else groups.push([blk]);
  }
  let added = 0;
  let removed = 0;
  const hunks = groups.map((g): Hunk => {
    const first = g[0];
    const last = g[g.length - 1];
    const pieces: Piece[] = [];
    g.forEach((blk, i) => {
      if (i > 0) {
        // Unchanged lines between two blocks of the same hunk.
        const gap = a.slice(g[i - 1].a1, blk.a0);
        pieces.push({ kind: 'same', text: `\n${gap.join('\n')}${gap.length ? '\n' : ''}` });
      }
      const oldText = a.slice(blk.a0, blk.a1).join('\n');
      const newText = b.slice(blk.b0, blk.b1).join('\n');
      for (const p of wordPieces(oldText, newText)) {
        if (p.kind === 'add') added += countWords(p.text);
        if (p.kind === 'del') removed += countWords(p.text);
        pieces.push(p);
      }
    });
    return {
      line: first.b0 + 1,
      oldLine: first.a0 + 1,
      before: a.slice(Math.max(0, first.a0 - context), first.a0),
      pieces: clean(pieces),
      after: a.slice(last.a1, last.a1 + context),
    };
  });
  return { hunks, added, removed };
}

/**
 * Formulas (`$…$`) a passage changed, paired old → new in order (either side
 * null when one was only removed or added), so What changed can draw them.
 */
export function changedFormulas(hunk: Pick<Hunk, 'pieces'>, max = 4): { before: string | null; after: string | null }[] {
  const text = (skip: Piece['kind']) => hunk.pieces.filter((p) => p.kind !== skip).map((p) => p.text).join('');
  const spans = (t: string) => [...t.matchAll(/\$[^$\n]+\$/g)].map((m) => m[0]);
  const before = spans(text('add'));
  const after = spans(text('del'));
  const removed = before.filter((f) => !after.includes(f));
  const added = after.filter((f) => !before.includes(f));
  return Array.from({ length: Math.min(max, Math.max(removed.length, added.length)) }, (_, i) => ({ before: removed[i] ?? null, after: added[i] ?? null }));
}
