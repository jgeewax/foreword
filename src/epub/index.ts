// EPUB export: the book as an e-book, for Apple Books, Kobo, Google Play and
// Kindle (which takes EPUB now; MOBI is gone). Two kinds, picked per book:
//
// - Reflowing text, from Typst's HTML export: the reader sets the type size
//   and the text flows to fit. Right for prose. The main file is compiled with
//   rules for e-readers ahead of the book's own (math, grids and figures drawn
//   as pictures, no page references) and a marker before each chapter it
//   includes, where the book splits into the EPUB's chapters.
// - Fixed layout: every page exactly as typeset, as a picture. Right for
//   picture books, papers and books full of math, and whenever the reflowing
//   export fails.
//
// This file builds the EPUB's parts as text; epub.rs compiles the book and
// writes the zip.

import { scanIncludes } from '../app/includes';

export type EpubKind = 'reflow' | 'fixed';

/** One file in the EPUB: text, bytes (base64), or one of the export's own temporary files. */
export type EpubFile = { name: string; text?: string; base64?: string; temp?: string };

/** Rules ahead of the book's own, for the reflowing export: what HTML can't show is drawn as a picture. */
export const EPUB_RULES = `// Foreword's EPUB export: rules for e-readers, ahead of the book's own.
#show math.equation.where(block: true): it => html.elem("div", attrs: (class: "equation"), html.frame(it))
#show math.equation.where(block: false): it => html.elem("span", attrs: (class: "math"), html.frame(it))
#show ref: it => if it.form == "page" { none } else { it }
#show grid: it => html.frame(it)
#show figure.where(kind: image): it => html.elem("figure", { html.frame(it.body); if it.caption != none { html.elem("figcaption", it.caption) } })
`;

/**
 * The main file for the reflowing export: the rules first, and before each
 * chapter it includes a marker where the EPUB starts a new chapter. A
 * `#include "…"` gets the marker on the line before it; an `include "…"` in
 * code, as in `#chapter(include "…")`, becomes the marker and the chapter in
 * one content block, so the chapter's own markup around it still applies.
 */
export function epubSource(main: string): { source: string; chapters: number } {
  const includes = scanIncludes(main);
  let marked = '';
  let at = 0;
  for (const inc of includes) {
    const marker = `#html.elem("hr", attrs: (class: "epub-chapter", "data-file": "${inc.spec}"))`;
    if (inc.code) {
      marked += `${main.slice(at, inc.start)}[${marker}#${main.slice(inc.start, inc.end)}]`;
      at = inc.end;
    } else {
      const hash = inc.start - 1;
      const indent = main.slice(main.lastIndexOf('\n', hash - 1) + 1, hash);
      marked += `${main.slice(at, hash)}${marker}${/^[ \t]*$/.test(indent) ? `\n${indent}` : ''}`;
      at = hash;
    }
  }
  return { source: `${EPUB_RULES}\n${marked}${main.slice(at)}`, chapters: includes.length };
}

