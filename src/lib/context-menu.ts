// Native macOS context menus (Tauri menu API), for every pane. WebKit's own
// menu (Reload, Inspect Element) is suppressed: Reload would break the app.
// Option-right-click keeps WebKit's menu in dev builds, for debugging.
import { Menu } from '@tauri-apps/api/menu';
import { ipc } from './ipc';

export type MenuEntry =
  | { label: string; action: () => void; enabled?: boolean; accelerator?: string }
  | 'separator'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | null
  | false
  | undefined;

const PREDEFINED = { cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'SelectAll', separator: 'Separator' } as const;

/** Drop empty entries and doubled, leading or trailing separators. */
export function tidyEntries(entries: MenuEntry[]): Exclude<MenuEntry, null | false | undefined>[] {
  const out: Exclude<MenuEntry, null | false | undefined>[] = [];
  for (const e of entries) {
    if (!e) continue;
    if (e === 'separator' && (out.length === 0 || out[out.length - 1] === 'separator')) continue;
    out.push(e);
  }
  while (out[out.length - 1] === 'separator') out.pop();
  return out;
}

/** Self-test hook: record menus instead of showing them (a native popup is modal). */
export const menuRecorder: { record?: (entries: ReturnType<typeof tidyEntries>) => void } = {};

/** Show a native menu at the mouse. */
export async function showContextMenu(entries: MenuEntry[]) {
  const tidy = tidyEntries(entries);
  if (menuRecorder.record) return menuRecorder.record(tidy);
  const items = tidy.map((e) =>
    typeof e === 'string'
      ? { item: PREDEFINED[e] }
      : // A lone & marks a mnemonic (and disappears): && is a literal one, as in "Commit & Push".
        { text: e.label.replaceAll('&', '&&'), enabled: e.enabled ?? true, accelerator: e.accelerator, action: () => e.action() },
  );
  if (!items.length) return;
  const menu = await Menu.new({ items });
  await menu.popup();
}

/** React onContextMenu helper: stop WebKit's menu, show ours. */
export function onContextMenu(build: () => MenuEntry[]) {
  return (e: { preventDefault(): void; stopPropagation(): void; altKey?: boolean }) => {
    if (import.meta.env.DEV && e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    void showContextMenu(build()).catch((err) => console.error('context menu failed', err));
  };
}

const isEditable = (el: Element | null) => !!el?.closest('input, textarea, [contenteditable="true"]');

/**
 * Fallback for everything without its own menu: text fields get the usual
 * editing commands, selected text gets Copy, the rest gets nothing.
 */
export function installDefaultContextMenu() {
  window.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented || (import.meta.env.DEV && e.altKey)) return;
    e.preventDefault();
    const target = e.target as Element | null;
    if (isEditable(target)) void showContextMenu(['cut', 'copy', 'paste', 'separator', 'selectAll']);
    else if (String(window.getSelection() ?? '').trim()) void showContextMenu(['copy']);
  });
}

/** Copy via the native pasteboard (works from menu actions, which aren't DOM gestures). */
export function copyText(text: string) {
  return ipc.clipboardWrite(text).catch(() => navigator.clipboard.writeText(text));
}
