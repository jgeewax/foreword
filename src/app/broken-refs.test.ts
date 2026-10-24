import { describe, expect, it } from 'vitest';
import { bibliographyKeys, bookPreviewText, inRefGuard, RefIndex, refDiagnostic, refGuard, refMessage, scanRefs } from './broken-refs';

const names = (text: string) => scanRefs(text).refs.map((r) => r.name);

describe('reading references', () => {
  it('finds @references where Typst does', () => {
    expect(names('See @intro, @fig:one. And @eq-2: here, (@a) and [@b] and @c\'s.')).toEqual(['intro', 'fig:one', 'eq-2', 'a', 'b', 'c']);
    expect(names('Retina @2x, @_x, @é-1 and @a.b.')).toEqual(['2x', '_x', 'é-1', 'a.b']);
    expect(names('A lone @ or @. or \\@escaped.')).toEqual([]);
  });

  it('leaves out comments, raw text, maths and strings', () => {
    const text = [
      '// @in-a-comment',
      '/* @in-a-block',
      '   comment */',
      'Some `@inline` raw and ```typ\n@in-raw\n``` and $x = @in-math$.',
      '#link("mailto:me@example.com")[me] #let s = "@in-a-string"',
      'https://example.com/@user // @after-link',
    ].join('\n');
    expect(names(text)).toEqual(['user']);
  });

  it('finds them in content inside code', () => {
    expect(names('#figure(rect(), caption: [As in @one])\n#{\n  let x = 1\n  [Also @two]\n}\n#if true [Then @three]')).toEqual(['one', 'two', 'three']);
  });

  it('reads a label given to ref, link or a …ref function as a reference, but not one given to query or show', () => {
    const scan = scanRefs('#ref(<a>) #ref(<b>, form: "page") #link(<c>)[C] #chapref(<d>)\n#query(<e>) #show <f>: set text(red)\n#context query(heading.where(label: <g>))');
    expect(scan.refs.map((r) => [r.name, r.link])).toEqual([['a', false], ['b', false], ['c', true], ['d', false]]);
    expect(scan.labels).toEqual([]);
  });

  it('says where each one is', () => {
    const scan = scanRefs('Hi @there.');
    expect(scan.refs[0]).toEqual({ name: 'there', start: 3, end: 9, link: false, email: false });
  });

  it('knows an email address Typst takes for a reference', () => {
    const [ref] = scanRefs('Write to jj@example.com today.').refs;
    expect(ref).toMatchObject({ name: 'example.com', email: true });
    expect(scanRefs('See @fig.one').refs[0].email).toBe(false);
  });

  it('finds the labels put on things', () => {
    const scan = scanRefs('= Intro <intro>\n#figure(rect())[] <fig-1>\n$ x $ <eq>\nText.<p>\n`<not>` and // <nor>\n');
    expect(scan.labels.map((l) => l.name)).toEqual(['intro', 'fig-1', 'eq', 'p']);
  });

  it('keeps the strings that could name a label, and label("…" + …) prefixes', () => {
    const scan = scanRefs('#theorem("thm-1")[A] #let l(n) = label("sec-" + n) #text(fill: red, "a b")');
    expect(scan.names).toEqual(['thm-1', 'sec-']);
    expect(scan.prefixes).toEqual(['sec-']);
  });

  it('finds the bibliography files', () => {
    expect(scanRefs('#bibliography("refs.bib", style: "apa")').bibliographies).toEqual(['refs.bib']);
    expect(scanRefs('#bibliography(("a.bib", "b.yml"), title: "Works")').bibliographies).toEqual(['a.bib', 'b.yml']);
    expect(scanRefs('#bibliography(bytes(read("x.bib")))').bibliographies).toBeNull();
    expect(scanRefs('No bibliography.').bibliographies).toEqual([]);
  });
});

describe('bibliography keys', () => {
  it('reads BibTeX', () => {
    const bib = '@string{acm = "ACM"}\n@book{knuth1968,\n  title = {TAOCP}}\n@Article( lamport:94 , title={LaTeX})\n@comment{x,}';
    expect(bibliographyKeys('refs.bib', bib)).toEqual(['knuth1968', 'lamport:94']);
  });

  it('reads Hayagriva', () => {
    const yml = '# Works\nknuth:\n  type: Book\n  title: TAOCP\n"quoted key":\n  type: Article\nwith:colon:\n  type: Web\n---\n';
    expect(bibliographyKeys('works.yml', yml)).toEqual(['knuth', 'quoted key', 'with:colon']);
  });
});

const book = (files: Record<string, string>, root = '') => {
  const index = new RefIndex(root);
  for (const [path, text] of Object.entries(files)) index.setFile(path, text);
  return index;
};

