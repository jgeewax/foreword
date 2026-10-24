// References that go nowhere: `@intro` when nothing in the book is labelled
// <intro> (a typo, or a label renamed or deleted since), or when two things
// are. Typst stops typesetting at the first one, and the preview stops with
// it. So the preview's main file starts with show rules (refGuard) that set
// such a reference as its own text, in red, and the rest of the book still
// shows. Typst doesn't say where they are then, so the editor marks them
// from the text (RefIndex.problems), read the way Typst reads it, as
// includes.ts does: a reference in a comment, raw text, maths or a string
// isn't one. Pure; studio.ts reads the files and shows what it finds.
import type { LspDiagnostic } from '../editor/lsp-convert';
import { scanIncludes } from './includes';
import { resolveRef } from './references';

// What a label's name is made of; a reference leaves a final "." or ":" out of it.
const NAME = /[\p{L}\p{M}\p{N}_:.-]+/uy;
const IDENT = /[\p{L}_][\p{L}\p{N}_-]*/uy;
const LABEL_NAME = /^[\p{L}\p{M}\p{N}_:.-]+$/u;
// Keywords that start a statement running to the end of the line after a # in markup.
const STATEMENT = new Set(['let', 'set', 'show', 'include', 'import', 'if', 'for', 'while', 'context', 'return']);
// Calls whose label is a reference: ref(<x>), link(<x>), and the book's own …ref(<x>), as chapref.
const REF_CALL = /^(?:ref|link|[\p{L}_][\p{L}\p{N}_-]*ref)$/iu;
const BIBLIOGRAPHY_FILE = /\.(?:bib|ya?ml)$/i;

/** A reference: the label it names, and where it is (offsets: from its `@`, or the `<…>` given to a call). */
export type RefAt = { name: string; start: number; end: number; link: boolean; email: boolean };

/** What a Typst file says about labels. */
export type RefScan = {
  /** The labels it puts on things: `= Intro <intro>`, `#figure(…) <fig-1>`. */
  labels: { name: string; start: number; end: number }[];
  /** Its references: `@intro` in markup, or a label given to ref(…), link(…) or a function named …ref, as `chapref(<intro>)`. */
  refs: RefAt[];
  /**
   * Strings in its code that could be a label's name. A function that labels
   * what it's given (`#theorem("thm-1")[…]`, with label(name) inside) makes
   * labels the text doesn't show.
   */
  names: string[];
  /** label("fig-" + …): any label whose name starts so may be made. */
  prefixes: string[];
  /** The files its bibliography(…) calls name, as written; null when one names them some other way (a variable, bytes). */
  bibliographies: string[] | null;
};

