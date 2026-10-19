// Minimal Markdown for chat replies → a small AST rendered as React elements
// (never HTML strings, so model output can't inject markup). Covers what
// replies actually use. `$math$` is kept verbatim so Typst/LaTeX math isn't
// mangled by `_`/`*` emphasis rules. Unfinished syntax (while streaming)
// degrades to plain text.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'math'; v: string }
  | { t: 'link'; c: Inline[]; href: string }
  | { t: 'br' };

export type Block =
  | { t: 'heading'; level: number; c: Inline[] }
  | { t: 'para'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'table'; align: ('left' | 'center' | 'right' | null)[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' };

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
/** A table's second line: | --- | :--: | ---: | */
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** A row's cells: split at the pipes outside `code`, without the pipes at either end. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let code = false;
  const s = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '`') code = !code;
    if (ch === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '|' && !code) {
      out.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/** A table starts here: a row of cells, then its rule (as many columns). */
const tableAt = (lines: string[], i: number) => i + 1 < lines.length && lines[i].includes('|') && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-') && cells(lines[i]).length === cells(lines[i + 1]).length;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // closing fence (or end of a still-streaming reply)
      blocks.push({ t: 'code', lang: fence[2], v: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ t: 'heading', level: heading[1].length, c: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ t: 'quote', c: joinLines(body) });
      continue;
    }
    if (tableAt(lines, i)) {
      const head = cells(lines[i]);
      const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : null));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const row = cells(lines[i++]);
        rows.push(head.map((_, k) => parseInline(row[k] ?? '')));
      }
      blocks.push({ t: 'table', align, head: head.map(parseInline), rows });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1]);
      const start = ordered ? parseInt(item[1], 10) : 1;
      const items: string[][] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m && /\d/.test(m[1]) === ordered) {
          items.push([m[2]]);
          i++;
        } else if (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !LIST_ITEM.exec(lines[i])) {
          items[items.length - 1].push(lines[i++].trim()); // continuation line
        } else break;
      }
      blocks.push({ t: 'list', ordered, start, items: items.map(joinLines) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*(```|~~~)|\s*>)/.test(lines[i]) && !LIST_ITEM.exec(lines[i]) && !(para.length && tableAt(lines, i))) para.push(lines[i++]);
    blocks.push({ t: 'para', c: joinLines(para) });
  }
  return blocks;
}

function joinLines(lines: string[]): Inline[] {
  return lines.flatMap((l, k) => (k ? [{ t: 'br' } as Inline, ...parseInline(l)] : parseInline(l)));
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ t: 'code', v: m[1] });
    } else if ((m = /^\$\$([^$]+)\$\$/.exec(rest)) || (m = /^\$([^$\n]+)\$/.exec(rest))) {
      flush();
      out.push({ t: 'math', v: m[0] });
    } else if ((m = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest)) || (m = /^__(?=\S)([\s\S]*?\S)__/.exec(rest))) {
      flush();
      out.push({ t: 'strong', c: parseInline(m[1]) });
    } else if ((m = /^\*(?=\S)([^*]*?\S)\*/.exec(rest)) || (/(^|\W)$/.test(s.slice(0, i)) && (m = /^_(?=\S)([^_]*?\S)_(?!\w)/.exec(rest)))) {
      flush();
      out.push({ t: 'em', c: parseInline(m[1]) });
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      out.push({ t: 'link', c: parseInline(m[1]), href: m[2] });
    } else {
      text += s[i];
      i++;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}
