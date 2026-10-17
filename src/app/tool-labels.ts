// How the chat describes the assistant's tool calls: in words, with the
// book's own names ("Read “The Storm” (chapter 2) · lines 1–40", "Searched
// for “lighthouse”"), not tool names and paths. The same text, in the
// present tense, is the progress line while the tool runs.
import { bookPath } from './ai-marks';
import { describeCommand } from './command-words';
import { resolveRef } from './references';

/** What the book calls its files: the main file, the chapters it includes (in order), and headings. */
export type BookNames = { root: string; entry: string | null; chapters: string[]; titles: Record<string, string> };

export const NO_NAMES: BookNames = { root: '', entry: null, chapters: [], titles: {} };

/** A file's first heading ("= The Storm <ch-storm>" → "The Storm"), without markup. */
export function firstHeading(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = /^\s*=\s+(.+?)\s*(<[\w:.-]+>)?\s*$/.exec(line);
    if (m) return m[1].replace(/[*_`]/g, '').replace(/\\(.)/g, '$1').trim() || null;
  }
  return null;
}

/** The files the main file includes, in order (book-relative), skipping commented-out lines. */
export function includedFiles(main: string, mainPath: string, root = ''): string[] {
  const out: string[] = [];
  for (const line of main.split('\n')) {
    if (/^\s*\/\//.test(line)) continue;
    for (const m of line.matchAll(/#include\s+"([^"]+)"/g)) {
      const p = resolveRef(mainPath, m[1], root);
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

/** A file as the author knows it: “Heading” (chapter 2), the main file, the style guide, or its path. */
export function fileName(path: string, names: BookNames): string {
  if (path === names.entry) return 'the main file';
  if (path === 'WRITING_STYLE.md') return 'the style guide';
  const title = names.titles[path];
  const chapter = names.chapters.indexOf(path);
  if (title && chapter >= 0) return `“${title}” (chapter ${chapter + 1})`;
  if (title) return `“${title}”`;
  return path;
}

export type ToolLabel = {
  /** Past tense, for the chat row: "Read “The Storm” (chapter 2)". */
  done: string;
  /** Present tense, for the progress line: "Reading “The Storm” (chapter 2)". */
  running: string;
  /** Shown after the label, quieter: lines read, matches found. */
  note?: string;
  /** The command itself, shown when the row is opened. */
  code?: string;
  /** The file it's about (for a link). */
  path?: string;
};

const quote = (s: unknown, max = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Files a patch (OpenCode's `*** Update File: x` format) touches. */
function patchFiles(text: unknown): string[] {
  return [...String(text ?? '').matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
}

/**
 * Words for a tool call. `output` (when it has finished) adds a result note;
 * `read` is the lines a read covered.
 */
export function describeTool(name: string, input: unknown, names: BookNames, output?: string, read?: { from: number; to: number }): ToolLabel {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const path = bookPath(names.root, o.path ?? o.filePath) ?? undefined;
  const file = path ? fileName(path, names) : typeof (o.path ?? o.filePath) === 'string' ? String(o.path ?? o.filePath) : 'a file';
  const where = (p: unknown) => {
    const rel = bookPath(names.root, p);
    return rel ? ` in ${fileName(rel, names) === rel ? `${rel}/` : fileName(rel, names)}` : '';
  };
  switch (name) {
    case 'read':
      return {
        done: `Read ${file}`,
        running: `Reading ${file}`,
        note: read ? (read.from === read.to ? `line ${read.from}` : `lines ${read.from}–${read.to}`) : undefined,
        path,
      };
    case 'grep': {
      const found = /Found (\d+) match/i.exec(output ?? '');
      const note = output == null ? undefined : /no matches/i.test(output) ? 'no matches' : found ? plural(Number(found[1]), 'match', 'matches') : undefined;
      return { done: `Searched for ${quote(o.pattern)}${where(o.path)}`, running: `Searching for ${quote(o.pattern)}${where(o.path)}`, note };
    }
    case 'glob': {
      const n = output == null ? null : output.split('\n').filter((l) => l.trim() && !/^no files/i.test(l)).length;
      return { done: `Looked for ${String(o.pattern ?? 'files')}`, running: `Looking for ${String(o.pattern ?? 'files')}`, note: n == null ? undefined : plural(n, 'file') };
    }
    case 'list':
      return { done: `Listed the files${where(o.path) || ' in the book'}`, running: `Listing the files${where(o.path) || ' in the book'}` };
    case 'edit':
      return { done: `Edited ${file}`, running: `Editing ${file}`, path };
    case 'write':
      return { done: `Wrote ${file}`, running: `Writing ${file}`, path };
    case 'patch':
    case 'apply_patch': {
      const files = patchFiles(o.patchText).map((p) => bookPath(names.root, p) ?? p);
      const what = files.length === 1 ? fileName(files[0], names) : files.length ? plural(files.length, 'file') : 'files';
      return { done: `Edited ${what}`, running: `Editing ${what}`, path: files.length === 1 ? files[0] : undefined };
    }
    case 'bash':
    case 'shell': {
      const command = String(o.command ?? '').trim();
      const words = describeCommand(command, names);
      return { done: words.done, running: words.running, note: words.note, path: words.path, code: command };
    }
    case 'webfetch': {
      let host = '';
      try {
        host = new URL(String(o.url)).host;
      } catch {
        host = String(o.url ?? '');
      }
      return { done: `Read a web page (${host})`, running: `Reading a web page (${host})` };
    }
    case 'websearch':
      return { done: `Searched the web for ${quote(o.query)}`, running: `Searching the web for ${quote(o.query)}` };
    case 'todowrite':
      return { done: 'Updated its to-do list', running: 'Updating its to-do list' };
    case 'question': {
      // OpenCode's result: User has answered your questions: "Q"="A", "Q2"="B". …
      const answers = [...(output ?? '').matchAll(/"(?:[^"\\]|\\.)*?"="((?:[^"\\]|\\.)*?)"/g)].map((m) => m[1]);
      return { done: 'Asked you a question', running: 'Asking you a question', note: answers.length ? `you said ${answers.map((a) => `“${a}”`).join(', ')}` : undefined };
    }
    case 'skill':
      return { done: `Used the ${String(o.name ?? '')} skill`, running: `Using the ${String(o.name ?? '')} skill` };
    default:
      return { done: `Used ${name}`, running: `Using ${name}` };
  }
}

/**
 * A permission question in words, completing "The assistant wants to …":
 * "read “The Storm” (chapter 1), lines 205–242". `code` is the command, if any.
 */
export function describePermission(action: string, resources: readonly string[], names: BookNames): { what: string; code?: string } {
  const files = () => {
    const named = resources.map((r) => fileName(bookPath(names.root, r) ?? r, names));
    return named.length <= 3 ? named.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${named.slice(0, 2).join(', ')} and ${named.length - 2} more files`;
  };
  switch (action) {
    case 'shell':
    case 'bash': {
      const command = resources.join('\n');
      return { what: describeCommand(command, names).ask, code: command };
    }
    case 'edit':
      return { what: `change ${files()}` };
    case 'read':
      return { what: `read ${files()}, which can hold passwords or keys` };
    case 'external_directory':
      return { what: `use files outside the book (${resources.join(', ')})` };
    case 'webfetch':
      return { what: `read a web page (${resources.join(', ')})` };
    case 'websearch':
      return { what: `search the web${resources.length ? ` for ${resources.map((r) => `“${r}”`).join(', ')}` : ''}` };
    default:
      return { what: `use ${action}${resources.length ? ` (${resources.join(', ')})` : ''}` };
  }
}

/** The live progress line while a tool runs. */
export function toolActivity(name: string, input: unknown, names: BookNames = NO_NAMES): string {
  return describeTool(name, input, names).running;
}
