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

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  const ch = text[i];
  return /[/\s_.-]/.test(prev) || (/[a-z]/.test(prev) && /[A-Z]/.test(ch)) || (/\D/.test(prev) && /\d/.test(ch));
}
