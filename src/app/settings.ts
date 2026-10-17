// App preferences (per machine, not per project). Project settings live in
// .typst-studio.json instead.
import { DEFAULT_PERMISSIONS, PRESETS, sanitizePermissions, type AgentPermissions } from '../services/agent/permissions';

export type SendKey = 'enter' | 'mod-enter';

/** Where History lives in the left pane: its own tab, or a section below the files. */
export type HistoryPlacement = 'tab' | 'below';

export type AppSettings = {
  /** Which key sends a chat message. */
  sendKey: SendKey;
  /** What the assistant may do (see permissions.ts). */
  permissions: AgentPermissions;
  historyPlacement: HistoryPlacement;
  /** Mark the lines the assistant changed (from History), in the editor's gutter. */
  markAiEdits: boolean;
  /** Mark the lines the assistant read in the current conversation. */
  markAiReads: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  sendKey: 'enter',
  permissions: DEFAULT_PERMISSIONS,
  historyPlacement: 'tab',
  markAiEdits: true,
  markAiReads: true,
};

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

function sanitize(raw: Record<string, unknown>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {};
  if (raw.sendKey === 'enter' || raw.sendKey === 'mod-enter') out.sendKey = raw.sendKey;
  const permissions = sanitizePermissions(raw.permissions);
  if (permissions) out.permissions = permissions;
  // Before fine-grained permissions there was one switch: edit without asking, or ask.
  else if (raw.agentEdits === 'allow') out.permissions = PRESETS.edit.permissions;
  if (raw.historyPlacement === 'tab' || raw.historyPlacement === 'below') out.historyPlacement = raw.historyPlacement;
  if (typeof raw.markAiEdits === 'boolean') out.markAiEdits = raw.markAiEdits;
  if (typeof raw.markAiReads === 'boolean') out.markAiReads = raw.markAiReads;
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
