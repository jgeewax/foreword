// Review comments: notes on passages of the book, kept beside the text in
// .typst-studio/review.json (the book itself is untouched). The assistant
// fixes one or all of them and reports on each; a changed passage waits for
// the author to keep it or undo it. Each comment is anchored like a web
// annotation: the quoted text, a little context either side, and a line hint,
// so it follows the passage as the text around it changes.
import { diff, splitLines } from '../lib/diff';

export const REVIEW_FILE = '.typst-studio/review.json';

export type ReviewComment = {
  id: string;
  path: string;
  /** The commented passage, exactly as it was. */
  quote: string;
  prefix: string;
  suffix: string;
  /** 1-based line where the passage started (a hint for re-anchoring). */
  line: number;
  text: string;
  /** open → (the assistant changed it) addressed → resolved; or resolved by hand. */
  status: 'open' | 'addressed' | 'resolved';
  created: number;
  resolved?: number;
  /** What the assistant did about it. */
  outcome?: CommentOutcome;
};

export type CommentOutcome = {
  kind: 'changed' | 'declined';
  /** Its one-line note: what it did, or why not. */
  note: string;
  at: number;
  /** The passage before and after its change (whole lines), to show and to undo. */
  change?: PassageChange;
};

export type PassageChange = { before: string; after: string; /** 1-based line where `after` starts. */ line: number };

const CONTEXT = 32;

/** A new comment on [start, end) of a file's text. */
export function makeComment(id: string, path: string, text: string, start: number, end: number, comment: string): ReviewComment {
  return {
    id,
    path,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    line: text.slice(0, start).split('\n').length,
    text: comment.trim(),
    status: 'open',
    created: Date.now(),
  };
}

const commonSuffix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/**
 * Where the comment's passage is now: [start, end) offsets, or null if the
 * quoted text is gone. Among several occurrences, the one whose surroundings
 * and line best match wins.
 */
export function locate(text: string, c: ReviewComment): [number, number] | null {
  if (!c.quote) return null;
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (let i = text.indexOf(c.quote); i >= 0; i = text.indexOf(c.quote, i + 1)) {
    const before = text.slice(Math.max(0, i - CONTEXT), i);
    const after = text.slice(i + c.quote.length, i + c.quote.length + CONTEXT);
    const line = text.slice(0, i).split('\n').length;
    const context = commonSuffix(before, c.prefix) + commonPrefix(after, c.suffix);
    // A short quote is only the same passage if some of its surroundings match too.
    if (c.quote.length < 20 && context < 3) continue;
    const score = context - Math.min(20, Math.abs(line - c.line)) / 4;
    if (score > bestScore) [best, bestScore] = [[i, i + c.quote.length], score];
  }
  return best;
}

export function parseReview(text: string): ReviewComment[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v?.comments) ? v.comments.filter((c: ReviewComment) => c && typeof c.id === 'string' && typeof c.path === 'string') : [];
  } catch {
    return [];
  }
}

export function serializeReview(comments: ReviewComment[]): string {
  return `${JSON.stringify({ comments }, null, 2)}\n`;
}

export function nextCommentId(comments: ReviewComment[]): string {
  const n = Math.max(0, ...comments.map((c) => Number(/^c(\d+)$/.exec(c.id)?.[1] ?? 0)));
  return `c${n + 1}`;
}

const short = (s: string, n = 300) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

export const ADDRESSED_MARKER = 'ADDRESSED:';

/** One message asking the assistant to address these comments (one or all), and to report on each. */
export function addressPrompt(comments: { comment: ReviewComment; line: number | null }[]): string {
  const list = comments
    .map(({ comment: c, line }) => `[${c.id}] ${c.path}${line ? `, line ${line}` : ' (the passage has changed since)'}, on “${short(c.quote, 200)}”:\n${c.text}`)
    .join('\n\n');
  const one = comments.length === 1;
  return `Please address ${one ? 'this review comment' : 'these review comments'} on the book. For each one, make the change it asks for in that passage, in the book's voice and style guide, and change nothing else. If a comment can't or shouldn't be done, leave the text and say why.

${list}

When you're done, end your reply with one line per comment, exactly like this (a few words after the dash):
${comments
  .slice(0, 2)
  .map((c, i) => `REVIEW ${c.comment.id}: ${i === 0 ? 'changed — what you did' : 'declined — why not'}`)
  .join('\n')}`;
}

