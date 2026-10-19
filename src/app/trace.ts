// The chat as a trace of what happened: the conversation in turns (your
// message, the steps the assistant took, its reply), each step with a tone for
// its colour (it looked, it changed something, it needs you…), the words an
// edit changed, and how long things took. Blue and purple are the editor's own
// marks for what the assistant read and changed, so the two tell one story.
import { bookPath } from './ai-marks';
import { countWords, wordPieces, type Piece } from './prose-diff';
import type { ChatItem } from './studio';

export type UserItem = Extract<ChatItem, { kind: 'user' }>;
export type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>;
export type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

/** What a step was, for its colour: it looked, it changed something, it thought, it needs you, it failed, or something else. */
export type Tone = 'look' | 'change' | 'think' | 'ask' | 'fail' | 'other';

const LOOKS = new Set(['read', 'grep', 'glob', 'list', 'webfetch', 'websearch']);
const SEARCHES = new Set(['grep', 'glob', 'websearch']);
const CHANGES = new Set(['edit', 'write', 'patch', 'apply_patch']);

/** A step's tone; `words`, how the chat says it, so a command that only looks ("Searched for…", run as grep) is blue too. */
export function toolTone(item: Pick<ToolItem, 'name' | 'status'>, words?: string): Tone {
  if (item.status === 'failed') return 'fail';
  if (LOOKS.has(item.name) || (words && lookOf(words))) return 'look';
  if (CHANGES.has(item.name)) return 'change';
  return 'other';
}

/** A step that only looked, by its words: a read, or a search (looking for files or text). */
export function lookOf(words: string): 'read' | 'search' | null {
  if (/^(Read|Reading)\b/.test(words)) return 'read';
  if (/^(Searched|Searching|Looked|Looking|Listed|Listing|Found|Counted|Counting)\b/.test(words)) return 'search';
  return null;
}

export type Turn = {
  /** The message's id ('start' for anything before the first message). */
  key: string;
  user: UserItem | null;
  /** What the assistant did, in order, before its reply. */
  steps: ChatItem[];
  /** Its reply: the last thing it said, when nothing but the questions in it came after. */
  reply: AssistantItem | null;
  /** After the reply: the questions it asked in it. */
  after: ChatItem[];
};

/** The conversation in turns: each message with what followed it. */
export function turnsOf(items: readonly ChatItem[]): Turn[] {
  const turns: Turn[] = [];
  let current: { key: string; user: UserItem | null; items: ChatItem[] } | null = null;
  for (const it of items) {
    if (it.kind === 'user') {
      if (current) turns.push(shape(current));
      current = { key: it.id, user: it, items: [] };
    } else {
      current ??= { key: 'start', user: null, items: [] };
      current.items.push(it);
    }
  }
  if (current) turns.push(shape(current));
  return turns;
}

function shape({ key, user, items }: { key: string; user: UserItem | null; items: ChatItem[] }): Turn {
  let r = items.length - 1;
  while (r >= 0 && items[r].kind === 'question' && (items[r] as Extract<ChatItem, { kind: 'question' }>).via === 'message') r--;
  const reply = r >= 0 && items[r].kind === 'assistant' ? (items[r] as AssistantItem) : null;
  return reply ? { key, user, steps: items.slice(0, r), reply, after: items.slice(r + 1) } : { key, user, steps: items, reply: null, after: [] };
}

/** An edit as the words it changed. */
export type Edit = {
  /** The file, in the book ('' if it isn't one of the book's). */
  path: string;
  /** The text it replaced ('' when it wrote the whole file). */
  before: string;
  /** The text it wrote. */
  after: string;
  /** It wrote the whole file: what was there before isn't known. */
  whole: boolean;
  added: number;
  removed: number;
  pieces: Piece[];
};

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Words added and removed in a word diff. */
export function wordCounts(pieces: Piece[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const p of pieces) {
    if (p.kind === 'add') added += countWords(p.text);
    else if (p.kind === 'del') removed += countWords(p.text);
  }
  return { added, removed };
}

