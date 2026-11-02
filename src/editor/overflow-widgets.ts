// Monaco's floating widgets (the hover, with spelling's fixes; suggestions)
// are fixed to the page so they can spill out of the editor
// (fixedOverflowWidgets), and Monaco lets them run past its right edge by
// their own width. The preview is a native view above the page, so what
// spills onto it is drawn under it: they're kept within the editor's width.
import type { monaco } from './monaco';

/** Clearance from the editor's edges. */
const MARGIN = 6;

/** How far left a widget must go to end inside `right`, never starting before `left`; 0 if it fits. */
export function shiftInside(widget: { left: number; right: number }, left: number, right: number): number {
  return Math.max(0, Math.min(widget.right - right, widget.left - left));
}

/** Keep the editor's overflowing widgets inside it. Returns its cleanup. */
export function keepWidgetsInside(editor: monaco.editor.ICodeEditor): () => void {
  let layer: Element | null = null;
  const fit = () => {
    const host = editor.getDomNode();
    if (!host || !layer) return;
    const box = host.getBoundingClientRect();
    for (const el of layer.children) {
      if (!(el instanceof HTMLElement) || el.style.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      const shift = r.width ? shiftInside(r, box.left + MARGIN, box.right - MARGIN) : 0;
      // Monaco writes `left` again only when its own place for it changes, and this runs then too.
      if (shift) el.style.left = `${parseFloat(el.style.left || '0') - shift}px`;
    }
  };
  const observer = new MutationObserver(fit);
  // The layer is made with the editor's view, which comes with a file and is made again with each one.
  const watch = () => {
    observer.disconnect();
    layer = editor.getDomNode()?.querySelector('.overflowingContentWidgets') ?? null;
    if (layer) observer.observe(layer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  };
  watch();
  const sub = editor.onDidChangeModel(watch);
  return () => {
    sub.dispose();
    observer.disconnect();
  };
}
