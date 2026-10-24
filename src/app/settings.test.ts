import { beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '../services/agent/permissions';
import { assistantsFor, composerKeyAction, editorLineHeight, loadSettings, parseRulers, rulersText, saveSettings } from './settings';

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
    saveSettings({ ...loadSettings(), sendKey: 'mod-enter', markAiReads: false });
    expect(loadSettings().sendKey).toBe('mod-enter');
    expect(loadSettings().markAiReads).toBe(false);
  });

  it('keeps spelling and grammar choices, and drops what isn’t one', () => {
    store.set('studio.settings', '{"checkGrammar":false,"checkStyle":true,"spellingLanguage":"en-GB","proofRules":{"AnA":false,"bad key":true,"Spaces":"no"}}');
    expect(loadSettings()).toMatchObject({ checkSpelling: true, checkGrammar: false, checkStyle: true, spellingLanguage: 'en-GB', proofRules: { AnA: false } });
    store.set('studio.settings', '{"spellingLanguage":"British","proofRules":[1]}');
    expect(loadSettings()).toMatchObject({ spellingLanguage: '', proofRules: {} });
  });

  it('turns the old "edit without asking" switch into the Edit freely preset', () => {
    store.set('studio.settings', '{"agentEdits":"allow"}');
    expect(loadSettings().permissions).toEqual(PRESETS.edit.permissions);
  });

  it('ignores corrupt or unknown values', () => {
    store.set('studio.settings', '{"sendKey":"space","agentEdits":"always","junk":1,"markAiEdits":"yes"}');
    expect(loadSettings()).toEqual({ theme: 'system', sendKey: 'enter', permissions: PRESETS.ask.permissions, markAiEdits: true, markAiReads: true, aiEditColor: '#a371f7', aiReadColor: '#58a6ff', alwaysAllow: [], neverAllow: [], formatOnSave: true, autoSaveMinutes: 5, editorFontSize: 12, wordWrap: 'window', wordWrapColumn: 80, rulers: [], previewPages: 'nearby', previewScope: 'book', toolPaths: {}, assistant: 'opencode', checkSpelling: true, checkGrammar: true, checkStyle: false, checkCode: true, ignoreUppercase: true, ignoreNumbers: true, spellingLanguage: '', proofRules: {}, checkForUpdates: true, skippedUpdate: '' });
    store.set('studio.settings', '{"theme":"light"}');
    expect(loadSettings().theme).toBe('light');
    store.set('studio.settings', '{"theme":"sepia"}');
    expect(loadSettings().theme).toBe('system');
    store.set('studio.settings', '{"markAiReads":false}');
    expect(loadSettings()).toMatchObject({ markAiEdits: true, markAiReads: false });
    store.set('studio.settings', '{"aiEditColor":"#3FB950","aiReadColor":"blue"}');
    expect(loadSettings()).toMatchObject({ aiEditColor: '#3fb950', aiReadColor: '#58a6ff' });
    store.set('studio.settings', '{"formatOnSave":false}');
    expect(loadSettings().formatOnSave).toBe(false);
    store.set('studio.settings', '{"formatOnSave":"no"}');
    expect(loadSettings().formatOnSave).toBe(true);
    store.set('studio.settings', '{"autoSaveMinutes":0}');
    expect(loadSettings().autoSaveMinutes).toBe(0);
    for (const bad of ['"5"', '-1', '2.5', '500', 'null']) {
      store.set('studio.settings', `{"autoSaveMinutes":${bad}}`);
      expect(loadSettings().autoSaveMinutes).toBe(5);
    }
    store.set('studio.settings', '{"editorFontSize":14}');
    expect(loadSettings().editorFontSize).toBe(14);
    for (const bad of ['"14"', '4', '40', 'null']) {
      store.set('studio.settings', `{"editorFontSize":${bad}}`);
      expect(loadSettings().editorFontSize).toBe(12);
    }
    store.set('studio.settings', '{"wordWrap":"column","wordWrapColumn":120,"rulers":[120,80,80]}');
    expect(loadSettings()).toMatchObject({ wordWrap: 'column', wordWrapColumn: 120, rulers: [80, 120] });
    store.set('studio.settings', '{"wordWrap":"on","wordWrapColumn":"120","rulers":[80,"100",5,72.5,120]}');
    expect(loadSettings()).toMatchObject({ wordWrap: 'window', wordWrapColumn: 80, rulers: [80, 120] });
    store.set('studio.settings', '{"rulers":"80"}');
    expect(loadSettings().rulers).toEqual([]);
    store.set('studio.settings', '{"previewPages":"all"}');
    expect(loadSettings().previewPages).toBe('all');
    store.set('studio.settings', '{"previewPages":"some"}');
    expect(loadSettings().previewPages).toBe('nearby');
    store.set('studio.settings', '{"previewScope":"chapter"}');
    expect(loadSettings().previewScope).toBe('chapter');
    store.set('studio.settings', '{"previewScope":"part"}');
    expect(loadSettings().previewScope).toBe('book');
    store.set('studio.settings', '{"toolPaths":{"git":" /usr/bin/git ","tinymist":"","opencode":7,"python":"/usr/bin/python3"}}');
    expect(loadSettings().toolPaths).toEqual({ git: '/usr/bin/git' });
    store.set('studio.settings', '{"assistant":"claude"}');
    expect(loadSettings().assistant).toBe('claude');
    store.set('studio.settings', '{"assistant":"copilot"}');
    expect(loadSettings().assistant).toBe('opencode');
    store.set('studio.settings', '{"checkForUpdates":false,"skippedUpdate":"0.2.0"}');
    expect(loadSettings()).toMatchObject({ checkForUpdates: false, skippedUpdate: '0.2.0' });
    store.set('studio.settings', '{"checkForUpdates":"no","skippedUpdate":"0.2.0; rm -rf"}');
    expect(loadSettings()).toMatchObject({ checkForUpdates: true, skippedUpdate: '' });
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

describe('parseRulers', () => {
  it('reads columns as typed: commas or spaces, ascending, each once', () => {
    expect(parseRulers('80, 120')).toEqual([80, 120]);
    expect(parseRulers('120 80,80')).toEqual([80, 120]);
    expect(parseRulers(' 100 ')).toEqual([100]);
    expect(rulersText([80, 120])).toBe('80, 120');
  });

  it('takes empty text as none, and anything that isn’t a column as a mistake', () => {
    expect(parseRulers('')).toEqual([]);
    expect(parseRulers(' , ')).toEqual([]);
    for (const bad of ['80, abc', '80.5', '10', '1000', '-80', '20 30 40 50 60 70 80 90 100']) expect(parseRulers(bad)).toBeNull();
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
    expect(assistantsFor('anti')).toEqual(['antigravity']);
    expect(assistantsFor('Google')).toEqual(['antigravity']);
    expect(assistantsFor('agy')).toEqual(['antigravity']);
  });

  it('lists every one a short word fits, and none for nothing', () => {
    expect(assistantsFor('c')).toEqual(['claude', 'codex']);
    expect(assistantsFor('')).toEqual([]);
    expect(assistantsFor('gpt')).toEqual([]);
  });
});
