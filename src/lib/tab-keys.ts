// Tab shortcuts, as in VS Code on macOS (with Safari's ⌘W / ⇧⌘T / ⌃⇥):
//   ⌘W close · ⇧⌘T reopen closed · ⌥⌘T close others
//   ⌘K W / ⌘K ⌘W close all · ⌘K U close saved · ⌘K P copy path · ⌘K R reveal in Finder
//   ⌃⇥ / ⌃⇧⇥, ⌥⌘→ / ⌥⌘←, ⇧⌘] / ⇧⌘[ next / previous · ⌃1…⌃9 that tab · ⌃0 the last

export type TabCommand =
  | 'close'
  | 'reopen'
  | 'close-others'
  | 'close-all'
  | 'close-saved'
  | 'next'
  | 'prev'
  | 'copy-path'
  | 'reveal'
  | { at: number };

type KeyLike = { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

const only = (e: KeyLike, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }) =>
  e.metaKey === !!mods.meta && e.ctrlKey === !!mods.ctrl && e.altKey === !!mods.alt && e.shiftKey === !!mods.shift;

/** ⌘K: the start of a two-key shortcut. */
export const isChordStart = (e: KeyLike) => only(e, { meta: true }) && e.code === 'KeyK';

/** The second key after ⌘K. */
export function chordCommand(e: KeyLike): TabCommand | null {
  if (!only(e, {}) && !only(e, { meta: true })) return null;
  if (e.code === 'KeyW') return 'close-all';
  if (only(e, {}) && e.code === 'KeyU') return 'close-saved';
  if (only(e, {}) && e.code === 'KeyP') return 'copy-path';
  if (only(e, {}) && e.code === 'KeyR') return 'reveal';
  return null;
}

/** A single-press tab shortcut (by key position, so it works on any keyboard layout). */
export function tabKeyCommand(e: KeyLike): TabCommand | null {
  if (only(e, { meta: true }) && e.code === 'KeyW') return 'close';
  if (only(e, { meta: true, shift: true }) && e.code === 'KeyT') return 'reopen';
  if (only(e, { meta: true, alt: true }) && e.code === 'KeyT') return 'close-others';
  if (e.key === 'Tab' && only(e, { ctrl: true })) return 'next';
  if (e.key === 'Tab' && only(e, { ctrl: true, shift: true })) return 'prev';
  if (only(e, { meta: true, alt: true }) && e.key === 'ArrowRight') return 'next';
  if (only(e, { meta: true, alt: true }) && e.key === 'ArrowLeft') return 'prev';
  if (only(e, { meta: true, shift: true }) && e.code === 'BracketRight') return 'next';
  if (only(e, { meta: true, shift: true }) && e.code === 'BracketLeft') return 'prev';
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit && only(e, { ctrl: true })) return { at: digit[1] === '0' ? -1 : Number(digit[1]) - 1 };
  return null;
}

export const commandId = (c: TabCommand) => (typeof c === 'string' ? c : `at:${c.at}`);

/**
 * The editor's own ⌘K chords (Monaco's actions), for when ⌘K is taken here: all ⌘K
 * chords go through one place, so ⌘K ⌘W can't be read as a lone ⌘W.
 */
export function editorChordAction(e: KeyLike): string | null {
  if (!only(e, { meta: true })) return null;
  const map: Record<string, string> = {
    KeyC: 'editor.action.addCommentLine',
    KeyU: 'editor.action.removeCommentLine',
    Digit0: 'editor.foldAll',
    KeyJ: 'editor.unfoldAll',
    BracketLeft: 'editor.foldRecursively',
    BracketRight: 'editor.unfoldRecursively',
    KeyL: 'editor.toggleFold',
    KeyX: 'editor.action.trimTrailingWhitespace',
    KeyF: 'editor.action.formatSelection',
  };
  return map[e.code] ?? null;
}