/** A book whose pages are its pictures, or a paper: fixed layout without asking (null: try reflowing text). */
export function fixedFor(book: { files: readonly string[]; main: string }): string | null {
  if (book.files.includes('story.typ') || /#(story-page|spread)\(/.test(book.main)) return 'it’s a picture book, so every page stays as drawn';
  const included = scanIncludes(book.main).length > 0;
  if (!included && (book.files.some((f) => f.endsWith('.bib')) || /bibliography\(/.test(book.main))) return 'it’s a paper, so every page stays as typeset';
  return null;
}

/** Math on most pages: e-readers can't reflow it, so fixed layout reads better. */
export function mathHeavy(html: string): boolean {
  const math = (html.match(/class="(?:math|equation)"/g) ?? []).length;
  const paragraphs = (html.match(/<p[\s>]/g) ?? []).length;
  return math >= 30 && math >= paragraphs * 0.3;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/** How deep in elements each position of `html` is, at the given offsets (to split only between whole elements). */
function depthsAt(html: string, offsets: readonly number[]): number[] {
  const out: number[] = [];
  let depth = 0;
  let k = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    while (k < offsets.length && offsets[k] <= m.index) out[k++] = depth;
    const [, close, name, , selfClose] = m;
    if (VOID.has(name.toLowerCase()) || selfClose) continue;
    depth += close ? -1 : 1;
  }
  while (k < offsets.length) out[k++] = depth;
  return out;
}

export type SplitBook = { lang: string; title: string | null; front: string; chapters: { file: string; body: string }[] };

/**
 * The HTML export as the EPUB's parts: what comes before the first chapter
 * (the title page, the contents…), then each chapter, at its marker. Null when
 * the markers aren't all between whole elements (the book wraps its chapters
 * in something), so it can't be split cleanly.
 */
export function splitBook(html: string): SplitBook | null {
  const lang = /<html[^>]*\blang="([^"]+)"/.exec(html)?.[1] ?? 'en';
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1]?.trim() || null;
  const bodyStart = html.search(/<body[^>]*>/);
  const bodyEnd = html.lastIndexOf('</body>');
  const body = bodyStart < 0 ? html : html.slice(html.indexOf('>', bodyStart) + 1, bodyEnd < 0 ? undefined : bodyEnd);
  const markers = [...body.matchAll(/<hr class="epub-chapter" data-file="([^"]*)">/g)];
  if (!markers.length) return { lang, title, front: body, chapters: [] };
  if (depthsAt(body, markers.map((m) => m.index!)).some((d) => d !== 0)) return null;
  const chapters = markers.map((m, i) => ({ file: m[1], body: body.slice(m.index! + m[0].length, i + 1 < markers.length ? markers[i + 1].index : body.length) }));
  return { lang, title, front: body.slice(0, markers[0].index), chapters };
}

/** Typst's HTML as XHTML (EPUB's content is XML): empty elements closed, named entities as characters. */
export function toXhtml(html: string): string {
  return html
    .replace(TAG, (tag, close: string, name: string, attrs: string, self: string) => (!close && !self && VOID.has(name.toLowerCase()) ? `<${name}${attrs.replace(/\s+$/, '')}/>` : tag))
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)([a-z]+);/gi, (m, name: string) => (NAMED[name] ? `&#${NAMED[name]};` : m));
}

const NAMED: Record<string, number> = { nbsp: 160, shy: 173, ndash: 8211, mdash: 8212, hellip: 8230, lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, thinsp: 8201, zwj: 8205, zwnj: 8204, copy: 169 };

/**
 * Each inline SVG's ids made its own (Typst gives every picture the same glyph
 * ids, and ids must be unique in a document), with the references to them.
 */
export function uniqueSvgIds(html: string, prefix: string): string {
  let n = 0;
  return html.replace(/<svg\b[\s\S]*?<\/svg>/g, (svg) => {
    const p = `${prefix}${++n}-`;
    return svg.replace(/\bid="([^"]+)"/g, `id="${p}$1"`).replace(/(xlink:href|href)="#([^"]+)"/g, `$1="#${p}$2"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`);
  });
}

/**
 * Links between the parts once the book is split: a link to a place in another
 * part goes to that part's file ("chapter-03.xhtml#eq-1"); one to a place that
 * isn't in the book any more keeps its text without the link. `files[i]` is
 * part i's file. Links inside pictures (their own ids) are left as they are.
 */
export function linkParts(parts: readonly string[], files: readonly string[]): string[] {
  const home = new Map<string, number>();
  parts.forEach((p, i) => {
    for (const m of p.matchAll(/\bid="([^"]+)"/g)) if (!home.has(m[1])) home.set(m[1], i);
  });
  return parts.map((p, i) =>
    p.replace(/<a\b([^>]*?)\shref="#([^"]*)"([^>]*)>/g, (tag, before: string, id: string, after: string) => {
      const at = home.get(id);
      if (at === i) return tag;
      return at === undefined ? `<a${before}${after}>` : `<a${before} href="${files[at]}#${id}"${after}>`;
    }),
  );
}

