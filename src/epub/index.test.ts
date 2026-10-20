import { describe, expect, it } from 'vitest';
import { chapterHead, didntCarryOver, epubSource, extractImages, fixedFor, fixedPage, linkParts, mathHeavy, navPage, packageOpf, splitBook, toXhtml, uniqueSvgIds } from '.';

describe('the main file for the reflowing export', () => {
  it('puts the e-reader rules first and a marker before each chapter it includes', () => {
    const { source, chapters } = epubSource('#import "style.typ": book\n#show: book.with(title: "X")\n\n#include "chapters/01.typ"\n  #include "chapters/02.typ"\n// #include "draft.typ" is a comment\n');
    expect(chapters).toBe(2);
    expect(source.startsWith("// Typst Studio's EPUB export")).toBe(true);
    expect(source).toContain('#show math.equation.where(block: true): it => html.elem("div", attrs: (class: "equation"), html.frame(it))');
    expect(source).toContain('#html.elem("hr", attrs: (class: "epub-chapter", "data-file": "chapters/01.typ"))\n#include "chapters/01.typ"');
    expect(source).toContain('  #html.elem("hr", attrs: (class: "epub-chapter", "data-file": "chapters/02.typ"))\n  #include "chapters/02.typ"');
    expect(source).toContain('// #include "draft.typ" is a comment');
  });

  it('marks chapters included in code too, keeping the markup around them', () => {
    const main = '#{\n  set heading(numbering: none)\n  include "front/preface.typ"\n}\n#book-chapter(include "chapters/ch01.typ")\nSee #include "notes.typ" here.';
    const { source, chapters } = epubSource(main);
    expect(chapters).toBe(3);
    expect(source).toContain('#{\n  set heading(numbering: none)\n  [#html.elem("hr", attrs: (class: "epub-chapter", "data-file": "front/preface.typ"))#include "front/preface.typ"]\n}');
    expect(source).toContain('#book-chapter([#html.elem("hr", attrs: (class: "epub-chapter", "data-file": "chapters/ch01.typ"))#include "chapters/ch01.typ"])');
    expect(source).toContain('See #html.elem("hr", attrs: (class: "epub-chapter", "data-file": "notes.typ"))#include "notes.typ" here.');
  });
});

describe('which kind of EPUB', () => {
  it('fixed layout without asking for a picture book or a paper', () => {
    expect(fixedFor({ files: ['main.typ', 'story.typ'], main: '' })).toMatch(/picture book/);
    expect(fixedFor({ files: ['main.typ', 'refs.bib'], main: '= Intro\n#bibliography("refs.bib")' })).toMatch(/paper/);
    // A book with chapters and a bibliography is a book.
    expect(fixedFor({ files: ['main.typ', 'refs.bib'], main: '#include "chapters/01.typ"' })).toBeNull();
    expect(fixedFor({ files: ['main.typ'], main: '#include "chapters/01.typ"' })).toBeNull();
    expect(fixedFor({ files: ['main.typ', 'refs.bib'], main: '#book-chapter(include "chapters/01.typ")\n#bibliography("refs.bib")' })).toBeNull();
  });

  it('math on most pages', () => {
    const p = '<p>Text.</p>';
    expect(mathHeavy(p.repeat(40) + '<span class="math"></span>'.repeat(10))).toBe(false);
    expect(mathHeavy(p.repeat(40) + '<span class="math"></span>'.repeat(20) + '<div class="equation"></div>'.repeat(20))).toBe(true);
    expect(mathHeavy(p.repeat(400) + '<span class="math"></span>'.repeat(40))).toBe(false);
  });
});

const doc = (body: string) => `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><title>Strange Case</title></head><body>${body}</body></html>`;