/** An edit or a write the assistant made, from its tool call (null when the call doesn't say what changed). */
export function editOf(item: Pick<ToolItem, 'name' | 'input' | 'status'>, root: string): Edit | null {
  if (item.status === 'failed') return null;
  const o = obj(item.input);
  const path = bookPath(root, o.filePath ?? o.path) ?? '';
  if (item.name === 'edit' && typeof o.oldString === 'string' && typeof o.newString === 'string') {
    const pieces = wordPieces(o.oldString, o.newString);
    return { path, before: o.oldString, after: o.newString, whole: false, pieces, ...wordCounts(pieces) };
  }
  if (item.name === 'write' && typeof o.content === 'string') return { path, before: '', after: o.content, whole: true, pieces: [], added: countWords(o.content), removed: 0 };
  return null;
}

/**
 * The pieces with long unchanged stretches cut down to `context` words either
 * side of a change ("…" where words were left out), so a one-word edit in a
 * long paragraph shows that word and its neighbours.
 */
export function trimPieces(pieces: Piece[], context = 10): Piece[] {
  const TOKENS = /\s+|[^\s]+/g;
  return pieces.map((p, i) => {
    if (p.kind !== 'same') return p;
    const tokens = p.text.match(TOKENS) ?? [];
    const words = tokens.filter((t) => /\S/.test(t)).length;
    const first = i === 0;
    const last = i === pieces.length - 1;
    const keep = (first || last ? 1 : 2) * context;
    if (words <= keep + 2) return p;
    const take = (from: 'start' | 'end', n: number) => {
      const out: string[] = [];
      let count = 0;
      const list = from === 'start' ? tokens : [...tokens].reverse();
      for (const t of list) {
        if (/\S/.test(t) && count === n) break;
        out.push(t);
        if (/\S/.test(t)) count++;
      }
      return from === 'start' ? out.join('') : out.reverse().join('');
    };
    if (first) return { kind: 'same', text: `…${take('end', context).replace(/^\S/, ' $&')}` };
    if (last) return { kind: 'same', text: `${take('start', context).replace(/\S$/, '$& ')}…` };
    return { kind: 'same', text: `${take('start', context).trimEnd()} … ${take('end', context).trimStart()}` };
  });
}

