// Fuzzy matching for "go to file" (⌘P): the query's characters in order, with
// higher scores for matches at word starts and runs of consecutive characters,
// as in VS Code's quick open.

/** A score (higher is better) and the matched positions, or null if `query` isn't a subsequence of `text`. */
export function fuzzyMatch(query: string, text: string): { score: number; positions: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    // Prefer the next occurrence at a word start; else the next one at all.
    let i = t.indexOf(ch, from);
    if (i < 0) return null;
    for (let j = i; j >= 0 && j < t.length; j = t.indexOf(ch, j + 1)) {
      if (isWordStart(text, j)) {
        // Only jump ahead to a word start if it doesn't break a run already going.
        if (positions.length && positions[positions.length - 1] === i - 1) break;
        i = j;
        break;
      }
    }
    const prev = positions[positions.length - 1];
    score += 1;
    if (isWordStart(text, i)) score += 8;
    if (prev !== undefined && i === prev + 1) score += 5;
    if (prev !== undefined) score -= Math.min(3, (i - prev - 1) * 0.1);
    positions.push(i);
    from = i + 1;
  }
  // The query whole, as typed, beats scattered letters (more so at a word start), and is what's highlighted.
  const whole = t.indexOf(q);
  if (whole >= 0) {
    score += 12 + (isWordStart(text, whole) ? 8 : 0);
    positions.splice(0, positions.length, ...Array.from(q, (_, k) => whole + k));
  }
  // Shorter texts, and matches in the file name rather than the folders, rank higher.
  const slash = text.lastIndexOf('/');
  if (positions[0] > slash) score += 6;
  score -= text.length * 0.02;
  return { score, positions };
}

/**
 * Stricter, for commands (as VS Code's command palette): the query is the
 * start of words in the text, in order ("show conv" finds Show Conversations,
 * "exppdf" Export PDF), or is in it whole ("port" finds Export). Letters
 * scattered through it don't count: "save" doesn't find "Restart Preview".
 * Scored as `fuzzyMatch` scores.
 */
export function wordMatch(query: string, text: string): { score: number; positions: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  const whole = t.indexOf(q);
  const positions = whole >= 0 ? Array.from(q, (_, k) => whole + k) : wordStarts(q, text, t);
  if (!positions) return null;
  let score = whole >= 0 ? 12 + (isWordStart(text, whole) ? 8 : 0) : 0;
  positions.forEach((p, k) => {
    score += 1 + (isWordStart(text, p) ? 8 : 0) + (k > 0 && p === positions[k - 1] + 1 ? 5 : 0);
    if (k > 0) score -= Math.min(3, (p - positions[k - 1] - 1) * 0.1);
  });
  return { score: score - text.length * 0.02, positions };
}

/** Each character of `q` right after the one before, or at a later word start (null if it can't be done). */
function wordStarts(q: string, text: string, t: string): number[] | null {
  const failed = new Set<string>();
  const go = (k: number, prev: number): number[] | null => {
    if (k === q.length) return [];
    if (failed.has(`${k}:${prev}`)) return null;
    if (prev >= 0 && t[prev + 1] === q[k]) {
      const rest = go(k + 1, prev + 1);
      if (rest) return [prev + 1, ...rest];
    }
    // (Right after the one before was tried above.)
    for (let j = t.indexOf(q[k], prev < 0 ? 0 : prev + 2); j >= 0; j = t.indexOf(q[k], j + 1)) {
      if (!isWordStart(text, j)) continue;
      const rest = go(k + 1, j);
      if (rest) return [j, ...rest];
    }
    failed.add(`${k}:${prev}`);
    return null;
  };
  return go(0, -1);
}

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  const ch = text[i];
  return /[/\s_.-]/.test(prev) || (/[a-z]/.test(prev) && /[A-Z]/.test(ch)) || (/\D/.test(prev) && /\d/.test(ch));
}
