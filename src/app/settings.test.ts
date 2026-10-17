import { beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '../services/agent/permissions';
import { composerKeyAction, loadSettings, saveSettings } from './settings';

const enter = (mods: Partial<{ shift: boolean; meta: boolean; ctrl: boolean; alt: boolean; composing: boolean }> = {}) => ({
  key: 'Enter',
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  isComposing: !!mods.composing,
});

describe('composerKeyAction', () => {
  it('Enter mode (default): Enter sends, Shift+Enter is a new line, Cmd+Enter also sends', () => {
    expect(composerKeyAction(enter(), 'enter')).toBe('send');
    expect(composerKeyAction(enter({ shift: true }), 'enter')).toBeNull();
    expect(composerKeyAction(enter({ meta: true }), 'enter')).toBe('send');
  });

  it('Cmd+Enter mode: only Cmd/Ctrl+Enter sends; Enter is a new line', () => {
    expect(composerKeyAction(enter(), 'mod-enter')).toBeNull();
    expect(composerKeyAction(enter({ meta: true }), 'mod-enter')).toBe('send');
    expect(composerKeyAction(enter({ ctrl: true }), 'mod-enter')).toBe('send');
    expect(composerKeyAction(enter({ shift: true }), 'mod-enter')).toBeNull();
  });

  it('never sends while an input method is composing, or for other keys', () => {
    expect(composerKeyAction(enter({ composing: true }), 'enter')).toBeNull();
    expect(composerKeyAction({ ...enter(), keyCode: 229 }, 'enter')).toBeNull();
    expect(composerKeyAction({ ...enter(), key: 'a' }, 'enter')).toBeNull();
    expect(composerKeyAction(enter({ alt: true }), 'enter')).toBeNull();
  });
});

describe('settings storage', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
  });

  it('defaults to Enter and asking before edits, and round-trips', () => {
    expect(loadSettings().sendKey).toBe('enter');
    expect(loadSettings().permissions.edit).toBe('ask');
    saveSettings({ ...loadSettings(), sendKey: 'mod-enter', historyPlacement: 'below' });
    expect(loadSettings().sendKey).toBe('mod-enter');
    expect(loadSettings().historyPlacement).toBe('below');
  });

  it('turns the old "edit without asking" switch into the Edit freely preset', () => {
    store.set('studio.settings', '{"agentEdits":"allow"}');
    expect(loadSettings().permissions).toEqual(PRESETS.edit.permissions);
  });

  it('ignores corrupt or unknown values', () => {
    store.set('studio.settings', '{"sendKey":"space","agentEdits":"always","junk":1,"markAiEdits":"yes"}');
    expect(loadSettings()).toEqual({ sendKey: 'enter', permissions: PRESETS.ask.permissions, historyPlacement: 'tab', markAiEdits: true, markAiReads: true });
    store.set('studio.settings', '{"markAiReads":false}');
    expect(loadSettings()).toMatchObject({ markAiEdits: true, markAiReads: false });
    store.set('studio.settings', 'not json');
    expect(loadSettings().sendKey).toBe('enter');
  });
});
