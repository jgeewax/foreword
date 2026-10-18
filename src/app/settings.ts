// App preferences (per machine, not per project). Project settings live in
// .typst-studio.json instead.
import { DEFAULT_PERMISSIONS, PRESETS, sanitizePermissions, type AgentPermissions } from '../services/agent/permissions';

export type SendKey = 'enter' | 'mod-enter';

/** Where History lives in the left pane: its own tab, or a section below the files. */
export type HistoryPlacement = 'tab' | 'below';

/** Which program runs the writing assistant: OpenCode, or an agent spoken to over ACP. */
export type AssistantId = 'opencode' | 'claude' | 'gemini' | 'codex' | 'antigravity';
export const ASSISTANTS: AssistantId[] = ['opencode', 'claude', 'gemini', 'codex', 'antigravity'];
export const ASSISTANT_NAMES: Record<AssistantId, string> = { opencode: 'OpenCode', claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex', antigravity: 'Antigravity' };
// Google's is Antigravity now: Gemini CLI, which it replaced, no longer takes personal Google logins.
const ASSISTANT_MAKERS: Record<string, AssistantId> = { anthropic: 'claude', google: 'antigravity', agy: 'antigravity', openai: 'codex', chatgpt: 'codex' };

/** The assistants a word could name, for /assistant: the start of an id or name ("claude", "gem", "open"), or the maker. */
export function assistantsFor(word: string): AssistantId[] {
  const w = word.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!w) return [];
  if (ASSISTANT_MAKERS[w]) return [ASSISTANT_MAKERS[w]];
  return ASSISTANTS.filter((id) => id.startsWith(w) || ASSISTANT_NAMES[id].toLowerCase().startsWith(w));
}

/** Where the editor wraps a long line: at its edge, at a column (or the edge, if that comes first), or nowhere. */
export type WordWrap = 'window' | 'column' | 'off';

/** The programs Typst Studio runs itself; Settings ▸ Tools can choose each one. */
export type ToolName = 'tinymist' | 'opencode' | 'git';
export const TOOL_NAMES: ToolName[] = ['tinymist', 'opencode', 'git'];

export type AppSettings = {
  /** Which key sends a chat message. */
  sendKey: SendKey;
  /** What the assistant may do (see permissions.ts). */
  permissions: AgentPermissions;
  historyPlacement: HistoryPlacement;
  /** Mark the lines the assistant changed (from History), in the editor's gutter; off, they look like the author's. */
  markAiEdits: boolean;
  /** Mark the lines the assistant read in the current conversation. */
  markAiReads: boolean;
  /** The colours of those marks (#rrggbb). */
  aiEditColor: string;
  aiReadColor: string;
  /** Commands the assistant may run without asking, in every book (e.g. "python3"), besides those that only look. */
  allowCommands: string[];
  /** Format Typst files (typstyle, through Tinymist) when the author saves them. */
  formatOnSave: boolean;
  /** The editor's text size in px (before the UI zoom), as VS Code's editor.fontSize. */
  editorFontSize: number;
  /** Where long lines wrap, as VS Code's editor.wordWrap ('window' is its "on", 'column' its "bounded"). */
  wordWrap: WordWrap;
  /** The column they wrap at, with wordWrap 'column', as VS Code's editor.wordWrapColumn. */
  wordWrapColumn: number;
  /** A vertical line at each of these columns, as VS Code's editor.rulers (ascending; none by default). */
  rulers: number[];
  /** Programs chosen in Settings ▸ Tools (absent: found automatically). The Rust side reads these from the settings file. */
  toolPaths: Partial<Record<ToolName, string>>;
  /** Which program runs the writing assistant. */
  assistant: AssistantId;
  /** Look for a new version of Typst Studio when it starts. */
  checkForUpdates: boolean;
  /** A version the author chose to skip: not offered at start ('' for none). */
  skippedUpdate: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  sendKey: 'enter',
  permissions: DEFAULT_PERMISSIONS,
  historyPlacement: 'tab',
  markAiEdits: true,
  markAiReads: true,
  aiEditColor: '#a371f7',
  aiReadColor: '#58a6ff',
  allowCommands: [],
  formatOnSave: true,
  editorFontSize: 12,
  wordWrap: 'window',
  wordWrapColumn: 80,
  rulers: [],
  toolPaths: {},
  assistant: 'opencode',
  checkForUpdates: true,
  skippedUpdate: '',
};

export const EDITOR_FONT_SIZES = { min: 9, max: 24 };

/** The editor's line height for a text size: VS Code's on macOS (1.5 times, rounded). */
export const editorLineHeight = (fontSize: number) => Math.round(fontSize * 1.5);

/** The columns the editor wraps at and draws rulers at (in characters). */
export const EDITOR_COLUMNS = { min: 20, max: 400 };
const MAX_RULERS = 8;

const isColumn = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= EDITOR_COLUMNS.min && n <= EDITOR_COLUMNS.max;

/** Rulers as typed ("80, 120"): ascending, each once; null if any isn't a column. Empty text is none. */
export function parseRulers(text: string): number[] | null {
  const words = text.split(/[\s,]+/).filter(Boolean);
  const columns = words.map(Number);
  if (!columns.every(isColumn)) return null;
  const out = [...new Set(columns)].sort((a, b) => a - b);
  return out.length <= MAX_RULERS ? out : null;
}