describe('splitting the book into chapters', () => {
  it('at the markers: the front matter, then each chapter with its file', () => {
    const book = splitBook(doc('<p>Title page</p><hr class="epub-chapter" data-file="chapters/01.typ"><div><p>CHAPTER 1</p></div><p>One.</p><hr class="epub-chapter" data-file="chapters/02.typ"><p>Two.</p>'))!;
    expect(book.lang).toBe('en-GB');
    expect(book.title).toBe('Strange Case');
    expect(book.front).toBe('<p>Title page</p>');
    expect(book.chapters).toEqual([
      { file: 'chapters/01.typ', body: '<div><p>CHAPTER 1</p></div><p>One.</p>' },
      { file: 'chapters/02.typ', body: '<p>Two.</p>' },
    ]);
  });

  it('not when a marker is inside an element (the halves wouldn’t be whole)', () => {
    expect(splitBook(doc('<div class="book"><hr class="epub-chapter" data-file="a.typ"><p>A</p></div>'))).toBeNull();
    // Empty elements and pictures don't count as open.
    expect(splitBook(doc('<p>x<br>y<img src="a.png"></p><svg><path d="M0"/></svg><hr class="epub-chapter" data-file="a.typ"><p>A</p>'))?.chapters).toHaveLength(1);
  });

  it('no markers: one part', () => {
    expect(splitBook(doc('<p>All of it.</p>'))).toEqual({ lang: 'en-GB', title: 'Strange Case', front: '<p>All of it.</p>', chapters: [] });
  });
});

describe('Typst’s HTML as an EPUB’s XHTML', () => {
  it('closes empty elements and spells out named entities', () => {
    expect(toXhtml('<p>a<br>b&nbsp;c &amp; d</p><img src="x.png" alt="x"><hr class="y"><svg><path d="M0"/></svg>')).toBe('<p>a<br/>b&#160;c &amp; d</p><img src="x.png" alt="x"/><hr class="y"/><svg><path d="M0"/></svg>');
  });

  it('gives each picture its own ids', () => {
    const two = '<svg><symbol id="g1"/><use xlink:href="#g1"/></svg><p>x</p><svg><symbol id="g1"/><use xlink:href="#g1" fill="url(#p)"/></svg>';
    expect(uniqueSvgIds(two, 'c1-')).toBe('<svg><symbol id="c1-1-g1"/><use xlink:href="#c1-1-g1"/></svg><p>x</p><svg><symbol id="c1-2-g1"/><use xlink:href="#c1-2-g1" fill="url(#c1-2-p)"/></svg>');
  });

  it('takes pictures out of the HTML into files of their own', () => {
    const { html, images } = extractImages('<img src="data:image/png;base64,iVBOR"><svg><image xlink:href="data:image/svg+xml;base64,PHN2Zz4="/></svg><img src="data:text/plain;base64,eA==">', 4);
    expect(html).toBe('<img src="images/image-5.png"><svg><image xlink:href="images/image-6.svg"/></svg><img src="data:text/plain;base64,eA==">');
    expect(images).toEqual([
      { name: 'images/image-5.png', mediaType: 'image/png', base64: 'iVBOR' },
      { name: 'images/image-6.svg', mediaType: 'image/svg+xml', base64: 'PHN2Zz4=' },
    ]);
  });
});

describe('a chapter’s heading', () => {
  it('a book’s own drawn heading becomes an h1, its label above the title', () => {
    expect(chapterHead('<div><p>CHAPTER 1</p><p>Story of the Door</p></div><p>Mr. Utterson…</p>', 'Story of the Door')).toBe(
      '<h1 class="chapter-head"><span class="chapter-label">CHAPTER 1</span><br/>Story of the Door</h1><p>Mr. Utterson…</p>',
    );
    expect(chapterHead('<p>Remarkable Incident of Dr.&#160;Lanyon</p><p>Text</p>', 'Remarkable Incident of Dr.\u00a0Lanyon')).toBe('<h1 class="chapter-head">Remarkable Incident of Dr.&#160;Lanyon</h1><p>Text</p>');
  });

  it('keeps the ids links point to', () => {
    expect(chapterHead('<div id="loc-3"><p>2</p><p id="t">On Smallness</p></div>', 'On Smallness')).toBe('<h1 class="chapter-head" id="loc-3"><span class="chapter-label">2</span><br/><span id="t">On Smallness</span></h1>');
  });

  it('leaves a part alone when it doesn’t open with its title, or opens with a real heading', () => {
    const body = '<p>It was a dark night.</p><div><p>Story of the Door</p></div>';
    expect(chapterHead(body, 'Story of the Door')).toBe(body);
    expect(chapterHead('<h2>Story of the Door</h2><p>x</p>', 'Story of the Door')).toBe('<h2>Story of the Door</h2><p>x</p>');
    expect(chapterHead('<div><div><p>Story of the Door</p></div></div>', 'Story of the Door')).toBe('<div><div><p>Story of the Door</p></div></div>');
  });
});

