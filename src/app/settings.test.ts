import { beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '../services/agent/permissions';
import { assistantsFor, composerKeyAction, editorLineHeight, loadSettings, saveSettings } from './settings';

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
  });

  it('Option+Enter sends now (to a running turn), in either mode', () => {
    expect(composerKeyAction(enter({ alt: true }), 'enter')).toBe('send-now');
    expect(composerKeyAction(enter({ alt: true }), 'mod-enter')).toBe('send-now');
    expect(composerKeyAction(enter({ alt: true, shift: true }), 'enter')).toBeNull();
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
    expect(loadSettings()).toEqual({ sendKey: 'enter', permissions: PRESETS.ask.permissions, historyPlacement: 'tab', markAiEdits: true, markAiReads: true, allowCommands: [], formatOnSave: true, editorFontSize: 12, toolPaths: {}, assistant: 'opencode' });
    store.set('studio.settings', '{"markAiReads":false}');
    expect(loadSettings()).toMatchObject({ markAiEdits: true, markAiReads: false });
    store.set('studio.settings', '{"formatOnSave":false}');
    expect(loadSettings().formatOnSave).toBe(false);
    store.set('studio.settings', '{"formatOnSave":"no"}');
    expect(loadSettings().formatOnSave).toBe(true);
    store.set('studio.settings', '{"editorFontSize":14}');
    expect(loadSettings().editorFontSize).toBe(14);
    for (const bad of ['"14"', '4', '40', 'null']) {
      store.set('studio.settings', `{"editorFontSize":${bad}}`);
      expect(loadSettings().editorFontSize).toBe(12);
    }
    store.set('studio.settings', '{"toolPaths":{"git":" /usr/bin/git ","tinymist":"","opencode":7,"python":"/usr/bin/python3"}}');
    expect(loadSettings().toolPaths).toEqual({ git: '/usr/bin/git' });
    store.set('studio.settings', '{"assistant":"claude"}');
    expect(loadSettings().assistant).toBe('claude');
    store.set('studio.settings', '{"assistant":"copilot"}');
    expect(loadSettings().assistant).toBe('opencode');
    store.set('studio.settings', '{"toolPaths":["/usr/bin/git"]}');
    expect(loadSettings().toolPaths).toEqual({});
    store.set('studio.settings', 'not json');
    expect(loadSettings().sendKey).toBe('enter');
  });
});

describe('editorLineHeight', () => {
  it('is VS Code\'s on macOS: 1.5 times the text size, rounded', () => {
    expect(editorLineHeight(12)).toBe(18);
    expect(editorLineHeight(13)).toBe(20);
    expect(editorLineHeight(14)).toBe(21);
  });
});

describe('assistantsFor', () => {
  it('takes the start of an id or a name, or the maker', () => {
    expect(assistantsFor('claude')).toEqual(['claude']);
    expect(assistantsFor('Claude Code')).toEqual(['claude']);
    expect(assistantsFor('gem')).toEqual(['gemini']);
    expect(assistantsFor('open')).toEqual(['opencode']);
    expect(assistantsFor(' Codex ')).toEqual(['codex']);
    expect(assistantsFor('openai')).toEqual(['codex']);
    expect(assistantsFor('Anthropic')).toEqual(['claude']);
  });

  it('lists every one a short word fits, and none for nothing', () => {
    expect(assistantsFor('c')).toEqual(['claude', 'codex']);
    expect(assistantsFor('')).toEqual([]);
    expect(assistantsFor('gpt')).toEqual([]);
  });
});
