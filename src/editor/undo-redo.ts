// Edit → Undo and Redo (⌘Z, ⇧⌘Z) while the page has the keyboard: the menu
// sends them here (menu.rs, `edit_action`), as it takes those keys before the
// page sees them. AppKit's own undo acted on the focused field, which in the
// editor is Monaco's hidden stand-in: Monaco took the undo for typing, so ⌘Z
// took out a run of recent typing at once, then did nothing, and ⇧⌘Z nothing.
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { monaco } from './monaco';

/** The editor's own history when an editor has the keyboard, else the focused field's (WebKit's). */
export function undoRedo(which: 'undo' | 'redo') {
  const editor = monaco.editor.getEditors().find((e) => e.hasTextFocus());
  if (editor) editor.trigger('keyboard', which, null);
  else document.execCommand(which);
}

export function installUndoRedo() {
  const page = getCurrentWebview();
  void page.listen('undo', () => undoRedo('undo'));
  void page.listen('redo', () => undoRedo('redo'));
  // A press the menu didn't take reaches the page as a key (⇧⌘Z can): the
  // editor's own keys have it there; a field gets the same as from the menu.
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.code !== 'KeyZ' || !e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    undoRedo(e.shiftKey ? 'redo' : 'undo');
  });
}
