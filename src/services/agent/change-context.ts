// A change the author asks about ("why did this change?"), from History: a
// mark the assistant left in the editor, or a file in a version's changes.
// It goes with their next message, in Ask mode, as a selection does: the
// lines as they were and as the change left them, the version that made it,
// and, when the assistant made it, what Foreword knows of the turn: the
// request and what the assistant said it did. Only that chat knows why for
// sure; without it, the answer can only read the change.
import { diff, splitLines } from '../../lib/diff';

/** The version that made it: its name in History, when (Unix seconds), and whether an assistant's turn made it. */
export type ChangeVersion = { id: string; label: string; time: number; byAssistant: boolean };

/** What Foreword knows of the turn that made it: its task's name, what the author asked in it, and what the assistant said it did. */
export type ChangeTurn = { task?: string; asked?: string; said?: string };

export type ChangeNote = {
  path: string;
  version: ChangeVersion;
  /** The changed stretches, each with a line either side: as they were, and as the change left them (line numbers then). */
  hunks: { from: number; before: string; after: string }[];
  /** More changed stretches than went with it. */
  more: number;
  turn?: ChangeTurn;
};

/** How the note starts, for the chat to find where the author's words end (tasks.ts). */
export const CHANGE_INTRO = 'The author is asking about this change to ';

/** At most this many stretches, and lines in all, so a big turn doesn't swamp the message. */
const MAX_HUNKS = 4;
const MAX_LINES = 80;

/**
 * The stretches a version changed in a file, as the note has them: `near`
 * (a line in the text after it) picks the one there first. A line either side
 * of each, so it reads in place.
 */
export function changeHunks(before: string | null, after: string | null, near?: number): { hunks: ChangeNote['hunks']; more: number } {
  const a = splitLines(before ?? '');
  const b = splitLines(after ?? '');
  // Consecutive non-equal runs are one stretch: lines [a0, a1) before, [b0, b1) after (as ai-marks.ts has them).
  const spans: { a0: number; a1: number; b0: number; b1: number }[] = [];
  for (const r of diff(a, b)) {
    if (r.type === 'equal') continue;
    const a1 = r.a + (r.type === 'delete' ? r.n : 0);
    const b1 = r.b + (r.type === 'insert' ? r.n : 0);
    const last = spans[spans.length - 1];
    if (last && last.a1 === r.a && last.b1 === r.b) Object.assign(last, { a1, b1 });
    else spans.push({ a0: r.a, a1, b0: r.b, b1 });
  }
  const all = spans.map((p) => ({
    from: Math.max(0, p.b0 - 1) + 1,
    before: a.slice(Math.max(0, p.a0 - 1), p.a1 + 1).join('\n'),
    after: b.slice(Math.max(0, p.b0 - 1), p.b1 + 1).join('\n'),
    at: p.b0 + 1,
  }));
  if (near != null) all.sort((x, y) => Math.abs(x.at - near) - Math.abs(y.at - near));
  const hunks: ChangeNote['hunks'] = [];
  let lines = 0;
  for (const h of all) {
    const n = h.before.split('\n').length + h.after.split('\n').length;
    if (hunks.length >= MAX_HUNKS || (hunks.length && lines + n > MAX_LINES)) break;
    hunks.push({ from: h.from, before: h.before, after: h.after });
    lines += n;
  }
  hunks.sort((x, y) => x.from - y.from);
  return { hunks, more: all.length - hunks.length };
}

const when = (t: number) =>
  new Date(t * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const quoted = (s: string, n = 400) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return `“${t.length > n ? `${t.slice(0, n - 1)}…` : t}”`;
};

/** A sentence that ends in a quote: its own full stop, unless the quote ends in one. */
const ended = (s: string) => (/[.!?…]”+$/.test(s) ? s : `${s}.`);

/** The note as the message carries it, after the author's words. */
export function formatChange(c: ChangeNote): string {
  const name = c.version.label.replace(/^Agent:\s*/, '');
  const head = `${CHANGE_INTRO}${c.path}, from History's version ${quoted(name, 120)} (${when(c.version.time)}).`;
  const t = c.turn;
  const who = !c.version.byAssistant
    ? 'The assistant didn’t make it: the author did, in the editor or outside Foreword, and nothing records why.'
    : [
        `An assistant made it${t?.task ? `, in the task ${quoted(t.task, 120)}` : ''}.`,
        t?.asked ? ended(`The author had asked: ${quoted(t.asked)}`) : '',
        t?.said ? ended(`Afterwards the assistant said: ${quoted(t.said)}`) : '',
        t?.asked || t?.said ? '' : 'Foreword doesn’t have that conversation, so nothing here records why.',
      ]
        .filter(Boolean)
        .join(' ');
  const hunks = c.hunks.map((h) => `<lines from="${h.from}">\n<before>\n${h.before}\n</before>\n<after>\n${h.after}\n</after>\n</lines>`).join('\n');
  const more = c.more ? `\n(${c.more} more changed ${c.more === 1 ? 'stretch' : 'stretches'} in the file, left out here.)` : '';
  return `${head} ${who}\n<change path="${c.path}" version="${c.version.id}">\n${hunks}\n</change>${more}`;
}

/** The chip on the author's message, and in the box until it's sent. */
export const changeLabel = (c: Pick<ChangeNote, 'path' | 'version'>) => `Change to ${c.path.split('/').pop()}: ${quoted(c.version.label.replace(/^Agent:\s*/, ''), 48)}`;
