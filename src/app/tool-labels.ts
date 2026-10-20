// How the chat describes the assistant's tool calls: in words, with the
// book's own names ("Read “The Storm” (chapter 2) · lines 1–40", "Searched
// for “lighthouse”"), not tool names and paths. The same text, in the
// present tense, is the progress line while the tool runs.
import { bookPath } from './ai-marks';
import { describeCommand } from './command-words';
import { resolveRef } from './references';
import { ASSISTANT_NAMES, type AssistantId } from './settings';
import { STUDIO_TOOL_ACTION, studioToolName } from '../services/agent/studio-tool';

/**
 * What the book calls its files: the main file, the chapters it includes (in
 * order), headings, and the files whose heading isn't numbered (a preface).
 */
export type BookNames = { root: string; entry: string | null; chapters: string[]; titles: Record<string, string>; unnumbered?: string[] };

export const NO_NAMES: BookNames = { root: '', entry: null, chapters: [], titles: {} };

/**
 * A file's first heading ("= The Storm <ch-storm>" → "The Storm", or
 * "#heading(numbering: none)[Prologue]" → "Prologue"), without markup.
 */
export function firstHeading(text: string): string | null {
  for (const line of text.split('\n')) {
    const call = /^\s*#heading\(([^)]*)\)\[(.+)\]\s*(<[\w:.-]+>)?\s*$/.exec(line);
    const m = call && !/level\s*:\s*[2-9]/.test(call[1]) ? [line, call[2]] : /^\s*=\s+(.+?)\s*(<[\w:.-]+>)?\s*$/.exec(line);
    // Markup out, and Typst's non-breaking space (~) as one.
    if (m) return m[1].replace(/[*_`]/g, '').replace(/(?<!\\)~/g, '\u00a0').replace(/\\(.)/g, '$1').trim() || null;
  }
  return null;
}

/** A file the main file includes, and whether the main file turns heading numbers off around it (front or back matter). */
export type Include = { file: string; unnumbered: boolean };

// Keywords that start a statement running to the end of the line after a # in markup.
const STATEMENT = new Set(['let', 'set', 'show', 'include', 'import', 'if', 'for', 'while', 'context', 'return']);
const IDENT = /[\p{L}_][\p{L}\p{N}_-]*/uy;

/**
 * The files the main file includes, in order (book-relative): `#include "…"`
 * in markup and `include "…"` in code, as in `#{ include "…" }` or
 * `#chapter(include "…")`, but not in comments, strings, raw text or maths.
 * Follows `set heading(numbering: …)` through the blocks it's scoped to, so
 * a preface included under `set heading(numbering: none)` is unnumbered.
 */
export function mainIncludes(main: string, mainPath: string, root = ''): Include[] {
  const s = main;
  const out: Include[] = [];
  const word = (i: number) => ((IDENT.lastIndex = i), IDENT.exec(s)?.[0] ?? null);
  const until = (i: number, end: string) => (i = s.indexOf(end, i)) < 0 ? s.length : i;

  // Past a comment, raw text, maths, or (in code) a string at i; i itself if there's none.
  const skip = (i: number, code: boolean): number => {
    const [c, d] = [s[i], s[i + 1]];
    if (c === '/' && d === '*') return until(i + 2, '*/') + 2;
    // In markup, the // of a link (https://…) isn't a comment.
    if (c === '/' && d === '/' && (code || s[i - 1] !== ':')) return until(i, '\n');
    if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      return n === 2 ? i + 2 : until(i + n, '`'.repeat(n)) + n;
    }
    if (c === '$' || (code && c === '"')) {
      let j = i + 1;
      while (j < s.length && s[j] !== c && !(c === '"' && s[j] === '\n')) j += s[j] === '\\' ? 2 : 1;
      return j + 1;
    }
    return i;
  };

  // Markup up to its closing ']' (or the end): returns the index after it.
  const markup = (i: number, close: string, none: boolean): number => {
    while (i < s.length) {
      const c = s[i];
      if (c === close) return i + 1;
      const j = skip(i, false);
      if (j !== i) i = j;
      else if (c === '\\') i += 2;
      else if (c === '[') i = markup(i + 1, ']', none);
      else if (c === '#') ({ end: i, none } = embedded(i + 1, none));
      else i++;
    }
    return i;
  };

  // What follows a # in markup: a block, a statement (#set …, #include …), or a call chain (#chapter(…)[…]).
  const embedded = (i: number, none: boolean): { end: number; none: boolean } => {
    if (s[i] === '{') return { end: code(i + 1, '}', none).end, none };
    if (s[i] === '(') return { end: code(i + 1, ')', none).end, none };
    if (s[i] === '[') return { end: markup(i + 1, ']', none), none };
    const name = word(i);
    if (!name) return { end: i, none };
    if (STATEMENT.has(name)) return code(i, '\n', none);
    for (i += name.length; ; ) {
      if (s[i] === '(') i = code(i + 1, ')', none).end;
      else if (s[i] === '[') i = markup(i + 1, ']', none);
      else if (s[i] === '.' && word(i + 1)) i += 1 + word(i + 1)!.length;
      else return { end: i, none };
    }
  };

  // Code up to its closing '}' or ')' (or, for a statement in markup, the line's end): returns the index after it, and the numbering then.
  const code = (i: number, close: string, none: boolean): { end: number; none: boolean } => {
    while (i < s.length) {
      const c = s[i];
      if (c === close) return { end: close === '\n' ? i : i + 1, none };
      if (close === '\n' && (c === ';' || c === ']' || c === '}' || c === ')')) return { end: c === ';' ? i + 1 : i, none };
      const j = skip(i, true);
      if (j !== i) i = j;
      else if (c === '{') i = code(i + 1, '}', none).end;
      else if (c === '(') i = code(i + 1, ')', none).end;
      else if (c === '[') i = markup(i + 1, ']', none);
      else if (word(i)) {
        const name = word(i)!;
        i += name.length;
        const included = name === 'include' && /^\s+"([^"\n]+)"/.exec(s.slice(i, i + 1024));
        if (included) {
          const file = resolveRef(mainPath, included[1], root);
          if (file && !out.some((x) => x.file === file)) out.push({ file, unnumbered: none });
          i += included[0].length;
        }
        const set = name === 'set' && /^\s+heading\s*\(/.exec(s.slice(i, i + 64));
        if (set) {
          const start = i + set[0].length;
          i = code(start, ')', none).end;
          const args = s.slice(start, i - 1);
          if (/\bnumbering\s*:\s*none\b/.test(args)) none = true;
          else if (/\bnumbering\s*:/.test(args)) none = false;
        }
      } else i++;
    }
    return { end: i, none };
  };

  markup(0, '', false);
  return out;
}

/** The files the main file includes, in order (book-relative). */
export function includedFiles(main: string, mainPath: string, root = ''): string[] {
  return mainIncludes(main, mainPath, root).map((x) => x.file);
}

/** Whether a file turns heading numbers off before its first heading, as a preface or a prologue does. */
export function unnumberedHeading(text: string): boolean {
  const heading = text.search(/^\s*=\s/m);
  const before = heading < 0 ? text : text.slice(0, heading);
  return /heading\s*\([^)]*numbering\s*:\s*none/.test(before.replace(/^\s*\/\/.*$/gm, ''));
}

/**
 * A chapter's number as the book counts them: the main file's includes, in
 * order, that start with a numbered heading. Null for anything else.
 */
export function chapterNumber(path: string, names: BookNames): number | null {
  const counts = (p: string) => !!names.titles[p] && !names.unnumbered?.includes(p);
  if (!counts(path)) return null;
  let n = 0;
  for (const p of names.chapters) {
    if (counts(p)) n++;
    if (p === path) return n;
  }
  return null;
}

/** A file's heading, after its number if it's a chapter ("17. The Harbour"); undefined without a heading. */
export function numberedTitle(path: string, names: BookNames): string | undefined {
  const title = names.titles[path];
  const n = title ? chapterNumber(path, names) : null;
  return n ? `${n}. ${title}` : title;
}

/** A file as the author knows it: “Heading” (chapter 2), the main file, the style guide, or its path. */
export function fileName(path: string, names: BookNames): string {
  if (path === names.entry) return 'the main file';
  if (path === 'WRITING_STYLE.md') return 'the style guide';
  const title = names.titles[path];
  const chapter = chapterNumber(path, names);
  if (title && chapter) return `“${title}” (chapter ${chapter})`;
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
  const own = studioToolName(name);
  if (own) return describeStudioTool(own, o);
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
    // Claude Code looking up tools it hasn't loaded yet (Typst Studio's own, say).
    case 'toolsearch':
      return { done: 'Found the tools it needs', running: 'Finding the tools it needs' };
    case 'skill':
      return { done: `Used the ${String(o.name ?? '')} skill`, running: `Using the ${String(o.name ?? '')} skill` };
    default:
      return { done: `Used ${name}`, running: `Using ${name}` };
  }
}

/** Typst Studio's preferences as the author knows them, for the chat. */
const PREFERENCE_WORDS: Record<string, (v: unknown) => string> = {
  editorFontSize: (v) => `text size ${v} px`,
  wordWrap: (v) => (v === 'off' ? 'no wrapping' : v === 'column' ? 'wrapping at a column' : 'wrapping at the edge'),
  wordWrapColumn: (v) => `wrapping at column ${v}`,
  rulers: (v) => (Array.isArray(v) && v.length ? `rulers at ${v.join(', ')}` : 'no rulers'),
  formatOnSave: (v) => `format on save ${v ? 'on' : 'off'}`,
  sendKey: (v) => (v === 'mod-enter' ? '⌘⏎ sends' : '⏎ sends'),
  markAiEdits: (v) => `marks for its changes ${v ? 'on' : 'off'}`,
  markAiReads: (v) => `marks for what it read ${v ? 'on' : 'off'}`,
  aiEditColor: (v) => `its changes marked in ${v}`,
  aiReadColor: (v) => `what it read marked in ${v}`,
  checkForUpdates: (v) => `checking for updates ${v ? 'on' : 'off'}`,
  zoom: (v) => `zoom ${Math.round(Number(v) * 100)}%`,
};

/** Typst Studio's own tools that change something, completing "The assistant wants to …" (what, exactly, is in the row above). */
const STUDIO_TOOL_ASKS: Record<string, string> = {
  change_settings: 'change Typst Studio’s settings',
  set_model: 'change its model or effort',
  switch_assistant: 'switch to another assistant',
  set_mode: 'change the chat’s mode',
};

/** Typst Studio's own tools (studio-tools.ts), in words. */
function describeStudioTool(tool: string, o: Record<string, unknown>): ToolLabel {
  const said = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  switch (tool) {
    case 'get_settings':
      return { done: 'Looked at Typst Studio’s settings', running: 'Looking at Typst Studio’s settings' };
    case 'change_settings': {
      const what = Object.entries(o).map(([k, v]) => PREFERENCE_WORDS[k]?.(v) ?? k);
      return { done: 'Changed Typst Studio’s settings', running: 'Changing Typst Studio’s settings', note: what.join(', ') || undefined };
    }
    case 'list_models':
      return { done: 'Looked at the models', running: 'Looking at the models', note: said(o.search) ? `“${said(o.search)}”` : undefined };
    case 'set_model': {
      const what = [said(o.model) && `model “${said(o.model)}”`, said(o.effort) && `effort “${said(o.effort)}”`].filter(Boolean).join(', ');
      return { done: 'Changed the model', running: 'Changing the model', note: what ? `${what}, when it finishes` : undefined };
    }
    case 'switch_assistant': {
      const name = ASSISTANT_NAMES[String(o.assistant) as AssistantId] ?? String(o.assistant ?? 'another assistant');
      return { done: `Switched the assistant to ${name}`, running: `Switching the assistant to ${name}`, note: 'when it finishes' };
    }
    case 'set_mode':
      return { done: `Switched to ${String(o.mode ?? '')} mode`, running: `Switching to ${String(o.mode ?? '')} mode`, note: 'when it finishes' };
    case 'open_settings':
      return { done: 'Opened Settings for you', running: 'Opening Settings for you', note: said(o.page) ?? undefined };
    default:
      return { done: `Used Typst Studio’s ${tool}`, running: `Using Typst Studio’s ${tool}` };
  }
}

/**
 * A permission question in words, completing "The assistant wants to …":
 * "read “The Storm” (chapter 1), lines 205–242". `code` is the command, if any.
 */
export function describePermission(action: string, resources: readonly string[], names: BookNames): { what: string; code?: string } {
  // Typst Studio's own tools: ACP's asks name the tool as the resource, OpenCode's in the action.
  const tool = action === STUDIO_TOOL_ACTION ? resources[0] : studioToolName(action);
  if (tool) {
    // Typst Studio's own asks (studio-tools.ts) say what the change is, after the tool.
    const detail = action === STUDIO_TOOL_ACTION ? resources[1] : undefined;
    return { what: `${STUDIO_TOOL_ASKS[tool] ?? 'use Typst Studio’s settings'}${detail ? `: ${detail}` : ''}` };
  }
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
