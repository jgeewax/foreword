import { describe, expect, it } from 'vitest';
import { chordCommand, editorChordAction, isChordStart, tabKeyCommand } from './tab-keys';

const key = (code: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}, k = code.replace(/^Key/, '').toLowerCase()) => ({
  key: k,
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe('tab shortcuts', () => {
  it('maps single presses', () => {
    expect(tabKeyCommand(key('KeyW', { meta: true }))).toBe('close');
    expect(tabKeyCommand(key('KeyT', { meta: true, shift: true }))).toBe('reopen');
    // ⌥ changes the character (⌥T is †), so keys go by position.
    expect(tabKeyCommand(key('KeyT', { meta: true, alt: true }, '†'))).toBe('close-others');
    expect(tabKeyCommand(key('Tab', { ctrl: true }, 'Tab'))).toBe('next');
    expect(tabKeyCommand(key('Tab', { ctrl: true, shift: true }, 'Tab'))).toBe('prev');
    expect(tabKeyCommand(key('ArrowRight', { meta: true, alt: true }, 'ArrowRight'))).toBe('next');
    expect(tabKeyCommand(key('BracketLeft', { meta: true, shift: true }, '{'))).toBe('prev');
    expect(tabKeyCommand(key('Digit3', { ctrl: true }, '3'))).toEqual({ at: 2 });
    expect(tabKeyCommand(key('Digit0', { ctrl: true }, '0'))).toEqual({ at: -1 });
  });

  it('leaves other keys alone', () => {
    expect(tabKeyCommand(key('KeyW', { meta: true, alt: true }))).toBeNull();
    expect(tabKeyCommand(key('Digit3', { meta: true }, '3'))).toBeNull();
    expect(tabKeyCommand(key('Tab', {}, 'Tab'))).toBeNull();
    expect(tabKeyCommand(key('BracketLeft', { meta: true }, '['))).toBeNull();
  });

  it('maps ⌘K chords', () => {
    expect(isChordStart(key('KeyK', { meta: true }))).toBe(true);
    expect(isChordStart(key('KeyK', { meta: true, shift: true }))).toBe(false);
    expect(chordCommand(key('KeyW'))).toBe('close-all');
    expect(chordCommand(key('KeyW', { meta: true }))).toBe('close-all');
    expect(chordCommand(key('KeyU'))).toBe('close-saved');
    expect(chordCommand(key('KeyU', { meta: true }))).toBeNull(); // ⌘K ⌘U is the editor's uncomment
    expect(chordCommand(key('KeyP'))).toBe('copy-path');
    expect(chordCommand(key('KeyR'))).toBe('reveal');
    expect(chordCommand(key('KeyX'))).toBeNull();
  });

  it('passes the editor’s own ⌘K chords on to it', () => {
    expect(editorChordAction(key('KeyC', { meta: true }))).toBe('editor.action.addCommentLine');
    expect(editorChordAction(key('Digit0', { meta: true }, '0'))).toBe('editor.foldAll');
    expect(editorChordAction(key('KeyW', { meta: true }))).toBeNull();
    expect(editorChordAction(key('KeyC'))).toBeNull();
  });
});