/** Book text (set in a serif) rather than markup or code (in the editor's font). */
export function looksLikeProse(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return /^[\p{L}\s,.;:'’“”"!?-]+$/u.test(t);
  const code = (t.match(/[#{}()[\];=<>$\\`|]/g) ?? []).length;
  return code / t.length < 0.02 && /\p{L}{3,}\s+\p{L}{2,}/u.test(t);
}

export type Stats = {
  /** Steps that looked: reads, searches, listings. */
  looked: number;
  reads: number;
  searches: number;
  /** The files it read. */
  read: string[];
  /** Edits and writes. */
  changed: number;
  failed: number;
  /** Per file it changed: the words it added and removed (unknown counts as 0). */
  files: Map<string, { added: number; removed: number }>;
};

/** What the assistant did in these items; `words`, how the chat says a step (for commands that only look). */
export function statsOf(items: readonly ChatItem[], root: string, words?: (item: ToolItem) => string): Stats {
  const s: Stats = { looked: 0, reads: 0, searches: 0, read: [], changed: 0, failed: 0, files: new Map() };
  for (const it of items) {
    if (it.kind !== 'tool') continue;
    const said = words && !LOOKS.has(it.name) && !CHANGES.has(it.name) ? words(it) : undefined;
    const tone = toolTone(it, said);
    if (tone === 'fail') s.failed++;
    else if (tone === 'look') {
      s.looked++;
      if (said) {
        if (lookOf(said) === 'read') s.reads++;
        else s.searches++;
      } else if (it.name === 'read') {
        s.reads++;
        const path = it.read?.path ?? bookPath(root, obj(it.input).filePath);
        if (path && !s.read.includes(path)) s.read.push(path);
      } else if (SEARCHES.has(it.name)) s.searches++;
    } else if (tone === 'change' && it.status === 'done') {
      s.changed++;
      const edit = editOf(it, root);
      const path = edit?.path || bookPath(root, obj(it.input).filePath) || '';
      if (!path) continue;
      const f = s.files.get(path) ?? { added: 0, removed: 0 };
      s.files.set(path, { added: f.added + (edit?.added ?? 0), removed: f.removed + (edit?.removed ?? 0) });
    }
  }
  return s;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A folded turn in a few words: "Edited 1 file · +4 −14", "Read 2 chapters", "Searched 3 times". */
export function turnWords(s: Stats, isChapter: (path: string) => boolean = () => false): string {
  if (s.files.size) {
    let added = 0;
    let removed = 0;
    for (const f of s.files.values()) {
      added += f.added;
      removed += f.removed;
    }
    return `Edited ${plural(s.files.size, 'file')}${added || removed ? ` · +${added} −${removed}` : ''}`;
  }
  if (s.read.length) return `Read ${plural(s.read.length, s.read.every(isChapter) ? 'chapter' : 'file')}`;
  if (s.searches) return `Searched ${plural(s.searches, 'time')}`;
  if (s.failed) return `${plural(s.failed, 'step')} didn’t work`;
  return '';
}

/** A time as the chat says it: "0.4 s", "12 s", "4 min", "1 h 5 min". */
export function spanWords(ms: number): string {
  if (ms < 9950) return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/** A turn's time, whole seconds: "21 s", "4 min". */
export const turnTime = (ms: number) => (ms < 59500 ? `${Math.max(1, Math.round(ms / 1000))} s` : spanWords(ms));

/** "Read “The Storm” (chapter 2)" → ["Read", "“The Storm” (chapter 2)"]: the verb is set apart. */
export function verbAndRest(label: string): [string, string] {
  const m = /^(\S+)\s+(.*)$/s.exec(label);
  return m ? [m[1], m[2]] : [label, ''];
}

/** An attachment chip's label as a place: "chapters/x.typ:19–30" → the file and "lines 19–30". */
export function attachmentPlace(label: string): { path: string; where: string } | null {
  const m = /^(.+?\.\w+):(\d+)(?:(–)(\d+)|:(\d+))?$/.exec(label);
  if (!m) return null;
  const [, path, from, dash, to] = m;
  return { path, where: dash ? `lines ${from}–${to}` : `line ${from}` };
}

/** The 1-based lines `text` covers in `content`, when it's there exactly once. */
export function linesOf(content: string, text: string): { from: number; to: number } | null {
  if (!text) return null;
  const at = content.indexOf(text);
  if (at < 0 || content.indexOf(text, at + 1) >= 0) return null;
  const from = content.slice(0, at).split('\n').length;
  return { from, to: from + text.replace(/\n$/, '').split('\n').length - 1 };
}

/** A unified diff's changes, each run of removed and added lines as one: its line in the new file, and the text before and after. */
export function patchChanges(patch: string): { line: number; before: string; after: string }[] {
  const out: { line: number; before: string; after: string }[] = [];
  let line = 0;
  let run: { line: number; del: string[]; add: string[] } | null = null;
  const flush = () => {
    if (run) out.push({ line: run.line, before: run.del.join('\n'), after: run.add.join('\n') });
    run = null;
  };
  for (const l of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) {
      flush();
      line = Number(hunk[1]);
    } else if (/^(\+\+\+|---|Index:|diff |={5,})/.test(l) || l.startsWith('\\') || (!l && !run)) {
      continue;
    } else if (l.startsWith('-')) {
      run ??= { line, del: [], add: [] };
      run.del.push(l.slice(1));
    } else if (l.startsWith('+')) {
      run ??= { line, del: [], add: [] };
      run.add.push(l.slice(1));
      line++;
    } else {
      flush();
      line++;
    }
  }
  flush();
  return out;
}
