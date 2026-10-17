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

  it('keeps an unterminated code fence (streaming) as code', () => {
    expect(parseMarkdown('```\nhalf done')).toEqual([{ t: 'code', lang: '', v: 'half done' }]);
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
