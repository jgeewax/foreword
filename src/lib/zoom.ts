// UI zoom (⌘= / ⌘+ / ⌘− / ⌘0), like VS Code's window zoom.

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];

export type ZoomAction = 'in' | 'out' | 'reset';

export function nextZoom(current: number, action: ZoomAction): number {
  if (action === 'reset') return 1;
  if (action === 'in') return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-6) ?? ZOOM_STEPS[0];
}

type KeyLike = Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>;

/** ⌘= and ⌘+ (⇧⌘=) zoom in, ⌘− zooms out, ⌘0 resets. */
export function zoomActionForKey(e: KeyLike): ZoomAction | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') return 'in';
  if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') return 'out';
  if (!e.shiftKey && (e.key === '0' || e.code === 'Numpad0')) return 'reset';
  return null;
}
