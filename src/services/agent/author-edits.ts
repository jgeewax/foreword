// The author's changes to text the assistant wrote, for its next message:
// "you wrote A; the author changed it to A′". Without this the assistant
// reworks its own earlier text, or reverts the author's changes, because it
// remembers A. Between turns only the author changes files, so the diff from
// the version recorded right after the assistant's last turn to now is theirs.
import { mapLines } from '../../lib/diff';

export type AuthorEdit = {
  path: string;
  /** 1-based lines in the current text, inclusive (to < from: the author deleted it all). */
  from: number;
  to: number;
  /** What the assistant left there, and what's there now. */
  wrote: string;
  now: string;
};

/** Most passages, and lines per passage, sent with one message. */
const MAX_EDITS = 6;
const MAX_LINES = 40;

const split = (text: string) => text.replace(/\r\n/g, '\n').split('\n');

/**
 * Places where `current` differs from `after` (the file right after the
 * assistant's turn) and the difference touches lines the assistant wrote
 * (`agentLines`, 1-based in `after`). Each runs between the nearest unchanged
 * lines, so the passage reads whole.
 */
export function authorEdits(path: string, after: string, current: string, agentLines: readonly { from: number; to: number }[]): AuthorEdit[] {
  if (after === current) return [];
  const a = split(after);
  const b = split(current);
  const map = mapLines(a, b);
  const regions: { a0: number; a1: number }[] = [];
  for (const block of agentLines) {
    for (let i = block.from - 1; i <= block.to - 1 && i < a.length; i++) {
      if (map[i] >= 0) continue;
      // A changed line of the assistant's: widen to the unchanged lines around it.
      let a0 = i;
      while (a0 > 0 && map[a0 - 1] < 0) a0--;
      let a1 = i;
      while (a1 + 1 < a.length && map[a1 + 1] < 0) a1++;
      const last = regions[regions.length - 1];
      if (last && a0 <= last.a1 + 1) last.a1 = Math.max(last.a1, a1);
      else regions.push({ a0, a1 });
      i = a1;
    }
  }
  // Lines the author inserted inside the assistant's text show up as a gap between mapped lines.
  for (const block of agentLines) {
    for (let i = block.from - 1; i < block.to - 1 && i + 1 < a.length; i++) {
      if (map[i] >= 0 && map[i + 1] >= 0 && map[i + 1] !== map[i] + 1 && !regions.some((r) => r.a0 <= i + 1 && i <= r.a1)) regions.push({ a0: i + 1, a1: i });
    }
  }
  regions.sort((x, y) => x.a0 - y.a0);
  return regions.slice(0, MAX_EDITS).map(({ a0, a1 }) => {
    // The current lines between the unchanged neighbours.
    const before = a0 > 0 ? map[a0 - 1] : -1;
    let afterIdx = b.length;
    for (let k = a1 + 1; k < a.length; k++) {
      if (map[k] >= 0) {
        afterIdx = map[k];
        break;
      }
    }
    const nowLines = b.slice(before + 1, afterIdx);
    const cap = (ls: string[]) => (ls.length > MAX_LINES ? [...ls.slice(0, MAX_LINES), `… (${ls.length - MAX_LINES} more lines)`] : ls).join('\n');
    return { path, from: before + 2, to: afterIdx, wrote: cap(a.slice(a0, a1 + 1)), now: cap(nowLines) };
  });
}

/** "chapters/ch1.typ:12–14", for the chip on the message. */
export function authorEditLabel(e: AuthorEdit): string {
  return e.to <= e.from ? `${e.path}:${e.from}` : `${e.path}:${e.from}–${e.to}`;
}

export const AUTHOR_EDITS_INTRO = 'Since your last turn, the author changed text you wrote.';

/** The block appended to the author's message. */
export function formatAuthorEdits(edits: readonly AuthorEdit[]): string {
  const blocks = edits.map(
    (e) =>
      `<author-edit path="${e.path}" lines="${e.to < e.from ? `${e.from} (removed)` : `${e.from}–${e.to}`}">\n<you-wrote>\n${e.wrote}\n</you-wrote>\n<author-changed-it-to>\n${e.now}\n</author-changed-it-to>\n</author-edit>`,
  );
  return `${AUTHOR_EDITS_INTRO} Build on their version: keep their changes unless they ask you to change them, and don't put back what they removed.\n${blocks.join('\n')}`;
}