/** The labels, references and bibliography files in a Typst file. */
export function scanRefs(text: string): RefScan {
  const s = text;
  const out: RefScan = { labels: [], refs: [], names: [], prefixes: [], bibliographies: [] };
  const match = (re: RegExp, i: number) => ((re.lastIndex = i), re.exec(s)?.[0] ?? null);
  const until = (i: number, end: string) => ((i = s.indexOf(end, i)) < 0 ? s.length : i);
  // The name of a `<label>` at i, or null.
  const label = (i: number) => {
    const name = s[i] === '<' ? match(NAME, i + 1) : null;
    return name && s[i + 1 + name.length] === '>' ? name : null;
  };

  // Past a comment, raw text or maths at i; i itself if there's none.
  const skip = (i: number, code: boolean): number => {
    const [c, d] = [s[i], s[i + 1]];
    if (c === '/' && d === '*') return until(i + 2, '*/') + 2;
    // In markup, the // of a link (https://…) isn't a comment.
    if (c === '/' && d === '/' && (code || s[i - 1] !== ':')) return until(i, '\n');
    if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      return n === 2 ? i + 2 : until(i + n, '`'.repeat(n)) + n;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < s.length && s[j] !== '$') j += s[j] === '\\' ? 2 : 1;
      return j + 1;
    }
    return i;
  };

  // Markup up to its closing ']' (or the end): returns the index after it.
  const markup = (i: number, close: string): number => {
    while (i < s.length) {
      const c = s[i];
      if (c === close) return i + 1;
      const j = skip(i, false);
      if (j !== i) i = j;
      else if (c === '\\') i += 2;
      else if (c === '[') i = markup(i + 1, ']');
      else if (c === '#') i = embedded(i + 1);
      else if (c === '@' && match(NAME, i + 1)) {
        const name = match(NAME, i + 1)!.replace(/[.:]+$/, '');
        // jj@example.com is a reference too, to <example.com>.
        const email = name.includes('.') && /[\p{L}\p{N}._%+-]/u.test(s[i - 1] ?? '');
        if (name) out.refs.push({ name, start: i, end: i + 1 + name.length, link: false, email });
        i += 1 + Math.max(name.length, 1);
      } else if (c === '<' && label(i)) {
        const name = label(i)!;
        out.labels.push({ name, start: i, end: i + name.length + 2 });
        i += name.length + 2;
      } else i++;
    }
    return i;
  };

  // What follows a # in markup: a block, a statement (#let …, #show …), or a call chain (#figure(…)[…]).
  const embedded = (i: number): number => {
    if (s[i] === '{') return code(i + 1, '}', null);
    if (s[i] === '(') return code(i + 1, ')', null);
    if (s[i] === '[') return markup(i + 1, ']');
    let name = match(IDENT, i);
    if (!name) return i;
    if (STATEMENT.has(name)) return code(i, '\n', null);
    for (i += name.length; ; ) {
      if (s[i] === '(') i = call(i, name);
      else if (s[i] === '[') i = markup(i + 1, ']');
      else if (s[i] === '.' && match(IDENT, i + 1)) i += 1 + (name = match(IDENT, i + 1)!).length;
      else return i;
    }
  };

  // The arguments of a call to `name`, from its '(' at i: the index after them.
  const call = (i: number, name: string): number => {
    if (name !== 'bibliography') return code(i + 1, ')', name);
    const named = out.bibliographies?.length ?? 0;
    const end = code(i + 1, ')', name);
    if (out.bibliographies && out.bibliographies.length === named) out.bibliographies = null;
    return end;
  };

  // Code up to its closing '}' or ')' (or, for a statement in markup, the line's end): returns the index after it. `args`: the call these are the arguments of.
  const code = (i: number, close: string, args: string | null): number => {
    while (i < s.length) {
      const c = s[i];
      if (c === close) return close === '\n' ? i : i + 1;
      if (close === '\n' && (c === ';' || c === ']' || c === '}' || c === ')')) return c === ';' ? i + 1 : i;
      const j = skip(i, true);
      if (j !== i) i = j;
      else if (c === '"') {
        let end = i + 1;
        while (end < s.length && s[end] !== '"' && s[end] !== '\n') end += s[end] === '\\' ? 2 : 1;
        const value = s.slice(i + 1, end);
        if (args === 'bibliography') {
          if (BIBLIOGRAPHY_FILE.test(value)) out.bibliographies?.push(value);
        } else if (LABEL_NAME.test(value)) {
          out.names.push(value);
          if (args === 'label' && /^\s*\+/.test(s.slice(end + 1, end + 16))) out.prefixes.push(value);
        }
        i = end + 1;
      } else if (c === '{') i = code(i + 1, '}', null);
      // An array or parentheses in a call's arguments: still its arguments (`bibliography(("a.bib", "b.bib"))`).
      else if (c === '(') i = code(i + 1, ')', args);
      else if (c === '[') i = markup(i + 1, ']');
      else if (c === '<' && label(i)) {
        const name = label(i)!;
        if (args && REF_CALL.test(args)) out.refs.push({ name, start: i, end: i + name.length + 2, link: args === 'link', email: false });
        i += name.length + 2;
      } else if (match(IDENT, i)) {
        const name = match(IDENT, i)!;
        i += name.length;
        if (s[i] === '(') i = call(i, name);
      } else i++;
    }
    return i;
  };

  markup(0, '');
  return out;
}