describe('references that go nowhere', () => {
  const files = {
    'main.typ': '#import "template.typ": *\n#include "chapters/one.typ"\n#include "chapters/two.typ"\n',
    'template.typ': '#let book(body) = [#metadata(none) <made-by-template> #body]',
    'chapters/one.typ': '= Vectors <ch:vectors>\n#figure(rect()) <fig:arrow>\nSee @ch:vectors and @ch:vectr.\n',
    'chapters/two.typ': '= Matrices <ch:matrices>\nAs in @fig:arrow, @BROKEN and @made-by-template.\n#link(<gone>)[There]\n',
    'drafts/old.typ': '@not-in-the-book <old>\n',
  };

  it('are the references to labels nothing in the book has, in reading order, with a label that may have been meant', () => {
    const problems = book(files).problems('main.typ');
    expect(problems.map((p) => [p.path, p.name, p.why, p.near, p.link])).toEqual([
      ['chapters/one.typ', 'ch:vectr', 'missing', 'ch:vectors', false],
      ['chapters/two.typ', 'BROKEN', 'missing', null, false],
      ['chapters/two.typ', 'gone', 'missing', null, true],
    ]);
    expect(problems[0]).toMatchObject({ line: 2, character: 20, endLine: 2, endCharacter: 29 });
  });

  it('are references to a label on more than one thing in the book', () => {
    const index = book({ 'main.typ': '#include "a.typ"\n#include "b.typ"\n@twice', 'a.typ': '= A <twice>', 'b.typ': '= B <twice>', 'c.typ': '= C <once>' });
    expect(index.problems('main.typ').map((p) => [p.name, p.why])).toEqual([['twice', 'twice']]);
  });

  it('aren’t citations, or labels a function may make from a string', () => {
    const index = book({
      'main.typ': '#let thm(body, name) = [#figure(body) #label(name)]\n#thm[A]("thm-a")\n#let l(n) = label("eq-" + n)\nSee @thm-a, @eq-12, @knuth and @fig:pic.\n#bibliography("refs.bib")\n#image("p.png") <pic>',
    });
    expect(index.problems('main.typ').map((p) => p.name)).toEqual(['knuth']);
    index.setBibliography('refs.bib', '@book{knuth, title={TAOCP}}');
    expect(index.problems('main.typ')).toEqual([]);
    expect(index.citationKeys('main.typ')).toEqual(['knuth']);
  });

  it('only count the bibliographies the book names', () => {
    const index = book({ 'src/main.typ': '#include "back/refs.typ"\n@knuth @lamport', 'src/back/refs.typ': '#bibliography("/refs.bib")' }, 'src');
    expect(index.bibliographyFiles('src/main.typ')).toEqual({ files: ['src/refs.bib'], unknown: false });
    index.setBibliography('src/refs.bib', '@book{knuth, title={TAOCP}}');
    index.setBibliography('other.bib', '@book{lamport, title={LaTeX}}');
    expect(index.problems('src/main.typ').map((p) => p.name)).toEqual(['lamport']);
  });

  it('follow the files as they change', () => {
    const index = book(files);
    index.setFile('chapters/two.typ', '= Matrices <ch:matrices>\nAs in @fig:arrow.\n');
    expect(index.problems('main.typ').map((p) => p.name)).toEqual(['ch:vectr']);
    index.setFile('chapters/one.typ', null);
    expect(index.problems('main.typ').map((p) => p.name)).toEqual(['fig:arrow']);
  });

  it('say what’s wrong, as the editor marks an error', () => {
    const [vectr, broken, gone] = book(files).problems('main.typ');
    expect(refMessage(vectr)).toBe('There’s no <ch:vectr> in the book, so this reference goes nowhere. Did you mean @ch:vectors? Until it’s fixed, the preview shows it in red, and the book won’t export.');
    expect(refMessage(broken)).toBe('There’s no <BROKEN> in the book, so this reference goes nowhere. Until it’s fixed, the preview shows it in red, and the book won’t export.');
    expect(refMessage(gone)).toMatch(/^There’s no <gone> in the book, so this link goes nowhere\./);
    expect(refDiagnostic(vectr)).toEqual({ range: { start: { line: 2, character: 20 }, end: { line: 2, character: 29 } }, message: refMessage(vectr), severity: 1, source: 'Foreword' });
    const [email] = book({ 'main.typ': 'Write to jj@example.com.' }).problems('main.typ');
    expect(refMessage(email)).toMatch(/^Typst reads the @ here as a reference, to <example.com>, which isn’t in the book. To write an email address, put a \\ before the @\./);
  });
});

describe('the preview’s guard', () => {
  it('sets references to missing labels in red, leaving citations to Typst', () => {
    const guard = refGuard(['knuth', 'say "hi"']);
    expect(guard).not.toContain('\n');
    expect(guard).toContain('#show ref: it => if it.element == none and str(it.target) not in ("knuth", "say \\"hi\\"") {');
    expect(guard).toContain('#show link: it => if type(it.dest) == label {');
    expect(refGuard(['one'])).toContain('not in ("one",)');
    expect(refGuard([])).toContain('not in ()');
  });

  it('comes before the main file in the book’s preview', () => {
    const text = bookPreviewText('src/main.typ', []);
    expect(text.split('\n')).toEqual(["// Foreword's preview of src/main.typ. Foreword writes this; changes here are lost.", refGuard([]), '#include "main.typ"', '']);
  });

  it('knows a jump into it', () => {
    const text = bookPreviewText('main.typ', ['a']);
    expect(inRefGuard(text, ['a'], 1, 40)).toBe(true);
    expect(inRefGuard(text, ['a'], 2, 3)).toBe(false);
    const chapter = `${refGuard([])}/* Foreword's chapter preview */#import "x.typ"\n= One`;
    expect(inRefGuard(chapter, [], 0, 10)).toBe(true);
    expect(inRefGuard(chapter, [], 0, refGuard([]).length + 2)).toBe(false);
    expect(inRefGuard(chapter, ['changed'], 0, 10)).toBe(false);
  });
});
