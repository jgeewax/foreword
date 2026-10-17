// File references inside Typst sources (#include, #import, image(...),
// bibliography(...), read/json/csv/…), so renaming or deleting a file keeps
// the book compiling. Typst resolves paths relative to the file they appear
// in, or to the Typst root when they start with "/". Paths here are relative
// to the folder opened; `root` is the Typst root within it ('' when it's the
// folder itself, "src" for a book in src/). Package imports ("@preview/…") are
// never touched.

const PATH_ARG = /(#include\s+|#import\s+|\b(?:image|read|json|csv|yaml|toml|xml|cbor|plugin|bibliography)\(\s*)"([^"\n]+)"/g;

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Normalize "a/./b/../c" → "a/c"; null if it climbs above the root. */
export function normalize(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

/** What a path string in `fromFile` points at (relative to the folder opened). */
export function resolveRef(fromFile: string, spec: string, root = ''): string | null {
  if (spec.startsWith('@')) return null;
  if (spec.startsWith('/')) return normalize(root ? `${root}/${spec.slice(1)}` : spec.slice(1));
  const dir = dirOf(fromFile);
  return normalize(dir ? `${dir}/${spec}` : spec);
}

/** A relative path from the folder of `fromFile` to `target`. */
export function relativeRef(fromFile: string, target: string): string {
  const from = dirOf(fromFile).split('/').filter(Boolean);
  const to = target.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

const inside = (path: string, target: string) => path === target || path.startsWith(`${target}/`);

/**
 * Point references at `oldPath` (a file, or anything inside a folder) to
 * `newPath`, in a file that may itself have moved (`filePath` is its new
 * location, `fileWas` its old one). Keeps the author's style: root-absolute
 * stays root-absolute.
 */
export function updateReferences(text: string, filePath: string, oldPath: string, newPath: string, fileWas = filePath, root = ''): { text: string; count: number } {
  let count = 0;
  const out = text.replace(PATH_ARG, (whole, call: string, spec: string) => {
    const target = resolveRef(fileWas, spec, root);
    if (target == null) return whole;
    const moved = inside(target, oldPath) ? newPath + target.slice(oldPath.length) : target;
    // Unchanged target in an unmoved file: leave it exactly as written.
    if (moved === target && fileWas === filePath) return whole;
    const underRoot = !root || inside(moved, root);
    const next = spec.startsWith('/') && underRoot ? `/${root ? moved.slice(root.length + 1) : moved}` : relativeRef(filePath, moved);
    if (next === spec) return whole;
    count++;
    return `${call}"${next}"`;
  });
  return { text: out, count };
}

export type Reference = { line: number; text: string; wholeInclude: boolean };

/** Where a file mentions `target` (or anything inside it). */
export function referencesTo(text: string, filePath: string, target: string, root = ''): Reference[] {
  const refs: Reference[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(PATH_ARG)) {
      const t = resolveRef(filePath, m[2], root);
      if (t != null && inside(t, target)) refs.push({ line: i, text: line, wholeInclude: /^\s*#include\s+"[^"]+"\s*$/.test(line) });
    }
  });
  return refs;
}

/** Remove whole-line `#include` lines for `target` (used when a chapter is deleted). */
export function removeIncludes(text: string, filePath: string, target: string, root = ''): { text: string; count: number } {
  const lines = text.split('\n');
  const drop = new Set(referencesTo(text, filePath, target, root).filter((r) => r.wholeInclude).map((r) => r.line));
  return { text: lines.filter((_, i) => !drop.has(i)).join('\n'), count: drop.size };
}
