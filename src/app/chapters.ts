// "New Chapter": the chapter file (numbered like its neighbours, with the same
// #import lines) and the #include line in the main file, after the last
// chapter. Pure functions; Studio.addChapter does the file work.

/** Plain text as Typst markup: characters with a meaning get a backslash. */
export function escapeMarkup(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\*_#$@<`\[\]]/g, (c) => `\\${c}`)
    .replace(/^([=+-]|\d+\.)(?=\s)/, '\\$1');
}

/** "The Island, Part 2" → "the-island-part-2". */
export function slugify(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'chapter'
  );
}

/** Path for a new chapter: in the chapters folder, numbered after the highest existing number. */
export function nextChapterPath(files: string[], title: string, folder = 'chapters'): string {
  const inFolder = files.filter((f) => f.startsWith(`${folder}/`) && f.endsWith('.typ'));
  const numbered = inFolder.map((f) => /^(\d+)[-_ ]/.exec(f.slice(folder.length + 1))?.[1]).filter((n): n is string => !!n);
  const digits = numbered.length ? Math.max(2, ...numbered.map((n) => n.length)) : 2;
  const next = numbered.length ? Math.max(...numbered.map(Number)) + 1 : inFolder.length + 1;
  let path = `${folder}/${String(next).padStart(digits, '0')}-${slugify(title)}.typ`;
  for (let i = 2; files.includes(path); i++) path = path.replace(/(-\d+)?\.typ$/, `-${i}.typ`);
  return path;
}

/** The #import lines a chapter file starts with (e.g. `#import "../style.typ": *`). */
export function chapterImports(sample: string): string[] {
  return sample.split('\n').filter((l) => /^#import\s+"/.test(l.trim()));
}

export function chapterText(title: string, imports: string[]): string {
  return `${imports.length ? `${imports.join('\n')}\n\n` : ''}= ${escapeMarkup(title)}\n\n`;
}

/** `#include` path from the main file to the chapter (both relative to the book root). */
export function includePath(entry: string, chapter: string): string {
  const from = entry.split('/').slice(0, -1);
  const to = chapter.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

/** The main file's text with the chapter's #include added (see includeInsertion). */
export function withInclude(entryText: string, path: string): string {
  const { line, text } = includeInsertion(entryText, path);
  const lines = entryText.split('\n');
  lines.splice(line, 0, text);
  return lines.join('\n');
}

/**
 * Where the #include goes: after the last chapter #include; otherwise before
 * the bibliography; otherwise at the end. Returns the 0-based line index to
 * insert at, and the line.
 */
export function includeInsertion(entryText: string, path: string): { line: number; text: string } {
  const lines = entryText.split('\n');
  const text = `#include "${path}"`;
  let last = -1;
  lines.forEach((l, i) => {
    if (/^\s*#include\s+"/.test(l)) last = i;
  });
  if (last >= 0) return { line: last + 1, text };
  const bib = lines.findIndex((l) => /^\s*#bibliography\(/.test(l));
  if (bib >= 0) return { line: bib, text: `${text}\n` };
  const end = lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  return { line: end, text: `\n${text}` };
}
