// Foreword's own tools for the writing assistant, as an MCP server (the
// Rust side, mcp.rs, carries the requests here): what the app is set to, and
// changing it when the author asks: another assistant, model, effort or mode,
// or a preference (text size, wrapping, marks, …). It can't change what it may
// do itself (permissions, commands it may run, the programs Foreword runs):
// only the author does that, in Settings, which it can open for them.
//
// Changes to the assistant itself (which one, model, effort, mode) wait until
// its reply ends, so they never pull the rug from under the turn that asked.
//
// And the book as the author sees it, which its files alone don't show: its
// pages as they're typeset (images), where each heading landed, Typst's
// errors, and the author's review comments. These only look.
import type { AgentMode } from '../services/agent/modes';
import { AGENT_MODES, modeConfig, modeNamed } from '../services/agent/modes';
import { effortFor } from '../services/agent/models';
import { matchesQuery } from '../services/agent/model-search';
import type { EffortOption, ModelInfo, ModelRef } from '../services/agent/types';
import { ZOOM_STEPS } from '../lib/zoom';
import type { Level } from '../services/agent/permissions';
import { describeTool, NO_NAMES } from './tool-labels';
import { ASSISTANT_NAMES, ASSISTANTS, AUTO_SAVE_MINUTES, EDITOR_COLUMNS, EDITOR_FONT_SIZES, sanitize, type AppSettings, type AssistantId } from './settings';

export { STUDIO_TOOLS } from '../services/agent/studio-tool';
import { STUDIO_TOOLS } from '../services/agent/studio-tool';

/** The Settings pages open_settings can open. */
export const SETTINGS_PAGES = ['general', 'editor', 'spelling', 'assistant', 'permissions', 'tools', 'book', 'book-spelling', 'book-assistant', 'book-color'] as const;
export type ToolsSettingsPage = (typeof SETTINGS_PAGES)[number];

/** Model and effort to use once an assistant is switched to (or now): a model's id or part of its name ("default": its own), an effort level. */
export type ModelChoice = { model?: string; effort?: string };

/** What the preview typesets: the whole book, one chapter of it alone (named as the chat names it), or the cover. */
export type PreviewShows = { kind: 'book' } | { kind: 'chapter'; chapter: string } | { kind: 'cover' };

/** A heading as typeset: its page (from 1) and, when Foreword can tell, where it's written ("chapters/one.typ:12"). */
export type PageHeading = { level: number; title: string; page: number; at?: string };

export type BookProblem = { path: string; line: number; column: number; severity: 'error' | 'warning'; message: string };

/** A review comment, found in its file as it is now (line null: its passage has changed since). */
export type CommentRow = { id: string; path: string; line: number | null; quote: string; text: string; status: 'open' | 'addressed' };

/** The book as the preview has it, for the tools that look at it. */
export type BookHost = {
  /** What the preview shows, its page count (null: not typeset yet), and whether Typst is at work or stopped by errors. */
  preview(): { shows: PreviewShows; pages: number | null; status: 'idle' | 'compiling' | 'ok' | 'error' };
  /** Once typesetting has caught up with the latest changes: true, or false if it took too long. */
  settled(): Promise<boolean>;
  /** Pages (from 1) as PNGs, base64, at `ppi`, and the page count. */
  pageImages(pages: number[], ppi: number): Promise<{ total: number; pages: { page: number; data: string }[] }>;
  /** Its headings in order, as last typeset (stale: from before the latest changes); null if it hasn't been with the preview open. */
  outline(): { headings: PageHeading[]; stale: boolean } | null;
  /** Typst's errors and warnings, and references that go nowhere, in file and line order. */
  problems(): BookProblem[];
  /** The review comments not yet resolved. */
  comments(): Promise<CommentRow[]>;
};

/** What the tools act on: Foreword (studio.ts), or a test's stand-in. */
export type StudioHost = {
  state(): {
    settings: AppSettings;
    zoom: number;
    assistant: AssistantId;
    models: ModelInfo[];
    model: ModelRef | null;
    efforts: EffortOption[];
    effort: string | null;
    mode: AgentMode;
    /** Whether it may change settings (Settings ▸ Permissions): without asking, after asking the author, or not at all. */
    permission: Level;
  };
  /**
   * With the settings permission at Ask: the author's yes for this change.
   * Taken from their answer to the assistant's own ask when there was one (Claude
   * Code, OpenCode); otherwise asked in the chat (Codex asks no one about these
   * tools). "unanswered": no answer before the assistant would give up waiting.
   */
  approve(tool: string, what: string): Promise<'yes' | 'no' | 'unanswered'>;
  /** App preferences (the settings file), and the UI zoom: at once. */
  changePreferences(patch: Partial<AppSettings>, zoom?: number): void;
  /** Once the assistant's reply ends (the turn that asked). */
  whenIdle(run: () => unknown): void;
  /** Another assistant, then its model and effort when it has started. */
  switchAssistant(id: AssistantId, choice: ModelChoice): void;
  /** This assistant's model and effort (the chat says what came of it). */
  chooseModel(choice: ModelChoice): Promise<void>;
  setMode(mode: AgentMode): Promise<void>;
  openSettings(page?: ToolsSettingsPage): void;
  book: BookHost;
};

