// A Typst file in the preview on its own, instead of the book: a cover, a
// title page tried out, a scratch file. The book (all of it, or one chapter)
// is what the preview shows first; these are the others it can show. Pure;
// studio.ts keeps each file's imports and includes (refreshNames).
import { resolveRef } from './references';
import type { FileUses } from './snippet-book';

/** The book's Typst files: the main file and what it includes and imports, however deep. */
export function bookFiles(entry: string, uses: (path: string) => FileUses | undefined, root: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const u = uses(file);
    if (!u) return;
    for (const spec of [...u.includes, ...u.imports.map((i) => i.spec)]) {
      const next = resolveRef(file, spec, root);
      if (next) visit(next);
    }
  };
  visit(entry);
  return seen;
}

/** Foreword's own files (the chapter preview's, the print wrapper's): in a folder or with a name that starts with a dot. */
const hidden = (path: string) => path.split('/').some((part) => part.startsWith('.'));

/**
 * The Typst files to offer in the preview on their own: not the book's, not
 * Foreword's, and not imported by another file (a module of definitions, as
 * a cover's design.typ, typesets as a blank page). A cover the preview
 * includes stays: it's a document of its own. In path order.
 */
export function filesOutsideBook(files: readonly string[], entry: string | null, uses: (path: string) => FileUses | undefined, root: string): string[] {
  const typ = files.filter((f) => f.endsWith('.typ') && !hidden(f));
  const book = entry ? bookFiles(entry, uses, root) : new Set<string>();
  const imported = new Set(typ.flatMap((f) => (uses(f)?.imports ?? []).flatMap((i) => resolveRef(f, i.spec, root) ?? [])));
  return typ.filter((f) => f !== entry && !book.has(f) && !imported.has(f)).sort((a, b) => a.localeCompare(b));
}

/** Whether a file can be shown in the preview on its own: any Typst file but the main file and Foreword's own. */
export function canPreviewAlone(path: string, entry: string | null): boolean {
  return path.endsWith('.typ') && path !== entry && !hidden(path);
}

/**
 * Where paths starting with "/" begin for a file shown alone: the book's
 * Typst root if the file is in it, else the folder opened (a cover in
 * cover/, beside the book's src/, reaches into it with "../src/…").
 */
export function aloneRoot(path: string, typstRoot: string): string {
  return typstRoot && path.startsWith(`${typstRoot}/`) ? typstRoot : '';
}
