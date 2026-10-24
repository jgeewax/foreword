// Ask mode's answer, as the chat draws it: a card that gives the question
// back as the assistant understood it, the answer and how sure it is, the
// places in the book that show it, its reasoning, what it would change, and
// what to ask next. The assistant writes it as fenced blocks the chat reads
// and hides (ask-mode.ts says how): an ```answer block before it searches
// (`asked`, `other`), another once it knows (`answer`, `sure`, `where`,
// `stat`, `next`), its reasoning in prose, and a ```change block per change.
// A ```chart in the prose is drawn as a chart (chart.ts).
import { modeNamed, type AgentMode } from './modes';

export type Sure = 'certain' | 'fairly' | 'guess';

/** A place in the book that shows the answer: where (as written: `chapters/one.typ:42`, `:42-48`), a short label, a note. */
export type AnswerPlace = { place: string; label: string; note: string };
export type AnswerStat = { value: string; label: string };
/** A question the author might ask next; `mode`, another mode it's for. */
export type AnswerNext = { text: string; mode: AgentMode | null };
/** A change the assistant would make: `find` (as it is in the file, near `at`) becomes `replace`. */
export type AnswerChange = { at: string; find: string; replace: string; why: string; complete: boolean };

export type AskAnswer = {
  /** The question as it understood it, as a question. */
  asked: string;
  /** The other thing the question could mean, when it could mean two. */
  other: string;
  answer: string;
  sure: { level: Sure; checked: string } | null;
  where: AnswerPlace[];
  stats: AnswerStat[];
  next: AnswerNext[];
  changes: AnswerChange[];
  /** A block is still being written. */
  writing: boolean;
};

type Lang = 'answer' | 'change' | 'chart';
export type Segment = { kind: 'prose'; text: string } | { kind: 'block'; lang: Lang; body: string; closed: boolean };

const OPEN = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w-]*)[^`\n]*$/;
const OURS = new Set<string>(['answer', 'change', 'chart']);

/**
 * A reply as prose and the blocks the chat reads. Other fenced blocks (```typst)
 * stay in the prose, whatever they hold. A block still being written is
 * `closed: false`, to the end of the text.
 */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  const lines = text.split('\n');
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) out.push({ kind: 'prose', text: prose.join('\n') });
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]);
    if (!open) {
      prose.push(lines[i]);
      continue;
    }
    const fence = open[1];
    const lang = open[2].toLowerCase();
    const closes = (l: string) => new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`).test(l);
    let j = i + 1;
    while (j < lines.length && !closes(lines[j])) j++;
    const closed = j < lines.length;
    if (OURS.has(lang)) {
      flush();
      out.push({ kind: 'block', lang: lang as Lang, body: lines.slice(i + 1, j).join('\n'), closed });
    } else {
      prose.push(...lines.slice(i, closed ? j + 1 : j));
    }
    i = j;
  }
  flush();
  return out;
}

/** Whether a reply holds an answer card's blocks. */
export function hasAnswerBlocks(text: string): boolean {
  return /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(answer|change)[ \t]*(\n|$)/i.test(text) && segments(text).some((s) => s.kind === 'block' && s.lang !== 'chart');
}

/** The reply without its answer and change blocks (its charts stay, for the Markdown to draw). */
export function withoutAnswerBlocks(text: string): string {
  if (!/(answer|change)/i.test(text)) return text;
  const segs = segments(text);
  if (!segs.some((s) => s.kind === 'block' && s.lang !== 'chart')) return text;
  return segs
    .map((s) => (s.kind === 'prose' ? s.text : s.lang === 'chart' ? `\`\`\`chart\n${s.body}${s.closed ? '\n```' : ''}` : ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The reply's prose, for the card's Why, and its charts (their source), which the card draws with the places. */
export function proseAndCharts(text: string): { prose: string; charts: { body: string; closed: boolean }[] } {
  const segs = segments(text);
  return {
    prose: segs
      .filter((s) => s.kind === 'prose')
      .map((s) => s.text)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    charts: segs.flatMap((s) => (s.kind === 'block' && s.lang === 'chart' ? [{ body: s.body, closed: s.closed }] : [])),
  };
}