/** The app preferences the assistant may change, what each does, and the values it takes. */
const PREFERENCES: Record<string, { about: string; values: string; schema: Record<string, unknown> }> = {
  theme: { about: 'Light or dark, for the whole window: as macOS is set (system), or always light or dark.', values: 'system, light, dark', schema: { type: 'string', enum: ['system', 'light', 'dark'] } },
  editorFontSize: { about: 'The editor’s text size, in px.', values: `${EDITOR_FONT_SIZES.min} to ${EDITOR_FONT_SIZES.max}`, schema: { type: 'number', minimum: EDITOR_FONT_SIZES.min, maximum: EDITOR_FONT_SIZES.max } },
  wordWrap: {
    about: 'Where long lines wrap in the editor: at its edge (window), at wordWrapColumn (column), or not at all (off).',
    values: 'window, column, off',
    schema: { type: 'string', enum: ['window', 'column', 'off'] },
  },
  wordWrapColumn: { about: 'The column long lines wrap at, with wordWrap "column".', values: `${EDITOR_COLUMNS.min} to ${EDITOR_COLUMNS.max}`, schema: { type: 'integer', minimum: EDITOR_COLUMNS.min, maximum: EDITOR_COLUMNS.max } },
  rulers: { about: 'Vertical lines in the editor at these columns (e.g. [80, 120]); [] for none.', values: `up to 8 columns, ${EDITOR_COLUMNS.min} to ${EDITOR_COLUMNS.max}`, schema: { type: 'array', items: { type: 'integer' } } },
  formatOnSave: { about: 'Format Typst files (typstyle) when the author saves them.', values: 'true, false', schema: { type: 'boolean' } },
  previewPages: {
    about: 'Which pages the preview keeps drawn: those near the ones on screen (nearby; light on memory), or every page (all; no blank pages when scrolling far, but a long book takes gigabytes).',
    values: 'nearby, all',
    schema: { type: 'string', enum: ['nearby', 'all'] },
  },
  previewScope: {
    about:
      'What the preview typesets: the whole book (book), or only the chapter being edited (chapter; quick to follow typing in a long book, but page numbers and references to other chapters are right only in the whole book). Same as the Book and Chapter buttons above the preview.',
    values: 'book, chapter',
    schema: { type: 'string', enum: ['book', 'chapter'] },
  },
  autoSaveMinutes: {
    about: 'Save files with unsaved changes every this many minutes; 0 turns auto save off.',
    values: `0 to ${AUTO_SAVE_MINUTES.max}`,
    schema: { type: 'integer', minimum: 0, maximum: AUTO_SAVE_MINUTES.max },
  },
  sendKey: { about: 'Which key sends a chat message: Enter (Shift+Enter for a new line), or Cmd+Enter (Enter for a new line).', values: 'enter, mod-enter', schema: { type: 'string', enum: ['enter', 'mod-enter'] } },
  markAiEdits: { about: 'Mark the lines the assistant changed, in the editor’s gutter.', values: 'true, false', schema: { type: 'boolean' } },
  markAiReads: { about: 'Mark the lines the assistant read in this conversation.', values: 'true, false', schema: { type: 'boolean' } },
  aiEditColor: { about: 'The colour of the marks for lines the assistant changed.', values: '#rrggbb', schema: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
  aiReadColor: { about: 'The colour of the marks for lines the assistant read.', values: '#rrggbb', schema: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
  checkSpelling: { about: 'Check spelling as the author types (red squiggles).', values: 'true, false', schema: { type: 'boolean' } },
  checkGrammar: { about: 'Check grammar with spelling (blue squiggles), in English.', values: 'true, false', schema: { type: 'boolean' } },
  checkStyle: { about: 'Suggest style too (wordiness, house style), as dotted purple underlines.', values: 'true, false', schema: { type: 'boolean' } },
  checkCode: { about: 'Check the words in code blocks, inline code, code files and the names a file defines.', values: 'true, false', schema: { type: 'boolean' } },
  spellingLanguage: { about: 'The language of books whose Typst doesn’t set one ("en-GB"); "" for the Mac’s.', values: 'a language tag such as en-US, en-GB, fr, de, or ""', schema: { type: 'string', pattern: '^([a-z]{2,3}(-[A-Z]{2})?)?$' } },
  checkForUpdates: { about: 'Look for a new version of Foreword when it starts.', values: 'true, false', schema: { type: 'boolean' } },
  zoom: { about: 'The size of the whole window’s text and controls (1 is 100%).', values: ZOOM_STEPS.join(', '), schema: { type: 'number', minimum: ZOOM_STEPS[0], maximum: ZOOM_STEPS[ZOOM_STEPS.length - 1] } },
};

/** Settings only the author changes: what the assistant may do, and the programs the app runs. */
const AUTHOR_ONLY: Record<string, string> = {
  permissions: 'what you may do without asking',
  alwaysAllow: 'the commands you may run without asking',
  neverAllow: 'the commands you may never run',
  allowCommands: 'the commands you may run without asking',
  toolPaths: 'the programs Foreword runs',
  skippedUpdate: 'a skipped update',
};
const AUTHOR_ONLY_NOTE =
  'What the assistant may do (Settings ▸ Permissions), the commands it may run without asking, and the programs Foreword runs (Settings ▸ Tools) are the author’s to change, in Settings: open_settings opens the page for them.';
const BOOK_NOTE =
  'This book’s own settings (its main file, Typst root, output folder, font folders, the language its spelling is checked in) are in .foreword.json in the book’s folder: change them by editing that file. The writing style guide is WRITING_STYLE.md there. The words its spelling check accepts (its characters’ names, its terms) are in .foreword/dictionary.txt, one per line, sorted.';

/** A tool's answer: words, and pictures after them (PNGs, base64). */
type ToolOutput = { text: string; images?: string[] };

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  run(input: Record<string, unknown>, host: StudioHost): Promise<string | ToolOutput> | string | ToolOutput;
};

/** A refusal or a mistake: the assistant reads it as the tool's error. */
class ToolError extends Error {}

/** The author's permission for changes, said to the assistant. */
const PERMISSION_WORDS: Record<Level, string> = {
  allow: 'You may change them without asking (the author allows it in Settings ▸ Permissions).',
  ask: 'The author is asked before each change (Settings ▸ Permissions).',
  deny: 'You may not change them: the author has turned that off in Settings ▸ Permissions. You can open that page for them (open_settings).',
};

/** A tool that changes something, when the author has said never (the tools say it: an assistant's own refusal says nothing). */
function mayChange(host: StudioHost) {
  if (host.state().permission === 'deny') throw new ToolError(`${PERMISSION_WORDS.deny} Nothing was changed.`);
}

/** At Ask: the author's yes for this change (`what`, in words for their card), or a refusal the assistant can pass on. */
async function approved(host: StudioHost, tool: string, what: string) {
  if (host.state().permission !== 'ask') return;
  const answer = await host.approve(tool, what);
  if (answer === 'no') throw new ToolError('The author didn’t allow it. Nothing was changed.');
  if (answer === 'unanswered') throw new ToolError('The author hasn’t answered whether you may make this change, so nothing was changed. Ask them in your reply, and do it once they say yes.');
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
const words = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A preference's value as the author would read it. */
function shown(key: string, v: unknown): string {
  if (key === 'zoom') return `${Math.round(Number(v) * 100)}%`;
  if (key === 'editorFontSize') return `${v} px`;
  if (key === 'autoSaveMinutes') return v === 0 ? 'off' : `every ${v} minute${v === 1 ? '' : 's'}`;
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  return String(v);
}

const ASSISTANT_IDS = ASSISTANTS as readonly string[];

/** The preferences, also when wrapped as {"settings": {…}} or {"settings": "{…}"} (as Claude Code's Haiku sends them). */
function unwrapped(input: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(input);
  if (keys.length !== 1 || (keys[0] !== 'settings' && keys[0] !== 'preferences')) return input;
  let inner = input[keys[0]];
  if (typeof inner === 'string') {
    try {
      inner = JSON.parse(inner);
    } catch {
      return input;
    }
  }
  return inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as Record<string, unknown>) : input;
}

/** Pages at a time: each is an image for the model to read. */
export const MAX_PAGES = 4;
/** Pages are drawn at this resolution (11 pt text about 17 px tall), unless a page would then be longer than MAX_SIDE pixels. */
const PAGE_PPI = 110;
const MAX_SIDE = 1600;

/** "41", "41-42", "pages 12, 30" (or a number): the pages asked for, in order and each once (the first MAX_PAGES), and how many that was; null if it isn't pages. */
export function parsePages(v: unknown): { pages: number[]; asked: number } | null {
  const text = (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '').replace(/\b(pages?|pp?)\b\.?/gi, ' ');
  const parts = text
    .replace(/\s*(?:[-–—]|\bto\b)\s*/gi, '-')
    .split(/[\s,;&]+|\band\b/i)
    .filter(Boolean);
  if (!parts.length) return null;
  const pages: number[] = [];
  let asked = 0;
  for (const part of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (a < 1 || b < a) return null;
    for (let p = a; p <= b; p++) {
      if (pages.includes(p)) continue;
      asked++;
      if (pages.length < MAX_PAGES) pages.push(p);
      // A range over the whole book needs no more counting than that.
      if (asked > 10_000) break;
    }
  }
  return { pages, asked };
}

/** A PNG's size in pixels, from its header (base64); null if it isn't one. */
export function pngSize(data: string): { width: number; height: number } | null {
  try {
    const head = atob(data.slice(0, 32));
    if (head.slice(12, 16) !== 'IHDR') return null;
    const n = (i: number) => ((head.charCodeAt(i) << 24) | (head.charCodeAt(i + 1) << 16) | (head.charCodeAt(i + 2) << 8) | head.charCodeAt(i + 3)) >>> 0;
    return { width: n(16), height: n(20) };
  } catch {
    return null;
  }
}

/** "page 41", "pages 41–42", "pages 12, 30 and 31". */
function pagesWords(pages: number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`;
  const run = pages.every((p, i) => i === 0 || p === pages[i - 1] + 1);
  return run ? `pages ${pages[0]}–${pages[pages.length - 1]}` : `pages ${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** What the preview shows, said once at the top of what a tool found there. */
function previewWords(shows: PreviewShows): string {
  if (shows.kind === 'chapter')
    return `The preview shows ${shows.chapter} alone (the author previews one chapter at a time), so these are that chapter's pages, not the whole book's: its page numbers, and its references to other chapters, are right only in the whole book.`;
  if (shows.kind === 'cover') return 'The preview shows the book’s cover now, with its guides (trim, bleed and spine), not the book’s pages.';
  return '';
}

/** Said when what a tool found may be from before the latest change. */
const NOT_SETTLED = 'It was still being typeset after the latest change, so this may be from just before it.';

const COMMENT_NOTE =
  'To work through them all, the author can press Fix all in Review: they come to you with a way to report on each, and the author keeps or undoes each change. If they ask you to fix some here instead, make the changes and say which comment each one answers.';

const short = (s: string, n = 160) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

export const TOOLS: Tool[] = [
  {
    name: 'get_settings',
    title: 'Foreword’s settings',
    description:
      'What Foreword is set to now: the writing assistant (which program, its model, effort and chat mode), the assistants it can switch to, and every app preference you can change with change_settings, with what each one does and the values it takes. Call this before changing anything.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    run: (_input, host) => {
      const s = host.state();
      const model = s.model ? s.models.find((m) => m.providerID === s.model!.providerID && m.id === s.model!.id) : null;
      return json({
        assistant: {
          id: s.assistant,
          name: ASSISTANT_NAMES[s.assistant],
          model: model ? { id: model.id, name: model.name, provider: model.providerName } : s.model,
          effort: s.efforts.length ? { level: s.effort, levels: s.efforts.map((e) => e.value) } : 'this model has no effort setting',
          mode: { id: s.mode, about: modeConfig(s.mode).description, modes: AGENT_MODES },
        },
        assistants: ASSISTANTS.map((id) => ({ id, name: ASSISTANT_NAMES[id] })),
        preferences: Object.fromEntries(
          Object.entries(PREFERENCES).map(([key, p]) => [key, { value: key === 'zoom' ? s.zoom : s.settings[key as keyof AppSettings], about: p.about, values: p.values }]),
        ),
        changing: PERMISSION_WORDS[s.permission],
        authorOnly: AUTHOR_ONLY_NOTE,
        book: BOOK_NOTE,
      });
    },
  },
  {
    name: 'change_settings',
    title: 'Change Foreword’s preferences',
    description:
      'Change app preferences, at once: give only the ones to change, with the values get_settings lists (e.g. {"editorFontSize": 14, "rulers": [80]}). Not for the assistant, model, effort or mode (switch_assistant, set_model, set_mode), and not for permissions or programs, which only the author changes.',
    inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(PREFERENCES).map(([k, p]) => [k, { ...p.schema, description: p.about }])) },
    run: async (given, host) => {
      mayChange(host);
      const input = unwrapped(given);
      const keys = Object.keys(input);
      if (!keys.length) throw new ToolError('Nothing to change: give the preferences to change and their new values (see get_settings).');
      const refused = keys.filter((k) => AUTHOR_ONLY[k]);
      if (refused.length) throw new ToolError(`You can’t change ${refused.map((k) => AUTHOR_ONLY[k]).join(' or ')}: ${AUTHOR_ONLY_NOTE}`);
      const elsewhere: Record<string, string> = { assistant: 'switch_assistant', model: 'set_model', effort: 'set_model', mode: 'set_mode' };
      const moved = keys.filter((k) => elsewhere[k]);
      if (moved.length) throw new ToolError(`${moved.join(', ')}: use ${[...new Set(moved.map((k) => elsewhere[k]))].join(' and ')} instead.`);
      const unknown = keys.filter((k) => !PREFERENCES[k]);
      if (unknown.length) throw new ToolError(`No such preference: ${unknown.join(', ')}. The ones you can change: ${Object.keys(PREFERENCES).join(', ')}.`);
      const { zoom, ...rest } = input;
      const patch = sanitize(rest);
      const bad = Object.keys(rest).filter((k) => !(k in patch));
      // Rulers are kept to those that are columns: one that isn't is a mistake to say.
      if (Array.isArray(rest.rulers) && patch.rulers && patch.rulers.length !== new Set(rest.rulers).size && !bad.includes('rulers')) bad.push('rulers');
      if (zoom !== undefined && !(typeof zoom === 'number' && zoom >= ZOOM_STEPS[0] && zoom <= ZOOM_STEPS[ZOOM_STEPS.length - 1])) bad.push('zoom');
      if (bad.length) throw new ToolError(`Not a value it takes: ${bad.map((k) => `${k} (${PREFERENCES[k].values})`).join('; ')}. Nothing was changed.`);
      await approved(host, 'change_settings', describeTool(`${STUDIO_TOOLS}_change_settings`, input, NO_NAMES).note ?? keys.join(', '));
      const before = host.state();
      host.changePreferences(patch, zoom as number | undefined);
      // In the order asked.
      const applied: Record<string, unknown> = { ...patch, ...(zoom !== undefined ? { zoom } : {}) };
      const changes = keys.map((k) => [k, applied[k]] as const).map(([k, v]) => {
        const was = k === 'zoom' ? before.zoom : before.settings[k as keyof AppSettings];
        return JSON.stringify(was) === JSON.stringify(v) ? `${k} was already ${shown(k, v)}` : `${k}: ${shown(k, was)} → ${shown(k, v)}`;
      });
      return `Changed (in effect now): ${changes.join('; ')}.`;
    },
  },
  {
    name: 'list_models',
    title: 'The assistant’s models',
    description: 'The models the current assistant offers (id, name, provider), and the current one’s effort levels. Give part of a name to narrow a long list.',
    inputSchema: { type: 'object', properties: { search: { type: 'string', description: 'Words in the model’s name or id, e.g. "sonnet"' } }, additionalProperties: false },
    readOnly: true,
    run: (input, host) => {
      const s = host.state();
      const search = words(input.search);
      const found = s.models.filter((m) => m.supportsTools && matchesQuery(m, search));
      const shownModels = found.slice(0, 80);
      return json({
        assistant: ASSISTANT_NAMES[s.assistant],
        current: s.model?.id ?? null,
        currentEfforts: s.efforts.map((e) => e.value),
        models: shownModels.map((m) => ({ id: m.id, name: m.name, provider: m.providerName })),
        ...(found.length > shownModels.length ? { more: `${found.length - shownModels.length} more: give a search to narrow the list` } : {}),
      });
    },
  },
  {
    name: 'set_model',
    title: 'Change the model or effort',
    description:
      'Change the current assistant’s model, effort, or both, from the author’s next message on (it changes when your reply ends). model: its id or part of its name ("sonnet"), or "default" for the assistant’s own default. effort: one of the model’s levels (e.g. "low", "high"; get_settings lists them).',
    inputSchema: {
      type: 'object',
      properties: { model: { type: 'string', description: 'A model id or part of its name, or "default"' }, effort: { type: 'string', description: 'An effort level, e.g. "high"' } },
      additionalProperties: false,
    },
    run: async (input, host) => {
      mayChange(host);
      const model = words(input.model);
      const effort = words(input.effort);
      if (!model && !effort) throw new ToolError('Give a model, an effort, or both.');
      const s = host.state();
      if (model && model.toLowerCase() !== 'default' && !s.models.some((m) => m.supportsTools && (m.id === model || matchesQuery(m, model)))) {
        throw new ToolError(`${ASSISTANT_NAMES[s.assistant]} has no model like “${model}”. list_models lists them.`);
      }
      // The same model: its levels are known now.
      if (effort && !model && s.efforts.length && !effortFor(effort, s.efforts)) throw new ToolError(`This model’s effort levels are ${s.efforts.map((e) => e.value).join(', ')}: “${effort}” isn’t one.`);
      if (effort && !model && !s.efforts.length) throw new ToolError('This model has no effort setting.');
      await approved(host, 'set_model', [model && `model “${model}”`, effort && `effort “${effort}”`].filter(Boolean).join(', '));
      host.whenIdle(() => host.chooseModel({ model: model || undefined, effort: effort || undefined }));
      return `When your reply ends, Foreword ${[model && `switches the model to “${model}”`, effort && `sets the effort to “${effort}”`].filter(Boolean).join(' and ')}, for the author’s next message. The chat says if it can’t.`;
    },
  },
  {
    name: 'switch_assistant',
    title: 'Switch the writing assistant',
    description: `Make another program the writing assistant: ${ASSISTANTS.map((id) => `${id} (${ASSISTANT_NAMES[id]})`).join(', ')}. It happens when your reply ends, and the task carries on with it, as with another model: the author's next message goes to the other, with the chat so far. Optionally its model ("default" for its own) and effort.`,
    inputSchema: {
      type: 'object',
      properties: {
        assistant: { type: 'string', enum: [...ASSISTANTS], description: 'Which program' },
        model: { type: 'string', description: 'Its model: an id or part of a name, or "default"' },
        effort: { type: 'string', description: 'An effort level, e.g. "high"' },
      },
      required: ['assistant'],
      additionalProperties: false,
    },
    run: async (input, host) => {
      mayChange(host);
      const id = words(input.assistant).toLowerCase();
      if (!ASSISTANT_IDS.includes(id)) throw new ToolError(`No assistant is called “${id}”: ${ASSISTANTS.join(', ')}.`);
      const choice = { model: words(input.model) || undefined, effort: words(input.effort) || undefined };
      const s = host.state();
      const then = [choice.model && `model “${choice.model}”`, choice.effort && `effort “${choice.effort}”`].filter(Boolean).join(', ');
      if (id === s.assistant) {
        if (!choice.model && !choice.effort) return `${ASSISTANT_NAMES[id as AssistantId]} is the assistant already.`;
        await approved(host, 'set_model', then);
        host.whenIdle(() => host.chooseModel(choice));
        return `${ASSISTANT_NAMES[id as AssistantId]} is the assistant already; its ${[choice.model && 'model', choice.effort && 'effort'].filter(Boolean).join(' and ')} change${choice.model && choice.effort ? '' : 's'} when your reply ends.`;
      }
      await approved(host, 'switch_assistant', `${ASSISTANT_NAMES[id as AssistantId]}${then ? ` (${then})` : ''}`);
      host.whenIdle(() => host.switchAssistant(id as AssistantId, choice));
      return `When your reply ends, Foreword switches to ${ASSISTANT_NAMES[id as AssistantId]}${then ? ` (${then})` : ''}, and this task carries on with it: the author's next message goes to ${ASSISTANT_NAMES[id as AssistantId]}, with the chat so far. Tell the author so.`;
    },
  },
  {
    name: 'set_mode',
    title: 'Change the chat’s mode',
    description: `The chat's mode, from the author's next message on (it changes when your reply ends): ${AGENT_MODES.map((m) => `${m} (${modeConfig(m).description})`).join('; ')}`,
    inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: [...AGENT_MODES] } }, required: ['mode'], additionalProperties: false },
    run: async (input, host) => {
      mayChange(host);
      const mode = modeNamed(words(input.mode));
      if (!mode) throw new ToolError(`No mode is called “${words(input.mode)}”: ${AGENT_MODES.join(', ')}.`);
      if (mode === host.state().mode) return `The chat is in ${modeConfig(mode).label} mode already.`;
      await approved(host, 'set_mode', `${modeConfig(mode).label} mode`);
      host.whenIdle(() => host.setMode(mode));
      return `When your reply ends, the chat switches to ${modeConfig(mode).label} mode.`;
    },
  },
  {
    name: 'open_settings',
    title: 'Open Settings for the author',
    description:
      'Open Foreword’s Settings at a page, for the author to see or change something themselves (the only way to change permissions or the programs it runs). Pages: general, editor, spelling (spelling and grammar checking, the author’s dictionary), assistant, permissions, tools, book (this book’s settings), book-spelling (this book’s language and dictionary), book-assistant (this book’s assistant permissions), book-color (the colour this book’s window wears).',
    inputSchema: { type: 'object', properties: { page: { type: 'string', enum: [...SETTINGS_PAGES] } }, additionalProperties: false },
    run: (input, host) => {
      const page = words(input.page) as ToolsSettingsPage;
      if (page && !SETTINGS_PAGES.includes(page)) throw new ToolError(`No such page: ${SETTINGS_PAGES.join(', ')}.`);
      host.openSettings(page || undefined);
      return `Settings is open${page ? ` at ${page}` : ''} for the author.`;
    },
  },
  {
    name: 'view_pages',
    title: 'Look at pages of the book',
    description: `See pages of the book as they're typeset now, as images, with any text the author hasn't saved yet. For what the source can't show: where a figure or table landed and whether it fits, a heading left alone at the foot of a page, a chapter opening on a left-hand page, a page left mostly empty, spacing and alignment, how a layout change came out. Pages count from the document's first page (1), which isn't always the number printed on it; book_outline says on which page each chapter and section starts. Up to ${MAX_PAGES} pages at a time.`,
    inputSchema: {
      type: 'object',
      properties: { pages: { type: 'string', description: 'A page, a range or a list, counted from the first page: "41", "41-42", "12, 30"' } },
      required: ['pages'],
      additionalProperties: false,
    },
    readOnly: true,
    run: async (input, host) => {
      const asked = parsePages(input.pages);
      if (!asked) throw new ToolError('Give the pages as a number, a range or a list, like "41", "41-42" or "12, 30", counted from the first page (book_outline says where each chapter starts).');
      const book = host.book;
      const settled = await book.settled();
      const { shows, pages: count } = book.preview();
      const what = shows.kind === 'cover' ? 'The cover' : shows.kind === 'chapter' ? capital(shows.chapter) : 'The book';
      const beyond = count ? asked.pages.filter((p) => p > count) : [];
      const want = asked.pages.filter((p) => !beyond.includes(p));
      if (!want.length) throw new ToolError(`${what} has ${plural(count!, 'page')}: there's no ${pagesWords(beyond)}.`);
      // With an error, Typst makes no pages: the preview keeps the last ones it could.
      const draw = (ppi: number) =>
        book.pageImages(want, ppi).catch((e) => {
          if (book.preview().status === 'error')
            throw new ToolError('Typst has an error just now, so there are no pages to look at until it’s fixed: book_problems lists it. (The preview keeps showing the last pages it could make.)');
          throw e;
        });
      let got = await draw(PAGE_PPI);
      // A big page (a poster, a cover spread) drawn smaller, so it isn't more than the model looks at.
      const longest = Math.max(0, ...got.pages.map((p) => pngSize(p.data)).map((s) => (s ? Math.max(s.width, s.height) : 0)));
      if (longest > MAX_SIDE) got = await draw(Math.max(36, Math.floor((PAGE_PPI * MAX_SIDE) / longest)));
      if (!got.pages.length) throw new ToolError(`Foreword couldn’t draw ${pagesWords(want)}${got.total ? `: ${what.toLowerCase()} has ${plural(got.total, 'page')}` : ''}.`);
      const shown = got.pages.map((p) => p.page);
      const said = [
        `${capital(pagesWords(shown))} of ${got.total || count || '?'}${shows.kind === 'book' ? ', as the book is typeset now' : ''}${shown.length > 1 ? ', in that order' : ''}.`,
        previewWords(shows),
        beyond.length ? `There's no ${pagesWords(beyond)}: ${what.toLowerCase()} has ${plural(count!, 'page')}.` : '',
        asked.asked > asked.pages.length ? `You asked for ${plural(asked.asked, 'page')}; these are the first ${MAX_PAGES}. Ask for the others in turn.` : '',
        settled ? '' : NOT_SETTLED,
      ];
      return { text: said.filter(Boolean).join(' '), images: got.pages.map((p) => p.data) };
    },
  },
  {
    name: 'book_outline',
    title: 'Where the chapters fall',
    description:
      'Where each chapter and section starts in the book as typeset now: its title, its page (counted from the first page, as view_pages counts them, not the numbers printed on them) and, where Foreword can tell, the file and line it is written on; and how many pages there are. To find the pages to look at, or to check how long chapters run.',
    inputSchema: {
      type: 'object',
      properties: { depth: { type: 'integer', minimum: 1, maximum: 6, description: 'How deep: 1 for chapters only, 2 (the default) with their sections, 3 or more for subsections' } },
      additionalProperties: false,
    },
    readOnly: true,
    run: async (input, host) => {
      const book = host.book;
      const settled = await book.settled();
      const outline = book.outline();
      const { shows, pages } = book.preview();
      if (!outline)
        throw new ToolError('Foreword hasn’t had the book typeset with its preview open yet, so it can’t say where the pages fall. view_pages still shows any page, by its number.');
      const depth = Math.min(6, Math.max(1, Math.round(Number(input.depth)) || 2));
      const rows = outline.headings.filter((h) => h.level <= depth);
      const shownRows = rows.slice(0, 400);
      const head = [
        pages ? `${plural(pages, 'page')}${shows.kind === 'book' ? ', as the book is typeset now' : ''}.` : '',
        previewWords(shows),
        outline.stale || !settled ? 'This is from just before the latest change, which is still being typeset.' : '',
      ].filter(Boolean);
      if (!rows.length) return [...head, outline.headings.length ? `No headings at level ${depth} or above: give a greater depth.` : 'It has no headings in its outline.'].join(' ');
      const lines = shownRows.map((h) => `${'  '.repeat(h.level - 1)}p. ${h.page}  ${h.title}${h.at ? `  (${h.at})` : ''}`);
      const more = rows.length - shownRows.length;
      return [head.join(' '), 'Each heading’s page, and where it’s written:', ...lines, more ? `…and ${plural(more, 'more heading')}: give a smaller depth to see them all.` : ''].filter(Boolean).join('\n');
    },
  },
  {
    name: 'book_problems',
    title: 'Typst’s errors and warnings',
    description:
      'Typst’s errors and warnings in the book now, as the editor marks them, and references that point to no label: each one’s file, line and message. An error stops the book from typesetting (the preview keeps the last pages it could make) until it’s fixed; a warning doesn’t. It waits for typesetting to catch up with the latest changes first, so call it after an edit to check you left none.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    run: async (_input, host) => {
      const settled = await host.book.settled();
      const list = host.book.problems();
      const late = settled ? '' : ` ${NOT_SETTLED}`;
      if (!list.length) return `No errors or warnings: the book typesets cleanly.${late}`;
      const errors = list.filter((p) => p.severity === 'error').length;
      const warnings = list.length - errors;
      const shownList = list.slice(0, 60);
      const counts = [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' and ');
      return [
        `${capital(counts)}:${late}`,
        ...shownList.map((p) => `- ${p.severity} at ${p.path}:${p.line}:${p.column}: ${short(p.message, 400)}`),
        list.length > shownList.length ? `…and ${list.length - shownList.length} more.` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    name: 'review_comments',
    title: 'The author’s review comments',
    description:
      'The author’s review comments: notes they left on passages of the book, in Review, beside the text (never in it). Each one’s file and line as the text is now, the passage it’s on, and what it says: those still open, and those you changed that wait for the author to keep or undo.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    run: async (_input, host) => {
      const rows = await host.book.comments();
      if (!rows.length) return 'The author has no review comments open.';
      const row = (r: CommentRow) => `- ${r.id} at ${r.line ? `${r.path}:${r.line}` : `${r.path} (its passage has changed since, so it isn’t found)`}, on “${short(r.quote)}”: ${r.text}`;
      const open = rows.filter((r) => r.status === 'open');
      const addressed = rows.filter((r) => r.status === 'addressed');
      return [
        open.length ? `${capital(plural(open.length, 'open comment'))}:` : 'No comments are open.',
        ...open.map(row),
        addressed.length ? `\n${capital(plural(addressed.length, 'comment'))} you changed the passage for, waiting for the author to keep or undo:` : '',
        ...addressed.map(row),
        open.length ? `\n${COMMENT_NOTE}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
];

const SERVER_INSTRUCTIONS =
  'Foreword’s own tools. Its settings: when the author asks to change how Foreword works (which assistant, model, effort or chat mode, the editor’s text size, wrapping, rulers, marks, zoom…), use these tools rather than editing files. get_settings first. Changes to the assistant itself happen when your reply ends. And the book as the author sees it, which its files don’t show: view_pages (its pages as typeset now, as images), book_outline (the page each chapter and section starts on), book_problems (Typst’s errors and warnings) and review_comments (the author’s notes on passages).';

/** The MCP versions this server speaks (the newest first); a client's own is used when it's one of them. */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** One JSON-RPC message: its answer, or null for a notification (or a client's own answer). */
async function answer(m: RpcMessage, host: StudioHost): Promise<object | null> {
  if (typeof m?.method !== 'string') return null;
  const notification = m.id === undefined || m.id === null;
  const ok = (result: object) => ({ jsonrpc: '2.0', id: m.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } });
  switch (m.method) {
    case 'initialize': {
      const asked = String(m.params?.protocolVersion ?? '');
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: STUDIO_TOOLS, title: 'Foreword', version: '1' },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case 'ping':
      return notification ? null : ok({});
    case 'tools/list':
      return ok({
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: false, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return fail(-32602, `No tool called ${String(m.params?.name)}`);
      const args = m.params?.arguments;
      try {
        const out = await tool.run(args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}, host);
        const { text, images = [] } = typeof out === 'string' ? { text: out } : out;
        return ok({ content: [{ type: 'text', text }, ...images.map((data) => ({ type: 'image', data, mimeType: 'image/png' }))] });
      } catch (e) {
        const message = e instanceof ToolError ? e.message : `Foreword couldn’t do it: ${e instanceof Error ? e.message : String(e)}`;
        return ok({ content: [{ type: 'text', text: message }], isError: true });
      }
    }
  }
  return notification ? null : fail(-32601, `${m.method} isn’t supported`);
}

/** An HTTP request's body (one message, or a batch): the reply's body, or null when there's nothing to send back. */
export async function handleMcp(body: string, host: StudioHost): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Not JSON' } });
  }
  if (Array.isArray(parsed)) {
    const answers = (await Promise.all(parsed.map((m) => answer(m as RpcMessage, host)))).filter(Boolean);
    return answers.length ? JSON.stringify(answers) : null;
  }
  const one = await answer(parsed as RpcMessage, host);
  return one ? JSON.stringify(one) : null;
}
