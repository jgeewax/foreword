// Searching text for words, as VS Code's settings search does: every word of
// the query must appear (in any order, ignoring case), and each is highlighted
// where it appears.

/** The words of a query, lower-cased. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether `text` contains every word (no words: everything matches). */
export function hasWords(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}

/** Where the words occur in `text`: [start, end) spans in order, overlapping ones merged. */
export function wordSpans(text: string, words: string[]): [number, number][] {
  const t = text.toLowerCase();
  const spans: [number, number][] = [];
  for (const w of words) for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) spans.push([i, i + w.length]);
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}
