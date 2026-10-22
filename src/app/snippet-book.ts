// What a Typst snippet shown outside the book (a formula in the chat, a block
// the assistant shows, an option to pick, a formula in What changed) needs
// to be set as the book sets it: the book's own definitions. A book brings
// those in with imports (`#import "../style.typ": *` at the top of each
// chapter), so a snippet is set after every top-level import of the main
// file and the files it includes, their paths made root-absolute since the
// snippet is set from the root. Pure; studio.ts keeps it up to date, and
// render.rs sets snippets beside the book's files with it in front.
import { scanUses, type ImportAt } from './includes';
import { resolveRef } from './references';

/** What a file imports and includes, as written. */
export type FileUses = { imports: ImportAt[]; includes: string[] };

export function fileUses(text: string): FileUses {
  const { imports, includes } = scanUses(text);
  return { imports, includes: includes.map((x) => x.spec) };
}

/** An import in `file` as a snippet at the Typst root writes it; null if what it imports isn't inside the root. */
export function importLine(file: string, { spec, rest }: ImportAt, root: string): string | null {
  if (spec.startsWith('@')) return `#import "${spec}"${rest}`;
  const path = resolveRef(file, spec, root);
  if (path == null) return null;
  const inRoot = !root ? path : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
  return inRoot == null ? null : `#import "/${inRoot}"${rest}`;
}

/** The imports of the main file and of every file it includes, however deep, each once, in order. */
export function snippetPrelude(entry: string, uses: (path: string) => FileUses | undefined, root: string): string {
  const lines = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    const u = uses(file);
    if (seen.has(file) || !u) return;
    seen.add(file);
    for (const i of u.imports) {
      const line = importLine(file, i, root);
      if (line) lines.add(line);
    }
    for (const spec of u.includes) {
      const included = resolveRef(file, spec, root);
      if (included) visit(included);
    }
  };
  visit(entry);
  return [...lines].join('\n');
}
