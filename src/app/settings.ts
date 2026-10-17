// App preferences (per machine, not per project). Project settings live in
// .typst-studio.json instead.

export type SendKey = 'enter' | 'mod-enter';

export type AppSettings = {
  /** Which key sends a chat message. */
  sendKey: SendKey;
};

export const DEFAULT_SETTINGS: AppSettings = {
  sendKey: 'enter',
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
  return out;
}

type KeyLike = { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing?: boolean; keyCode?: number };

/**
 * What a key press in the chat composer does. Enter mode: Enter sends, ⇧Enter
 * is a new line. ⌘Enter mode: ⌘Enter sends, Enter is a new line. ⌘Enter always
 * sends. Enter that confirms an input-method composition never sends.
 */
export function composerKeyAction(e: KeyLike, sendKey: SendKey): 'send' | null {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && !e.altKey) return 'send';
  if (sendKey === 'enter' && !mod && !e.shiftKey && !e.altKey) return 'send';
  return null;
}

export function sendHint(sendKey: SendKey): string {
  return sendKey === 'enter' ? '⏎ send · ⇧⏎ new line' : '⌘⏎ send · ⏎ new line';
}