const plain = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#160;|&nbsp;|\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * A chapter's heading as a heading. A book that draws its own ("CHAPTER 1",
 * then the title, each in a paragraph) comes out of the HTML export as plain
 * paragraphs; when the part opens with a block that holds the chapter's title,
 * it becomes an <h1>, its first lines a label above the title.
 */
export function chapterHead(body: string, title: string): string {
  const m = /^\s*<(div|p)(\s[^>]*)?>((?:(?!<\/?div[\s>])[\s\S])*?)<\/\1>/.exec(body);
  if (!m || !title.trim() || /<(svg|img|figure|table|ul|ol)[\s>]/.test(m[3]) || !plain(m[3]).includes(plain(title))) return body;
  // Ids stay where they were (the contents and cross-references link to them).
  const id = (attrs = '') => {
    const v = /\sid="([^"]+)"/.exec(attrs)?.[1];
    return v ? ` id="${v}"` : '';
  };
  const lines = m[1] === 'div' ? [...m[3].matchAll(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/g)].map((x) => ({ id: id(x[1]), text: x[2] })) : [{ id: '', text: m[3] }];
  if (!lines.length) return body;
  const head = lines
    .map((l, i) => (i < lines.length - 1 ? `<span class="chapter-label"${l.id}>${l.text}</span><br/>` : l.id ? `<span${l.id}>${l.text}</span>` : l.text))
    .join('');
  return `${body.slice(0, m.index)}<h1 class="chapter-head"${id(m[2])}>${head}</h1>${body.slice(m.index + m[0].length)}`;
}

const EXT: Record<string, string> = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Pictures the HTML carries in itself (data: URLs), as files of the EPUB; the HTML points to them. */
export function extractImages(html: string, start: number): { html: string; images: { name: string; mediaType: string; base64: string }[] } {
  const images: { name: string; mediaType: string; base64: string }[] = [];
  const out = html.replace(/(src|xlink:href|href)="data:(image\/[\w+.-]+);base64,([^"]+)"/g, (m, attr: string, type: string, data: string) => {
    const ext = EXT[type];
    if (!ext) return m;
    const name = `images/image-${start + images.length + 1}.${ext}`;
    images.push({ name, mediaType: type, base64: data });
    return `${attr}="${name}"`;
  });
  return { html: out, images };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A content document: XHTML with the book's stylesheet. */
export function xhtmlPage(o: { title: string; lang: string; body: string; head?: string; type?: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(o.lang)}" xml:lang="${esc(o.lang)}">
<head>
<meta charset="utf-8"/>
<title>${esc(o.title)}</title>
${o.head ?? '<link rel="stylesheet" type="text/css" href="style.css"/>'}
</head>
<body${o.type ? ` epub:type="${o.type}"` : ''}>
${o.body}
</body>
</html>
`;
}

/** The reflowing book's look: the reader's own fonts and sizes, with what the book needs on top. */
export const EPUB_CSS = `body { margin: 0 5%; line-height: 1.45; }
p { margin: 0; text-indent: 1.3em; }
p:first-child, h1 + p, h2 + p, h3 + p, div + p, blockquote + p, figure + p, .equation + p { text-indent: 0; }
h1, h2, h3, h4 { line-height: 1.2; margin: 1.6em 0 0.8em; text-indent: 0; page-break-after: avoid; }
.chapter-head { text-align: center; font-weight: normal; font-size: 1.5em; margin: 2.5em 0 1.6em; }
.chapter-label { font-size: 0.55em; letter-spacing: 0.15em; text-transform: uppercase; }
blockquote { margin: 1em 2em; }
figure { margin: 1.2em 0; text-align: center; page-break-inside: avoid; }
figure svg, figure img { max-width: 100%; height: auto; }
figcaption { font-size: 0.9em; margin-top: 0.4em; }
img { max-width: 100%; }
.equation { margin: 0.8em 0; text-align: center; }
.equation svg { display: inline-block !important; max-width: 100%; }
.math svg { display: inline-block !important; vertical-align: -0.25em; }
table { border-collapse: collapse; margin: 1em auto; }
td, th { padding: 0.2em 0.5em; }
pre, code { font-family: monospace; }
pre { white-space: pre-wrap; font-size: 0.9em; }
`;

export const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

export type ManifestItem = { id: string; href: string; mediaType: string; properties?: string; spine?: boolean; spineProperties?: string };

/** The package document: what the EPUB is (title, author, language), what's in it, and in what order. */
export function packageOpf(o: { id: string; title: string; author: string | null; lang: string; modified: Date; fixed: boolean; items: ManifestItem[] }): string {
  const when = o.modified.toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${esc(o.lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${esc(o.id)}</dc:identifier>
    <dc:title>${esc(o.title)}</dc:title>
${o.author ? `    <dc:creator>${esc(o.author)}</dc:creator>\n` : ''}    <dc:language>${esc(o.lang)}</dc:language>
    <meta property="dcterms:modified">${when}</meta>
${o.fixed ? '    <meta property="rendition:layout">pre-paginated</meta>\n    <meta property="rendition:spread">auto</meta>\n' : ''}  </metadata>
  <manifest>
${o.items.map((i) => `    <item id="${i.id}" href="${esc(i.href)}" media-type="${i.mediaType}"${i.properties ? ` properties="${i.properties}"` : ''}/>`).join('\n')}
  </manifest>
  <spine>
${o.items
  .filter((i) => i.spine)
  .map((i) => `    <itemref idref="${i.id}"${i.spineProperties ? ` properties="${i.spineProperties}"` : ''}/>`)
  .join('\n')}
  </spine>
</package>
`;
}

