// What the editor shows of a definition while ⌘ is held over a name defined
// elsewhere (Go to Definition). Tinymist only says where the name is.

/**
 * The lines (0-based, inclusive) to show for the definition whose name is on
 * `line`: the doc comments (`///`) just above it, then the definition to where
 * its brackets close; only its first line when all that is over `max` lines.
 */
export function definitionPreview(lines: readonly string[], line: number, max = 7): { from: number; to: number } {
  let from = line;
  while (from > 0 && line - from < max - 1 && /^\s*\/\/\//.test(lines[from - 1])) from--;
  let depth = 0;
  for (let i = line; i < lines.length && i - from < max; i++) {
    depth += netBrackets(lines[i]);
    if (depth <= 0) return { from, to: i };
  }
  return { from, to: line };
}

/**
 * The lines (0-based, inclusive) to show for a whole file, named by its path
 * (`#include "chapters/one.typ"`): from its first heading near the top, or its
 * first line with text when it has none, `max` lines at most.
 */
export function filePreview(lines: readonly string[], max = 7): { from: number; to: number } {
  let from = lines.slice(0, 30).findIndex((l) => /^\s*=+\s/.test(l));
  if (from < 0) from = Math.max(0, lines.findIndex((l) => l.trim()));
  let to = Math.min(lines.length - 1, from + max - 1);
  while (to > from && !lines[to].trim()) to--;
  return { from, to };
}

/** Brackets opened on a line less those closed, outside strings and `//` comments. */
function netBrackets(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '/' && text[i + 1] === '/') {
      break;
    } else if (c === '(' || c === '[' || c === '{') {
      n++;
    } else if (c === ')' || c === ']' || c === '}') {
      n--;
    }
  }
  return n;
}