export const rulersText = (rulers: number[]) => rulers.join(', ');

const KEY = 'studio.settings';

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...sanitize(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

/** The marks' colour choices, besides one of the author's own. */
export const MARK_COLORS = [
  { color: '#a371f7', name: 'Violet' },
  { color: '#58a6ff', name: 'Blue' },
  { color: '#3fb950', name: 'Green' },
  { color: '#d29922', name: 'Yellow' },
  { color: '#f0883e', name: 'Orange' },
  { color: '#db61a2', name: 'Pink' },
];

const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** A command name to allow ("python3", "git add"): one or two plain words, no wildcards or shell syntax. */
export const isCommandName = (c: string) => /^[A-Za-z0-9][\w.+-]*( [A-Za-z0-9][\w.+-]*)?$/.test(c) && c.length <= 40;

export function sanitizeCommands(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const c of raw) if (typeof c === 'string' && isCommandName(c.trim()) && !out.includes(c.trim())) out.push(c.trim());
  return out.slice(0, 50);
}

export function sanitize(raw: Record<string, unknown>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {};
  if (raw.sendKey === 'enter' || raw.sendKey === 'mod-enter') out.sendKey = raw.sendKey;
  const permissions = sanitizePermissions(raw.permissions);
  if (permissions) out.permissions = permissions;
  // Before fine-grained permissions there was one switch: edit without asking, or ask.
  else if (raw.agentEdits === 'allow') out.permissions = PRESETS.edit.permissions;
  if (raw.historyPlacement === 'tab' || raw.historyPlacement === 'below') out.historyPlacement = raw.historyPlacement;
  if (typeof raw.markAiEdits === 'boolean') out.markAiEdits = raw.markAiEdits;
  if (typeof raw.markAiReads === 'boolean') out.markAiReads = raw.markAiReads;
  if (isColor(raw.aiEditColor)) out.aiEditColor = raw.aiEditColor.toLowerCase();
  if (isColor(raw.aiReadColor)) out.aiReadColor = raw.aiReadColor.toLowerCase();
  if (Array.isArray(raw.allowCommands)) out.allowCommands = sanitizeCommands(raw.allowCommands);
  if (typeof raw.formatOnSave === 'boolean') out.formatOnSave = raw.formatOnSave;
  const size = raw.editorFontSize;
  if (typeof size === 'number' && size >= EDITOR_FONT_SIZES.min && size <= EDITOR_FONT_SIZES.max) out.editorFontSize = Math.round(size * 2) / 2;
  if (raw.wordWrap === 'window' || raw.wordWrap === 'column' || raw.wordWrap === 'off') out.wordWrap = raw.wordWrap;
  if (isColumn(raw.wordWrapColumn)) out.wordWrapColumn = raw.wordWrapColumn;
  if (Array.isArray(raw.rulers)) {
    const rulers = raw.rulers.filter(isColumn);
    out.rulers = [...new Set(rulers)].sort((a, b) => a - b).slice(0, MAX_RULERS);
  }
  if (raw.toolPaths && typeof raw.toolPaths === 'object' && !Array.isArray(raw.toolPaths)) out.toolPaths = sanitizeToolPaths(raw.toolPaths as Record<string, unknown>);
  if (ASSISTANTS.includes(raw.assistant as AssistantId)) out.assistant = raw.assistant as AssistantId;
  if (typeof raw.checkForUpdates === 'boolean') out.checkForUpdates = raw.checkForUpdates;
  if (typeof raw.skippedUpdate === 'string' && /^[\w.+-]{0,40}$/.test(raw.skippedUpdate)) out.skippedUpdate = raw.skippedUpdate;
  return out;
}

/** Paths for the known tools only: non-empty strings, trimmed. */
export function sanitizeToolPaths(raw: Record<string, unknown>): Partial<Record<ToolName, string>> {
  const out: Partial<Record<ToolName, string>> = {};
  for (const tool of TOOL_NAMES) {
    const p = raw[tool];
    if (typeof p === 'string' && p.trim() && p.length <= 1024) out[tool] = p.trim();
  }
  return out;
}

type KeyLike = { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing?: boolean; keyCode?: number };

/**
 * What a key press in the chat composer does. Enter mode: Enter sends, ⇧Enter
 * is a new line. ⌘Enter mode: ⌘Enter sends, Enter is a new line. ⌘Enter always
 * sends. Enter that confirms an input-method composition never sends.
 */
export function composerKeyAction(e: KeyLike, sendKey: SendKey): 'send' | 'send-now' | null {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return null;
  // ⌥⏎ while the assistant works: hand the message to it now, not after.
  if (e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey) return 'send-now';
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && !e.altKey) return 'send';
  if (sendKey === 'enter' && !mod && !e.shiftKey && !e.altKey) return 'send';
  return null;
}

export function sendHint(sendKey: SendKey): string {
  return sendKey === 'enter' ? '⏎ send · ⇧⏎ new line' : '⌘⏎ send · ⏎ new line';
}