/** A bibliography file's keys: BibTeX's `@book{key,`, or Hayagriva's (YAML) entries, each a key at the start of a line. */
export function bibliographyKeys(path: string, text: string): string[] {
  if (/\.bib$/i.test(path)) {
    return [...text.matchAll(/@([A-Za-z]+)\s*[{(]\s*([^\s,{}()]+)\s*,/g)].filter((m) => !/^(?:string|comment|preamble)$/i.test(m[1])).map((m) => m[2]);
  }
  return [...text.matchAll(/^(?:"([^"\n]+)"|'([^'\n]+)'|([^\s#'"-][^\n]*?))[ \t]*:[ \t]*(?:#.*)?$/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** A reference that goes nowhere: where it is (0-based, as LSP counts), and why. */
export type RefProblem = {
  path: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  name: string;
  /** No label has its name, or more than one thing has it. */
  why: 'missing' | 'twice';
  /** A label in the book with a name close to it, when it goes nowhere. */
  near: string | null;
  link: boolean;
  email: boolean;
};

type FileRefs = RefScan & { includes: string[]; lineStarts: number[] };

/**
 * The labels and references in a book's Typst files, file by file, as they
 * change, and its bibliographies' keys: which references go nowhere.
 * Paths are relative to the folder opened; `root` is the Typst root in it.
 */
export class RefIndex {
  private files = new Map<string, FileRefs>();
  private bibliographies = new Map<string, string[]>();

  constructor(readonly root = '') {}

  /** A Typst file's text now, or null when it's gone. */
  setFile(path: string, text: string | null) {
    if (text == null) return void this.files.delete(path);
    const includes = scanIncludes(text).flatMap(({ spec }) => resolveRef(path, spec, this.root) ?? []);
    const lineStarts = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
    this.files.set(path, { ...scanRefs(text), includes, lineStarts });
  }

  /** A bibliography file's text now, or null when it's gone or can't be read. */
  setBibliography(path: string, text: string | null) {
    if (text == null) this.bibliographies.delete(path);
    else this.bibliographies.set(path, bibliographyKeys(path, text));
  }

  /** Whether a bibliography file has been read (`setBibliography`). */
  hasBibliography(path: string): boolean {
    return this.bibliographies.has(path);
  }

  /** The main file and the files it includes, however deep, in reading order. */
  bookFiles(entry: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const visit = (path: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      const file = this.files.get(path);
      if (!file) return;
      out.push(path);
      file.includes.forEach(visit);
    };
    visit(entry);
    return out;
  }

  /**
   * The bibliography files the book's files name (book-relative), and whether
   * one names them some other way: then any bibliography file in the book
   * folder may be one.
   */
  bibliographyFiles(entry: string): { files: string[]; unknown: boolean } {
    const files = new Set<string>();
    let unknown = false;
    for (const path of this.bookFiles(entry)) {
      const named = this.files.get(path)!.bibliographies;
      if (!named) unknown = true;
      for (const spec of named ?? []) {
        const file = resolveRef(path, spec, this.root);
        if (file) files.add(file);
      }
    }
    return { files: [...files], unknown };
  }

  /** The keys of the bibliographies the book names (as `setBibliography` read them), sorted. */
  citationKeys(entry: string): string[] {
    const { files, unknown } = this.bibliographyFiles(entry);
    const keys = unknown ? [...this.bibliographies.values()].flat() : files.flatMap((f) => this.bibliographies.get(f) ?? []);
    return [...new Set(keys)].sort();
  }

  /** The references in the book's files that go nowhere, in reading order. */
  problems(entry: string): RefProblem[] {
    const book = this.bookFiles(entry);
    const cites = new Set(this.citationKeys(entry));
    // Put on something anywhere in the book folder (a template's file too), or could be.
    const labels = new Set<string>();
    const names = new Set<string>();
    const prefixes: string[] = [];
    for (const file of this.files.values()) {
      for (const l of file.labels) labels.add(l.name);
      for (const n of file.names) names.add(n);
      prefixes.push(...file.prefixes);
    }
    // How many things each label is put on, in the book itself.
    const times = new Map<string, number>();
    for (const path of book) for (const l of this.files.get(path)!.labels) times.set(l.name, (times.get(l.name) ?? 0) + 1);
    const known = (name: string) => {
      if (labels.has(name) || names.has(name) || prefixes.some((p) => name.startsWith(p))) return true;
      // A package that labels figures for you (i-figured): <fig-1> is referred to as @fig:fig-1.
      const colon = name.indexOf(':');
      return colon > 0 && labels.has(name.slice(colon + 1));
    };

    const out: RefProblem[] = [];
    for (const path of book) {
      const file = this.files.get(path)!;
      for (const ref of file.refs) {
        if (cites.has(ref.name)) continue;
        const why = (times.get(ref.name) ?? 0) > 1 ? 'twice' : known(ref.name) ? null : 'missing';
        if (!why) continue;
        const [line, character] = position(file.lineStarts, ref.start);
        const [endLine, endCharacter] = position(file.lineStarts, ref.end);
        const near = why === 'missing' && !ref.email ? nearest(ref.name, labels) : null;
        out.push({ path, line, character, endLine, endCharacter, name: ref.name, why, near, link: ref.link, email: ref.email });
      }
    }
    return out;
  }
}

/** An offset as a line and a character in it (0-based). */
function position(lineStarts: number[], offset: number): [number, number] {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return [lo, offset - lineStarts[lo]];
}

/** The label closest to `name` (a typo's worth of changes away at most), if any. */
function nearest(name: string, labels: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = Math.max(1, Math.floor(name.length / 3)) + 1;
  for (const l of labels) {
    if (Math.abs(l.length - name.length) >= bestDistance) continue;
    const d = distance(name, l);
    if (d < bestDistance || (d === bestDistance && best != null && l < best)) [best, bestDistance] = [l, d];
  }
  return best;
}

/** Edits from one word to another: letters added, removed, changed, or two side by side swapped. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/** What the editor says about a reference that goes nowhere. */
export function refMessage(p: RefProblem): string {
  const until = 'Until it’s fixed, the preview shows it in red, and the book won’t export.';
  if (p.email) return `Typst reads the @ here as a reference, to <${p.name}>, which isn’t in the book. To write an email address, put a \\ before the @. ${until}`;
  if (p.why === 'twice') return `More than one thing in the book is labelled <${p.name}>, so this ${p.link ? 'link' : 'reference'} can’t tell which one it means. ${until}`;
  const mean = p.near ? ` Did you mean ${p.link ? `<${p.near}>` : `@${p.near}`}?` : '';
  return `There’s no <${p.name}> in the book, so this ${p.link ? 'link' : 'reference'} goes nowhere.${mean} ${until}`;
}

/** A reference that goes nowhere, as the editor marks a Typst error. */
export function refDiagnostic(p: RefProblem): LspDiagnostic {
  return {
    range: { start: { line: p.line, character: p.character }, end: { line: p.endLine, character: p.endCharacter } },
    message: refMessage(p),
    severity: 1,
    source: 'Foreword',
  };
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// How a reference that goes nowhere looks in the preview: in red, on a pale red ground.
const mark = (body: string) => `highlight(fill: rgb("#e5484d2e"), radius: 1.5pt, extent: 1pt, text(fill: rgb("#d1242f"), ${body}))`;

/**
 * The show rules the preview's main file starts with, on one line: a
 * reference to a label the book doesn't have, or has more than once, is set
 * as its own text (`@intro`) in red, and a link to one as its words in red,
 * where Typst would stop typesetting the book. A citation (one of `keys`, the
 * bibliography's) has no label either, so it's left to Typst. Any change to
 * this text sets the whole book again, so it changes only with the keys.
 */
export function refGuard(keys: readonly string[]): string {
  const cites = `(${keys.map(quote).join(', ')}${keys.length === 1 ? ',' : ''})`;
  return (
    `#show ref: it => if it.element == none and str(it.target) not in ${cites} { box(${mark('"@" + str(it.target)')}) } else { it };` +
    `#show link: it => if type(it.dest) == label { context if query(it.dest).len() == 1 { it } else { ${mark('it.body')} } } else { it };`
  );
}

/**
 * The preview's main file while it shows the whole book: refGuard, then the
 * main file (`entry`, book-relative; this file is beside it) included as it
 * is. Tinymist still reads the main file as itself, so its errors and jumps
 * are its own.
 */
export function bookPreviewText(entry: string, keys: readonly string[]): string {
  const name = entry.slice(entry.lastIndexOf('/') + 1);
  return `// Foreword's preview of ${entry}. Foreword writes this; changes here are lost.\n${refGuard(keys)}\n#include ${quote(name)}\n`;
}

/**
 * Whether a place in the preview's main file (`text`; 0-based) is in its
 * refGuard: Tinymist's jump for a click on a reference set in red goes there,
 * where its text was made.
 */
export function inRefGuard(text: string, keys: readonly string[], line: number, character: number): boolean {
  const guard = refGuard(keys);
  const at = text.indexOf(guard);
  if (at < 0) return false;
  const lineStart = at === 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1;
  const guardLine = text.slice(0, at).split('\n').length - 1;
  const from = at - lineStart;
  return line === guardLine && character >= from && character < from + guard.length;
}
