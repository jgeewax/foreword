// Edit → Select All (and ⌘A when nothing took the key) while the page has the
// keyboard: the menu sends it here (menu.rs, `edit_action`) instead of letting
// WebKit select. WebKit's selects the focused field, and the editor's field is
// Monaco's hidden stand-in, not the text; with no field focused, it selects
// the whole page, line numbers, labels and all.
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { monaco } from './monaco';

const visible = (el: HTMLElement | null) => !!el?.isConnected && el.offsetParent !== null;

/** The editor in front: the file's, or the changed side of a diff in a tab. */
function frontEditor(): monaco.editor.ICodeEditor | null {
  const diffs = monaco.editor.getDiffEditors();
  const sides = new Set(diffs.flatMap((d) => [d.getOriginalEditor(), d.getModifiedEditor()]));
  const own = monaco.editor.getEditors().find((e) => !sides.has(e) && e.getModel() && visible(e.getContainerDomNode()));
  return own ?? diffs.find((d) => visible(d.getContainerDomNode()))?.getModifiedEditor() ?? null;
}

function selectAllIn(editor: monaco.editor.ICodeEditor) {
  const model = editor.getModel();
  if (!model) return;
  editor.focus();
  editor.setSelection(model.getFullModelRange());
}

/** The selectable text around an element: its outermost `user-select: text` ancestor. */
function textRegion(el: Element): Element | null {
  if (el.closest('.monaco-editor')) return null;
  let region: Element | null = null;
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    if (getComputedStyle(e).webkitUserSelect === 'text') region = e;
  }
  return region;
}

let lastPressed: Element | null = null;

/**
 * The editor's text when it has the focus; a text field's own text; else the
 * text last clicked in (the conversation, Typst basics), or the editor in front.
 */
export function selectAll() {
  const focused = document.activeElement;
  const editor = focused && monaco.editor.getEditors().find((e) => e.getContainerDomNode().contains(focused));
  if (editor && focused.matches('textarea.inputarea')) return selectAllIn(editor);
  if (focused?.matches('input, textarea, [contenteditable="true"]')) return void document.execCommand('selectAll');
  const region = lastPressed?.isConnected ? textRegion(lastPressed) : null;
  if (region) return void getSelection()?.selectAllChildren(region);
  const front = frontEditor();
  if (front) selectAllIn(front);
}

export function installSelectAll() {
  window.addEventListener('pointerdown', (e) => (lastPressed = e.target instanceof Element ? e.target : null), true);
  void getCurrentWebview().listen('select-all', () => selectAll());
}