export type ReviewReport = { id: string; kind: 'changed' | 'declined'; note: string };

// Whole lines, anywhere (they may come before other marker lines, e.g. the task check).
const REPORT_LINE = /^[ \t]*[*_`]*REVIEW[ \t]+(c\d+)[ \t]*:[ \t]*(changed|declined)\b[ \t]*[—–-]*[ \t]*([^\n]*?)[*_`]*[ \t]*$/gim;
const MARKER_LINE = /^[ \t]*[*_`]*ADDRESSED:[ \t]*([^\n]*?)[*_`]*[ \t]*$/gim;

/** What the reply says about each comment (REVIEW lines; an older ADDRESSED line counts as changed). */
export function parseReport(reply: string): ReviewReport[] {
  const out: ReviewReport[] = [];
  for (const m of reply.matchAll(REPORT_LINE)) {
    const id = m[1].toLowerCase();
    const at = out.findIndex((r) => r.id === id);
    const report = { id, kind: m[2].toLowerCase() as ReviewReport['kind'], note: m[3].trim() };
    if (at >= 0) out[at] = report;
    else out.push(report);
  }
  for (const id of parseAddressed(reply)) if (!out.some((r) => r.id === id)) out.push({ id, kind: 'changed', note: '' });
  return out;
}

/** Comment ids the reply says were addressed (from its last ADDRESSED line). */
export function parseAddressed(reply: string): string[] {
  const lines = [...reply.matchAll(MARKER_LINE)];
  const last = lines[lines.length - 1];
  return last ? [...last[1].matchAll(/\bc\d+\b/g)].map((x) => x[0]) : [];
}

/** The reply without its report lines (for display). */
export function withoutAddressed(reply: string): string {
  return reply.replace(REPORT_LINE, '').replace(MARKER_LINE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * What changed around a passage (offsets [start, end) in `before`) between two
 * versions of a file: the changed lines that touch it, before and after. Null
 * if nothing there changed.
 */
export function passageChange(before: string, after: string, start: number, end: number): PassageChange | null {
  const a = splitLines(before);
  const b = splitLines(after);
  const first = before.slice(0, start).split('\n').length - 1;
  const last = before.slice(0, Math.max(start, end - 1)).split('\n').length - 1;
  // Changed blocks (consecutive non-equal runs), as line ranges in both versions.
  type Block = { a0: number; a1: number; b0: number; b1: number };
  const blocks: Block[] = [];
  for (const r of diff(a, b)) {
    if (r.type === 'equal') continue;
    const a1 = r.a + (r.type === 'delete' ? r.n : 0);
    const b1 = r.b + (r.type === 'insert' ? r.n : 0);
    const prev = blocks[blocks.length - 1];
    if (prev && prev.a1 === r.a && prev.b1 === r.b) Object.assign(prev, { a1, b1 });
    else blocks.push({ a0: r.a, a1, b0: r.b, b1 });
  }
  // The blocks touching the passage's lines (an insertion right after it counts).
  const touching = blocks.filter((k) => k.a0 <= last + 1 && Math.max(k.a1, k.a0 + 1) > first);
  if (!touching.length) return null;
  const a0 = Math.min(first, ...touching.map((k) => k.a0));
  const a1 = Math.max(last + 1, ...touching.map((k) => k.a1));
  const shift = touching[0].b0 - touching[0].a0;
  const b0 = a0 + shift;
  const b1 = a1 + shift + touching.reduce((n, k) => n + (k.b1 - k.b0) - (k.a1 - k.a0), 0);
  return { before: a.slice(a0, a1).join('\n'), after: b.slice(b0, b1).join('\n'), line: b0 + 1 };
}

/** The text with a change undone (the `after` passage nearest its line put back as `before`), or null if it's gone. */
export function undoChange(text: string, change: PassageChange): string | null {
  const lines = splitLines(text);
  const want = splitLines(change.after);
  let best = -1;
  for (let i = 0; i + want.length <= lines.length; i++) {
    if (want.every((l, j) => lines[i + j] === l) && (best < 0 || Math.abs(i + 1 - change.line) < Math.abs(best + 1 - change.line))) best = i;
  }
  if (best < 0) return null;
  const next = [...lines.slice(0, best), ...splitLines(change.before), ...lines.slice(best + want.length)].join('\n');
  return text.endsWith('\n') ? `${next}\n` : next;
}
