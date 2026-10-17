// Review comments: notes on passages of the book, kept beside the text in
// .typst-studio/review.json (the book itself is untouched), then addressed
// together by the assistant. Each comment is anchored like a web annotation:
// the quoted text, a little context either side, and a line hint, so it
// follows the passage as the text around it changes.

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
  status: 'open' | 'resolved';
  created: number;
  resolved?: number;
};

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

/** One message asking the assistant to address all these comments. */
export function addressPrompt(comments: { comment: ReviewComment; line: number | null }[]): string {
  const list = comments
    .map(({ comment: c, line }) => `[${c.id}] ${c.path}${line ? `, line ${line}` : ' (the passage has changed since)'}, on “${short(c.quote, 200)}”:\n${c.text}`)
    .join('\n\n');
  return `Please address these review comments on the book. For each one, make the change it asks for in that passage, in the book's voice and style guide. If a comment can't or shouldn't be done, say why in one sentence instead.

${list}

When you're done, end your reply with one line listing the comments you addressed, exactly like this:
${ADDRESSED_MARKER} ${comments.map((c) => c.comment.id).slice(0, 2).join(', ')}`;
}

// A whole line, anywhere (it may come before other marker lines, e.g. the task check).
const MARKER_LINE = /^[ \t]*[*_`]*ADDRESSED:[ \t]*([^\n]*?)[*_`]*[ \t]*$/gim;

/** Comment ids the reply says were addressed (from its last ADDRESSED line). */
export function parseAddressed(reply: string): string[] {
  const lines = [...reply.matchAll(MARKER_LINE)];
  const last = lines[lines.length - 1];
  return last ? [...last[1].matchAll(/\bc\d+\b/g)].map((x) => x[0]) : [];
}

/** The reply without ADDRESSED lines (for display). */
export function withoutAddressed(reply: string): string {
  return reply.replace(MARKER_LINE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}
