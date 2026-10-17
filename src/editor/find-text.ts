// Find text that was selected in the preview inside its Typst source: compare
// ignoring whitespace and the markup characters the preview doesn't show
// (_emphasis_, *strong*, $math$, #, \\ escapes). Returns source offsets.

const MARKUP = new Set(['_', '*', '$', '#', '\\', '`']);

/** Squash a string to comparable characters, remembering where each came from. */
function squash(text: string, skipMarkup: boolean): { chars: string; at: number[] } {
  let chars = '';
  const at: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) {
      space = chars.length > 0;
      continue;
    }
    if (skipMarkup && MARKUP.has(c)) continue;
    if (space) {
      chars += ' ';
      at.push(i);
      space = false;
    }
    chars += c.toLowerCase();
    at.push(i);
  }
  return { chars, at };
}

/** Typographic characters in the preview that are plain in the source. */
const plain = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/—/g, '---').replace(/–/g, '--').replace(/…/g, '...');

/**
 * Offsets [start, end) of `selected` in `source`, preferring the match closest
 * to `near` (an offset, e.g. where the preview click mapped to); null if absent.
 */
export function findInSource(source: string, selected: string, near = 0): [number, number] | null {
  const hay = squash(source, true);
  const needle = squash(plain(selected), true).chars;
  if (!needle) return null;
  let best: [number, number] | null = null;
  let bestDistance = Infinity;
  for (let i = hay.chars.indexOf(needle); i >= 0; i = hay.chars.indexOf(needle, i + 1)) {
    const start = hay.at[i];
    const end = hay.at[i + needle.length - 1] + 1;
    const distance = Math.abs(start - near);
    if (distance < bestDistance) [best, bestDistance] = [[start, end], distance];
  }
  return best;
}

/**
 * When the whole selection can't be found (it spans math, which the preview
 * shows as symbols): the longest start of it and the longest end of it that
 * do appear, at least `min` characters each, in order. Null if neither part
 * is found.
 */
export function findPartial(source: string, selected: string, near = 0, min = 8): [number, number] | null {
  const hay = squash(source, true);
  const needle = squash(plain(selected), true).chars;
  if (needle.length < min) return null;
  const closest = (part: string, after = 0): number => {
    let best = -1;
    for (let i = hay.chars.indexOf(part, after); i >= 0; i = hay.chars.indexOf(part, i + 1)) {
      if (best < 0 || Math.abs(hay.at[i] - near) < Math.abs(hay.at[best] - near)) best = i;
    }
    return best;
  };
  let startAt = -1;
  let startLen = needle.length;
  for (; startLen >= min && startAt < 0; startLen--) startAt = closest(needle.slice(0, startLen));
  if (startAt < 0) return null;
  startLen++;
  let endAt = -1;
  let endLen = needle.length - startLen;
  for (; endLen >= min && endAt < 0; endLen--) endAt = closest(needle.slice(needle.length - endLen), startAt + startLen);
  const start = hay.at[startAt];
  const end = endAt >= 0 ? hay.at[endAt + endLen] + 1 : hay.at[startAt + startLen - 1] + 1;
  return [start, end];
}
