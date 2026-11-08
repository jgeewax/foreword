import { describe, expect, it } from 'vitest';
import { closing, scanItems, type Item } from './typst-items';

const show = (s: string, items: Item[]) => items.map((i) => `${i.kind}${i.keyword ? `:${i.keyword}` : ''}${i.names ? `:${i.names.join('.')}` : ''} ${JSON.stringify(s.slice(i.start, i.end))}`);

describe('scanItems', () => {
  it('splits markup into its text and what each # starts', () => {
    const s = [
      '// A #comment, and a raw `#not-code` here',
      '#import "lib.typ": *',
      '#set heading(numbering: "1.1")',
      'Some text, = not a heading.',
      '#part("Vectors [and] geometry") <part-1>',
      '#counter(page).update(1)',
      '#{',
      '  set page(numbering: none)',
      '}',
      '#book-chapter(include "ch1.typ") // the first',
      '#include "ch2.typ" #include "ch3.typ"',
    ].join('\n');
    expect(show(s, scanItems(s, 0, s.length, 'markup'))).toEqual([
      'text "// A #comment, and a raw `#not-code` here\\n"',
      'statement:import "#import \\"lib.typ\\": *"',
      'text "\\n"',
      'statement:set "#set heading(numbering: \\"1.1\\")"',
      'text "\\nSome text, = not a heading.\\n"',
      'call:part "#part(\\"Vectors [and] geometry\\")"',
      'text " <part-1>\\n"',
      'call:counter.update "#counter(page).update(1)"',
      'text "\\n"',
      'code "#{\\n  set page(numbering: none)\\n}"',
      'text "\\n"',
      'call:book-chapter "#book-chapter(include \\"ch1.typ\\")"',
      'text " // the first\\n"',
      'statement:include "#include \\"ch2.typ\\""',
      'text " "',
      'statement:include "#include \\"ch3.typ\\""',
    ]);
  });

  it('gives a call its arguments and bodies, and a block its inside', () => {
    const s = '#page(header: none)[]#[*hi*]';
    const [page, block] = scanItems(s, 0, s.length, 'markup');
    expect(page.args!.map((a) => s.slice(a.start, a.end))).toEqual(['(header: none)']);
    expect(page.bodies).toEqual([{ start: 20, end: 20 }]);
    expect(s.slice(block.inner!.start, block.inner!.end)).toBe('*hi*');
  });

  it('splits code at line ends and semicolons, an else on the next line going on', () => {
    const s = [
      'show: apply-headers; set text(red)',
      'heading(level: 1, numbering: none)[Contents] // the contents',
      'if draft {',
      '  "draft"',
      '}',
      'else { none }',
      'columns(2,',
      '  make-index())',
      'x.at(0) + 1',
      '[#metadata("p") <marker>]',
    ].join('\n');
    expect(show(s, scanItems(s, 0, s.length, 'code'))).toEqual([
      'statement:show "show: apply-headers"',
      'statement:set "set text(red)"',
      'call:heading "heading(level: 1, numbering: none)[Contents]"',
      'statement:if "if draft {\\n  \\"draft\\"\\n}\\nelse { none }"',
      'call:columns "columns(2,\\n  make-index())"',
      'other "x.at(0) + 1"',
      'markup "[#metadata(\\"p\\") <marker>]"',
    ]);
  });

  it('finds where a bracket closes, past strings and comments', () => {
    const s = 'f(a, ")", /* ) */ [x)]) + 1';
    expect(closing(s, 1)).toBe(s.indexOf(' + 1'));
  });
});
