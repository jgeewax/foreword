// Preview → source: a click in the preview marks where it landed in the editor
// with the ring Tinymist draws in the preview when the editor sends it the
// other way (its colour; grows to a tenth of the pane's width as it fades).
import { monaco } from './monaco';

/** A ring that spreads from `pos` (if it's in view) and goes. */
export function rippleAt(editor: monaco.editor.ICodeEditor, pos: monaco.IPosition) {
  const host = editor.getDomNode();
  const at = editor.getScrolledVisiblePosition(pos);
  if (!host || !at) return;
  const ring = document.createElement('div');
  ring.className = 'jump-ripple';
  ring.style.left = `${at.left}px`;
  ring.style.top = `${at.top + at.height / 2}px`;
  ring.style.setProperty('--ripple', `${Math.round(editor.getLayoutInfo().width / 10)}px`);
  ring.addEventListener('animationend', () => ring.remove());
  // Inside the overflow guard (same origin as the editor), so the ring is clipped to the text area.
  (host.querySelector('.overflow-guard') ?? host).appendChild(ring);
}
