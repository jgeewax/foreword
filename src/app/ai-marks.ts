// Marks in the editor for the assistant's work on a file: the lines it
// changed (from History's agent versions) and the lines it read (from its
// read tool calls). Both are recorded against the text as it was then and
// mapped onto the text as it is now with a line diff, so they follow the
// text through later edits; a line the author has rewritten since is no
// longer the assistant's and loses its mark.
import { diff, mapLines, splitLines } from '../lib/diff';

/** One agent version's changes to one file. */
export type AiEdit = {
  versionId: string;
  label: string;
  /** Unix seconds. */
  time: number;
  /** The file's lines right after the assistant's turn. */
  after: string[];
  /** Changed blocks: lines [from, to) of `after` (from === to: lines were only removed there), and the text they replaced. */
  blocks: { from: number; to: number; old: string }[];
};

export function aiEdit(version: { id: string; label: string; time: number }, before: string | null, after: string): AiEdit {
  const a = splitLines(before ?? '');
  const b = splitLines(after);
  // Consecutive non-equal runs are one changed block.
  const spans: { a0: number; a1: number; b0: number; b1: number }[] = [];
  for (const r of diff(a, b)) {
    if (r.type === 'equal') continue;
    const a1 = r.a + (r.type === 'delete' ? r.n : 0);
    const b1 = r.b + (r.type === 'insert' ? r.n : 0);
    const last = spans[spans.length - 1];
    if (last && last.a1 === r.a && last.b1 === r.b) Object.assign(last, { a1, b1 });
    else spans.push({ a0: r.a, a1, b0: r.b, b1 });
  }
  return {
    versionId: version.id,
    label: version.label,
    time: version.time,
    after: b,
    blocks: spans.map((s) => ({ from: s.b0, to: s.b1, old: a.slice(s.a0, s.a1).join('\n') })),
  };
}

export type EditMark = {
  /** 1-based lines in the current text, inclusive. */
  from: number;
  to: number;
  /** Lines were removed here (nothing the assistant wrote remains to mark). */
  removal: boolean;
  /** What these lines replaced ('' if the assistant added them). */
  old: string;
  versionId: string;
  label: string;
  time: number;
};

/** Where each agent version's changes are in `current`, newest first. */
export function editMarks(edits: AiEdit[], current: string): EditMark[] {
  const lines = splitLines(current);
  const out: EditMark[] = [];
  const marked = new Set<number>();
  for (const e of [...edits].sort((x, y) => y.time - x.time)) {
    const map = mapLines(e.after, lines);
    for (const blk of e.blocks) {
      const base = { old: blk.old, versionId: e.versionId, label: e.label, time: e.time };
      if (blk.from === blk.to) {
        // Only removals: mark the line after the gap, if it's still where it was.
        // (At the end of the file, the last line.)
        const at = blk.from < map.length ? map[blk.from] : blk.from > 0 ? map[blk.from - 1] : 0;
        if (at >= 0 && at < Math.max(lines.length, 1)) out.push({ ...base, from: at + 1, to: at + 1, removal: true });
        continue;
      }
      // The lines the assistant wrote that are still as it left them, as consecutive runs.
      let run: number[] = [];
      const flush = () => {
        if (run.length) out.push({ ...base, from: run[0] + 1, to: run[run.length - 1] + 1, removal: false });
        run = [];
      };
      for (let i = blk.from; i < blk.to; i++) {
        const now = map[i];
        // A newer version's mark wins on a line both touched.
        if (now < 0 || marked.has(now)) {
          flush();
          continue;
        }
        if (run.length && now !== run[run.length - 1] + 1) flush();
        run.push(now);
      }
      flush();
    }
    for (const m of out) if (!m.removal) for (let l = m.from - 1; l < m.to; l++) marked.add(l);
  }
  return out.sort((x, y) => x.from - y.from);
}

/** One read tool call: the lines the assistant saw, as it saw them. */
export type AiRead = {
  path: string;
  /** 1-based first line of the read. */
  start: number;
  lines: string[];
  /** When it was read (ms). */
  time: number;
};

/**
 * A read tool's output → the lines read. OpenCode 2 writes "Read file x, lines
 * 1-35" then numbered lines ("12: text"); other versions wrap them in
 * <content>. Null if it isn't a text read (an image, an error).
 */
export function parseRead(path: string, output: string, time = Date.now()): AiRead | null {
  const lines: string[] = [];
  let start = -1;
  for (const l of output.split('\n')) {
    const m = /^(\d+): ?(.*)$/.exec(l);
    if (!m) continue;
    const n = Number(m[1]);
    if (start < 0) start = n;
    // Line numbers must follow on; anything else is the file's own text that happens to look numbered.
    if (n !== start + lines.length) continue;
    lines.push(m[2]);
  }
  return start > 0 && lines.length ? { path, start, lines, time } : null;
}

export type ReadMark = { from: number; to: number; time: number };

/**
 * Where the lines of each read are now: from the first to the last read line
 * still in the file (blank lines don't place a read on their own). Overlapping
 * reads merge.
 */
export function readMarks(reads: AiRead[], current: string): ReadMark[] {
  const lines = splitLines(current);
  const spans: ReadMark[] = [];
  for (const r of reads) {
    // Align the read block with the file as it is now: a diff of the block against the
    // stretch of the file around where it was read (text moves a little between edits).
    const slack = Math.max(300, r.lines.length);
    const w0 = Math.max(0, r.start - 1 - slack);
    const w1 = Math.min(lines.length, r.start - 1 + r.lines.length + slack);
    const map = mapLines(r.lines, lines.slice(w0, w1));
    let first = -1;
    let last = -1;
    r.lines.forEach((text, i) => {
      if (map[i] < 0 || !text.trim()) return;
      if (first < 0) first = map[i] + w0;
      last = map[i] + w0;
    });
    if (first >= 0) spans.push({ from: first + 1, to: last + 1, time: r.time });
  }
  spans.sort((a, b) => a.from - b.from);
  const merged: ReadMark[] = [];
  for (const s of spans) {
    const m = merged[merged.length - 1];
    if (m && s.from <= m.to + 1) {
      m.to = Math.max(m.to, s.to);
      m.time = Math.max(m.time, s.time);
    } else merged.push({ ...s });
  }
  return merged;
}
