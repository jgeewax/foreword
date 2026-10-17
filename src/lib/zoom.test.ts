import { describe, expect, it } from 'vitest';
import { nextZoom, zoomActionForKey } from './zoom';

const key = (k: string, mods: Partial<{ meta: boolean; shift: boolean; ctrl: boolean; alt: boolean }> = {}, code = '') => ({
  key: k,
  code,
  metaKey: mods.meta ?? true,
  shiftKey: mods.shift ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
});

describe('zoomActionForKey', () => {
  it('maps ⌘= and ⌘+ to in, ⌘− to out, ⌘0 to reset', () => {
    expect(zoomActionForKey(key('='))).toBe('in');
    expect(zoomActionForKey(key('+', { shift: true }))).toBe('in');
    expect(zoomActionForKey(key('-'))).toBe('out');
    expect(zoomActionForKey(key('0'))).toBe('reset');
  });

  it('ignores other modifiers and plain keys (so typing "=" or Ctrl+- still edits)', () => {
    expect(zoomActionForKey(key('=', { meta: false }))).toBeNull();
    expect(zoomActionForKey(key('-', { ctrl: true }))).toBeNull();
    expect(zoomActionForKey(key('=', { alt: true }))).toBeNull();
    expect(zoomActionForKey(key('s'))).toBeNull();
    expect(zoomActionForKey(key(')', { shift: true }, 'Digit0'))).toBeNull();
  });
});

describe('nextZoom', () => {
  it('steps through the standard levels and clamps at the ends', () => {
    expect(nextZoom(1, 'in')).toBe(1.1);
    expect(nextZoom(1, 'out')).toBe(0.9);
    expect(nextZoom(0.9, 'out')).toBe(0.8);
    expect(nextZoom(2.5, 'in')).toBe(2.5);
    expect(nextZoom(0.5, 'out')).toBe(0.5);
    expect(nextZoom(1.33, 'reset')).toBe(1);
  });

  it('snaps an off-step level to the next step in the chosen direction', () => {
    expect(nextZoom(1.2, 'in')).toBe(1.25);
    expect(nextZoom(1.2, 'out')).toBe(1.1);
  });
});