/** The contents (EPUB's navigation document). */
export function navPage(o: { lang: string; entries: { title: string; href: string }[] }): string {
  const items = o.entries.map((e) => `<li><a href="${esc(e.href)}">${esc(e.title)}</a></li>`).join('\n');
  return xhtmlPage({ title: 'Contents', lang: o.lang, head: '', body: `<nav epub:type="toc" id="toc">\n<h1>Contents</h1>\n<ol>\n${items}\n</ol>\n</nav>` });
}

/** What the reflowing export left behind, in plain words, from Typst's warnings ("align was ignored during HTML export"). */
export function didntCarryOver(warnings: readonly string[]): string[] {
  const ignored = new Set<string>();
  for (const w of warnings) {
    const m = /^(.+?) was ignored during HTML export/.exec(w);
    if (m) ignored.add(m[1].replace(/ set rule$/, ''));
  }
  const words: Record<string, string> = {
    align: 'centred and right-aligned lines',
    pagebreak: 'page breaks (each chapter still starts on a new page)',
    page: 'the page size and margins (each reader sets its own)',
    v: 'space set by hand between paragraphs',
    h: 'space set by hand within lines',
    place: 'things placed at a spot on the page',
    columns: 'columns',
    colbreak: 'column breaks',
    line: 'lines drawn in the text',
    flush: '',
    box: 'boxes around text',
    block: 'boxes around text',
    rect: 'shapes drawn in the text',
    pad: 'space set by hand around things',
  };
  return [...new Set([...ignored].map((x) => (x in words ? words[x] : x)).filter(Boolean))];
}

/** "chapter-07.xhtml". */
export const chapterFile = (n: number) => `chapter-${String(n).padStart(2, '0')}.xhtml`;

/** A fixed-layout page: the page's picture, at its own size. */
export function fixedPage(o: { n: number; lang: string; image: string; width: number; height: number }): string {
  // Points to CSS pixels.
  const w = Math.round((o.width * 4) / 3);
  const h = Math.round((o.height * 4) / 3);
  return xhtmlPage({
    title: `Page ${o.n}`,
    lang: o.lang,
    head: `<meta name="viewport" content="width=${w}, height=${h}"/>\n<style>html, body { margin: 0; padding: 0; } img { display: block; width: ${w}px; height: ${h}px; }</style>`,
    body: `<img src="${o.image}" alt="Page ${o.n}"/>`,
  });
}

/** A stable identifier for a book (from its folder): the same EPUB each time, updated in readers' libraries. */
export async function bookId(seed: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  const hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