describe('links once the book is split', () => {
  it('go to the part with their place; a place that’s gone keeps the text; pictures keep their own', () => {
    const parts = [
      '<p>See <a href="#eq-1">(1)</a> and <a href="#gone">here</a> and <a class="x" href="#intro">above</a>.</p><h2 id="intro">Intro</h2>',
      '<p id="eq-1">One.</p><svg><use xlink:href="#s1-g1"/></svg><a href="https://typst.app">Typst</a>',
    ];
    expect(linkParts(parts, ['chapter-01.xhtml', 'chapter-02.xhtml'])).toEqual([
      '<p>See <a href="chapter-02.xhtml#eq-1">(1)</a> and <a>here</a> and <a class="x" href="#intro">above</a>.</p><h2 id="intro">Intro</h2>',
      '<p id="eq-1">One.</p><svg><use xlink:href="#s1-g1"/></svg><a href="https://typst.app">Typst</a>',
    ]);
  });
});

describe('what didn’t carry over', () => {
  it('in plain words, once each, leaving out what doesn’t show', () => {
    expect(
      didntCarryOver([
        'html export is under active development and incomplete',
        'align was ignored during HTML export',
        'align was ignored during HTML export',
        'page set rule was ignored during HTML export',
        'flush was ignored during HTML export',
        'pagebreak was ignored during HTML export',
        'curve was ignored during HTML export',
      ]),
    ).toEqual(['centred and right-aligned lines', 'the page size and margins (each reader sets its own)', 'page breaks (each chapter still starts on a new page)', 'curve']);
  });
});

describe('the package and its pages', () => {
  it('names the book, lists its files, and orders the spine; fixed layout says so', () => {
    const opf = packageOpf({
      id: 'urn:uuid:1',
      title: 'Jekyll & Hyde',
      author: 'R. L. Stevenson',
      lang: 'en',
      modified: new Date('2026-10-19T10:00:00.123Z'),
      fixed: true,
      items: [
        { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' },
        { id: 'page-1', href: 'page-001.xhtml', mediaType: 'application/xhtml+xml', spine: true },
      ],
    });
    expect(opf).toContain('<dc:title>Jekyll &amp; Hyde</dc:title>');
    expect(opf).toContain('<dc:creator>R. L. Stevenson</dc:creator>');
    expect(opf).toContain('<meta property="dcterms:modified">2026-10-19T10:00:00Z</meta>');
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');
    expect(opf).toContain('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
    expect(opf).toMatch(/<spine>\s*<itemref idref="page-1"\/>\s*<\/spine>/);
    expect(packageOpf({ id: 'x', title: 't', author: null, lang: 'en', modified: new Date(), fixed: false, items: [] })).not.toMatch(/dc:creator|rendition/);
  });

  it('a contents page, and a fixed page at its own size in CSS pixels', () => {
    expect(navPage({ lang: 'en', entries: [{ title: 'Story of the Door', href: 'chapter-01.xhtml' }] })).toContain('<nav epub:type="toc" id="toc">\n<h1>Contents</h1>\n<ol>\n<li><a href="chapter-01.xhtml">Story of the Door</a></li>');
    const page = fixedPage({ n: 3, lang: 'en', image: 'images/page-003.svg', width: 432, height: 648 });
    expect(page).toContain('<meta name="viewport" content="width=576, height=864"/>');
    expect(page).toContain('<img src="images/page-003.svg" alt="Page 3"/>');
  });
});
