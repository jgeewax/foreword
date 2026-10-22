import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseMarkdown blocks', () => {
  it('parses headings, rules, lists, quotes, code fences and paragraphs', () => {
    const md = '### Outline\n1. **Definition**: the trace\n2. The connection\n\n---\n- one\n- two\n\n> quoted\n\n```typst\n= Heading\n```\nPlain line\nnext line';
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.t)).toEqual(['heading', 'list', 'hr', 'list', 'quote', 'code', 'para']);
    expect(blocks[1]).toMatchObject({ t: 'list', ordered: true, start: 1 });
    expect((blocks[1] as any).items).toHaveLength(2);
    expect(blocks[5]).toEqual({ t: 'code', lang: 'typst', v: '= Heading' });
    expect((blocks[6] as any).c.map((x: any) => x.t)).toEqual(['text', 'br', 'text']);
  });

  it('keeps an unterminated code fence (streaming) as code, open', () => {
    expect(parseMarkdown('```\nhalf done')).toEqual([{ t: 'code', lang: '', v: 'half done', open: true }]);
  });

  it('takes a Typst equation on lines of its own as one block', () => {
    const md = ['so the inverse is one step away:', '', '$', '  P^(-1) & = 1/(2i) mat(i, -1; i, 1) \\', '         & = mat(1/2, i/2; 1/2, -i/2)', '$', '', 'Next.'].join('\n');
    expect(parseMarkdown(md)).toEqual([
      { t: 'para', c: [{ t: 'text', v: 'so the inverse is one step away:' }] },
      { t: 'math', v: '$\n  P^(-1) & = 1/(2i) mat(i, -1; i, 1) \\\n         & = mat(1/2, i/2; 1/2, -i/2)\n$' },
      { t: 'para', c: [{ t: 'text', v: 'Next.' }] },
    ]);
    // Opened on the formula's first line and closed on its last; right after a sentence, by a `$` of its own.
    expect(parseMarkdown('Gives:\n\n$ A &= B \\\n  &= C $').map((b) => b.t)).toEqual(['para', 'math']);
    expect(parseMarkdown('Gives:\n$\n  A &= B\n$\nso.').map((b) => b.t)).toEqual(['para', 'math', 'para']);
    // A whole one on its line.
    expect(parseMarkdown('$ underbrace((1)(-i)(1/2), "first") + overline(z) $')).toEqual([{ t: 'math', v: '$ underbrace((1)(-i)(1/2), "first") + overline(z) $' }]);
    // Still being written.
    expect(parseMarkdown('$\n  x &= 1 \\')).toEqual([{ t: 'math', v: '$\n  x &= 1 \\', open: true }]);
  });

  it('leaves formulas in a sentence, and dollars, in their paragraph', () => {
    for (const md of ['$x$ is the unknown', '$ x $, which we found', '$5 a copy, or $4 for ten', 'Costs $5\n$ 4 for ten', '$x$ and $y$']) {
      expect(parseMarkdown(md).map((b) => b.t)).toEqual(['para']);
    }
  });

  it('tables: a header, its rule (with alignment) and rows, after a paragraph too', () => {
    const blocks = parseMarkdown('Where it is:\n| Chapter | Line | Use |\n|---|--:|:-:|\n| 1 | 5 | `a|b` and **bold** |\n| 10 | 6\n\nAfter.');
    expect(blocks.map((b) => b.t)).toEqual(['para', 'table', 'para']);
    const table = blocks[1] as Extract<ReturnType<typeof parseMarkdown>[number], { t: 'table' }>;
    expect(table.align).toEqual([null, 'right', 'center']);
    expect(table.head.map((c) => c.map((x) => (x as { v: string }).v).join(''))).toEqual(['Chapter', 'Line', 'Use']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][2].map((x) => x.t)).toEqual(['code', 'text', 'strong']);
    // A short row is filled out to the header's columns.
    expect(table.rows[1][2]).toEqual([]);
    // Pipes in a sentence aren't a table.
    expect(parseMarkdown('a | b\nc | d').map((b) => b.t)).toEqual(['para']);
  });

  it('keeps numbering of ordered lists that start later', () => {
    expect(parseMarkdown('3. third\n4. fourth')[0]).toMatchObject({ ordered: true, start: 3 });
  });
});

describe('parseInline', () => {
  it('handles bold, italics, code and links', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.y)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd' },
      { t: 'text', v: ' ' },
      { t: 'link', c: [{ t: 'text', v: 'e' }], href: 'https://x.y' },
    ]);
  });

  it('leaves $math$ untouched, including underscores and asterisks inside it', () => {
    expect(parseInline('sum $u_i v_i * w$ here')).toEqual([
      { t: 'text', v: 'sum ' },
      { t: 'math', v: '$u_i v_i * w$' },
      { t: 'text', v: ' here' },
    ]);
  });

  it("doesn't treat snake_case words or lone markers as emphasis", () => {
    expect(parseInline('see ch2_eigen and 2 * 3')).toEqual([{ t: 'text', v: 'see ch2_eigen and 2 * 3' }]);
    expect(parseInline('**unfinished')).toEqual([{ t: 'text', v: '**unfinished' }]);
  });
});
