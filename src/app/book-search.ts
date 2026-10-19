// Search across the book (the Search view, ⇧⌘F), as VS Code's: the text of
// every chapter and other text file, by words or a pattern, with matching
// case or whole words, and Replace All. Pure functions; Studio reads the
// files and writes the replacements.

export type SearchOptions = { matchCase: boolean; wholeWord: boolean; regex: boolean };

export type SearchMatch = {
  /** 1-based. */
  line: number;
  /** 1-based, where the match starts. */
  column: number;
  length: number;
  /** The line around it, shortened: text before, the match, text after. */
  before: string;
  match: string;
  after: string;
};

export type FileMatches = { path: string; matches: SearchMatch[] };

/** Files with text to search: the book's own, not its pictures or PDFs. */
export const SEARCHABLE = /\.(typ|md|markdown|txt|bib|csv|tsv|ya?ml|toml|json|py|js|ts|r|jl|sh)$/i;

/** The pattern for a query, or why it can't be one (a pattern that doesn't parse); null for no query. */
export function searchPattern(query: string, options: SearchOptions): RegExp | { error: string } | null {
  if (!query) return null;
  let source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    const re = new RegExp(source, `gu${options.matchCase ? '' : 'i'}`);
    // A pattern that matches nothing at all ("x*" on most lines) would find every position.
    if (re.test('')) return { error: 'That pattern matches empty text.' };
    re.lastIndex = 0;
    return re;
  } catch (e) {
    return { error: `Not a pattern: ${(e as Error).message.replace(/^Invalid regular expression: /, '')}` };
  }
}

/** How much of the line is shown before a match, so the match is in view in a narrow sidebar. */
const LEAD = 14;
const TRAIL = 120;

/** Every match in `text`, up to `limit`. */
export function searchText(text: string, re: RegExp, limit = 500): SearchMatch[] {
  const out: SearchMatch[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i];
    re.lastIndex = 0;
    for (let m = re.exec(line); m && out.length < limit; m = re.exec(line)) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const lead = line.slice(0, start).replace(/^\s+/, '');
      out.push({
        line: i + 1,
        column: start + 1,
        length: m[0].length,
        before: lead.length > LEAD ? `…${lead.slice(-LEAD).replace(/^\S*\s/, '')}` : lead,
        match: m[0],
        after: line.slice(start + m[0].length, start + m[0].length + TRAIL),
      });
    }
  }
  return out;
}

/**
 * The text with every match replaced. A pattern's replacement may use $1, $2
 * for its groups (as in VS Code); plain text is put in as it is.
 */
export function replaceText(text: string, re: RegExp, replacement: string, options: SearchOptions): { text: string; count: number } {
  let count = 0;
  const lines = text.split('\n').map((line) =>
    line.replace(new RegExp(re.source, re.flags), (...args) => {
      count++;
      if (!options.regex) return replacement;
      const groups = args.slice(1, -2) as (string | undefined)[];
      return replacement.replace(/\$(\$|&|\d{1,2})/g, (_, g: string) => (g === '$' ? '$' : g === '&' ? (args[0] as string) : (groups[Number(g) - 1] ?? '')));
    }),
  );
  return { text: lines.join('\n'), count };
}
