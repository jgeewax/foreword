// A file's headings, for the path bar above the editor (VS Code's breadcrumbs):
// the headings the cursor is under, and the whole outline to jump around in.
// Typst (`= Title <label>`) and Markdown (`# Title`); anything else has none.

export type Heading = {
  /** 1-based line. */
  line: number;
  /** 1 for `=` (or `#`), 2 for `==`, … */
  level: number;
  /** As it reads: no label, emphasis marks or escapes. */
  title: string;
};

const TYPST = /^\s*(=+)\s+(.+?)\s*(<[\w:.-]+>)?\s*$/;
const MARKDOWN = /^ {0,3}(#{1,6})\s+(.+?)(\s+#+)?\s*$/;

const plain = (s: string) => s.replace(/[*_`]/g, '').replace(/\\(.)/g, '$1').trim();

export function headings(lines: readonly string[], language: string): Heading[] {
  const pattern = language === 'typst' ? TYPST : language === 'markdown' ? MARKDOWN : null;
  if (!pattern) return [];
  const out: Heading[] = [];
  // Not in raw blocks (``` in Typst, ``` or ~~~ in Markdown) or Typst's block comments.
  const fences = language === 'typst' ? /^\s*(`{3,})(.*)$/ : /^\s*(`{3,}|~{3,})(.*)$/;
  let fence: string | null = null;
  let comment = false;
  let math = false;
  lines.forEach((text, i) => {
    if (comment) {
      if (text.includes('*/')) comment = false;
      return;
    }
    if (fence) {
      if (language === 'typst' ? text.includes(fence) : text.trim().startsWith(fence)) fence = null;
      return;
    }
    const f = fences.exec(text);
    if (f) {
      // In Typst, ```typ #x``` on one line is raw text, not a block.
      if (language !== 'typst' || !f[2].includes(f[1])) fence = f[1];
      return;
    }
    if (language === 'typst' && /^\s*\/\*/.test(text) && !text.includes('*/')) {
      comment = true;
      return;
    }
    // Not inside maths that spans lines (`$` … `= x^2` … `$`): a line there starting with = isn't a heading.
    const inMath = math;
    if (language === 'typst') math = ((text.replace(/`[^`]*`/g, '').match(/(?<!\\)\$/g)?.length ?? 0) % 2 === 1) !== math;
    if (inMath) return;
    const m = pattern.exec(text);
    const title = m && plain(m[2]);
    if (m && title) out.push({ line: i + 1, level: m[1].length, title });
  });
  return out;
}

/** The headings a line is under, outermost first (`= Part` › `== Chapter` › …). */
export function headingPath(all: readonly Heading[], line: number): Heading[] {
  const path: Heading[] = [];
  for (const h of all) {
    if (h.line > line) break;
    while (path.length && path[path.length - 1].level >= h.level) path.pop();
    path.push(h);
  }
  return path;
}