const KEY = /^[ \t]*(?:[-*][ \t]+)?\**([a-z]+)\**[ \t]*:[ \t]?(.*)$/i;
const TEXT_KEYS = new Set(['asked', 'other', 'answer', 'sure']);
const LIST_KEYS = new Set(['where', 'stat', 'next']);
const CHANGE_KEYS = new Set(['at', 'find', 'replace', 'why']);

/** A block's fields, in order: `key: value`, a line without a key going on with the one before. */
function fields(body: string, closed: boolean, known: Set<string>): { key: string; value: string }[] {
  const lines = body.split('\n');
  // Still being written: a list line may be cut short (`ch03.typ:7` of `:76`), so it waits for its end.
  const out: { key: string; value: string; last: boolean }[] = [];
  lines.forEach((line, i) => {
    const m = KEY.exec(line);
    const key = m?.[1].toLowerCase();
    const last = !closed && i === lines.length - 1;
    if (m && key && known.has(key)) out.push({ key, value: m[2], last });
    else if (out.length) {
      const f = out[out.length - 1];
      f.value = `${f.value}\n${line}`;
      f.last = last;
    }
  });
  return out.filter((f) => !(f.last && LIST_KEYS.has(f.key))).map(({ key, value }) => ({ key, value }));
}

const unquote = (s: string) => s.trim().replace(/^`(.*)`$/s, '$1').replace(/^"(.*)"$/s, '$1').replace(/^“(.*)”$/s, '$1');
const parts = (s: string) => s.split('|').map((p) => p.trim());
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** How sure, from its words: "certain | searched every chapter", "fairly sure, …", "a guess". */
export function sureOf(value: string): { level: Sure; checked: string } {
  const v = oneLine(value);
  const m = /^(?:i'?m\s+)?(not sure|unsure|a guess|guessing|guess|fairly sure|fairly|likely|probably|mostly sure|pretty sure|quite sure|certain|sure|confident)\b[\s,;:|.—–-]*(.*)$/i.exec(v);
  if (!m) return { level: 'fairly', checked: v.replace(/^\|\s*/, '') };
  const w = m[1].toLowerCase();
  const level: Sure = /not sure|unsure|guess/.test(w) ? 'guess' : /fairly|likely|probably|mostly|pretty|quite/.test(w) ? 'fairly' : 'certain';
  return { level, checked: m[2].trim() };
}

function place(value: string): AnswerPlace | null {
  const [where, label = '', ...note] = parts(oneLine(value));
  const p = unquote(where);
  return p ? { place: p, label: unquote(label), note: note.join(' | ') } : null;
}

function stat(value: string): AnswerStat | null {
  const v = oneLine(value);
  const [a, ...b] = parts(v);
  if (b.length) return a ? { value: a, label: b.join(' ') } : null;
  const m = /^([\d.,%×x/+−-]+)\s+(.+)$/.exec(v);
  return m ? { value: m[1], label: m[2] } : null;
}

function next(value: string): AnswerNext | null {
  const ps = parts(oneLine(value));
  const mode = ps.length > 1 ? modeNamed(ps[ps.length - 1]) : null;
  const text = unquote((mode ? ps.slice(0, -1) : ps).join(' | '));
  return text ? { text, mode } : null;
}

function change(body: string, closed: boolean): AnswerChange | null {
  const c: AnswerChange = { at: '', find: '', replace: '', why: '', complete: closed };
  for (const f of fields(body, closed, CHANGE_KEYS)) {
    const v = f.key === 'find' || f.key === 'replace' ? f.value.replace(/^\n+|\n+$/g, '') : oneLine(f.value);
    c[f.key as 'at' | 'find' | 'replace' | 'why'] = f.key === 'find' || f.key === 'replace' ? v : unquote(v);
  }
  return c.find || c.replace ? c : null;
}

/**
 * The answer a turn's replies give, in order (what it said before it looked,
 * then its reply): later fields take the place of earlier ones, a block's
 * places (or follow-ups) take the place of an earlier block's, and the changes
 * are the last reply's that has any. Null when none has an answer block.
 */
export function answerOf(texts: readonly string[]): AskAnswer | null {
  const a: AskAnswer = { asked: '', other: '', answer: '', sure: null, where: [], stats: [], next: [], changes: [], writing: false };
  let found = false;
  for (const text of texts) {
    if (!/(answer|change)/i.test(text)) continue;
    const blocks = segments(text).filter((s): s is Extract<Segment, { kind: 'block' }> => s.kind === 'block' && s.lang !== 'chart');
    if (!blocks.length) continue;
    found = true;
    const changes: AnswerChange[] = [];
    for (const b of blocks) {
      a.writing = !b.closed;
      if (b.lang === 'change') {
        const c = change(b.body, b.closed);
        if (c) changes.push(c);
        continue;
      }
      const lists: { where: AnswerPlace[]; stat: AnswerStat[]; next: AnswerNext[] } = { where: [], stat: [], next: [] };
      for (const f of fields(b.body, b.closed, new Set([...TEXT_KEYS, ...LIST_KEYS]))) {
        if (f.key === 'where') {
          const p = place(f.value);
          if (p) lists.where.push(p);
        } else if (f.key === 'stat') {
          const s = stat(f.value);
          if (s) lists.stat.push(s);
        } else if (f.key === 'next') {
          const n = next(f.value);
          if (n) lists.next.push(n);
        } else {
          const v = f.key === 'answer' ? f.value.trim() : oneLine(f.value);
          if (!v) continue;
          if (f.key === 'sure') a.sure = sureOf(v);
          else a[f.key as 'asked' | 'other' | 'answer'] = v;
        }
      }
      if (lists.where.length) a.where = lists.where.slice(0, 8);
      if (lists.stat.length) a.stats = lists.stat.slice(0, 4);
      if (lists.next.length) a.next = lists.next.slice(0, 3);
    }
    if (changes.length) a.changes = changes;
  }
  return found ? a : null;
}

/** The answer as plain text, for Copy and the Tasks view: the question, the answer, the places, the reasoning, the changes. */
export function answerText(a: AskAnswer, prose: string): string {
  const out: string[] = [];
  if (a.asked) out.push(a.asked);
  if (a.answer) out.push(a.answer);
  if (a.where.length) out.push(a.where.map((p) => `- ${p.place}${p.label ? ` (${p.label})` : ''}${p.note ? `: ${p.note}` : ''}`).join('\n'));
  if (prose) out.push(prose);
  for (const c of a.changes) out.push(`${c.at ? `${c.at}: ` : ''}“${c.find}” → “${c.replace}”${c.why ? ` (${c.why})` : ''}`);
  return out.join('\n\n');
}

/** The words the question singles out ("Do I use *orthogonal*…", “Sam”, `#vect`), to mark in the lines it points to. */
export function markedTerms(asked: string): string[] {
  const out = new Set<string>();
  for (const m of asked.matchAll(/\*([^*\n]{2,40})\*|_([^_\n]{2,40})_|“([^”\n]{2,40})”|"([^"\n]{2,40})"|`([^`\n]{2,40})`/g)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).trim();
    if (t) out.add(t);
  }
  return [...out];
}

/**
 * A line as the card quotes it: the words, without a list's dash, a heading's
 * `=`, a label at its end, an index entry, or emphasis marks.
 */
export function quoteOf(line: string): string {
  return line
    .replace(/^\s*(?:[-+]\s+|=+\s+|\/\s+)/, '')
    .replace(/\s*<[\w:.-]+>\s*$/, '')
    .replace(/#index\[[^\]]*\]/g, '')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .trim();
}

/** A quote cut into pieces, the question's terms marked (a term also marks the longer words it starts: orthogonal, orthogonality). */
export function markPieces(text: string, terms: readonly string[]): { text: string; mark: boolean }[] {
  const words = terms.map((t) => t.trim()).filter((t) => t.length >= 2);
  if (!words.length) return [{ text, mark: false }];
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((x, y) => y.length - x.length);
  const re = new RegExp(`(${esc.join('|')})[\\p{L}\\p{N}]*`, 'giu');
  const out: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), mark: false });
    out.push({ text: m[0], mark: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false });
  return out;
}
