import { describe, expect, it } from 'vitest';
import { appTool, decide, permissionAsk } from '../services/agent/acp-events';
import { effortOption } from '../services/agent/models';
import { PRESETS, sessionRules, type Level } from '../services/agent/permissions';
import { STUDIO_TOOL_NAMES, studioToolName } from '../services/agent/studio-tool';
import type { AgentMode } from '../services/agent/modes';
import { DEFAULT_SETTINGS, type AppSettings, type AssistantId } from './settings';
import { handleMcp, TOOLS, type ModelChoice, type StudioHost } from './studio-tools';
import { describePermission, describeTool, NO_NAMES } from './tool-labels';

/** A stand-in for Typst Studio: what the tools changed, and what waits for the reply's end. */
function host(permission: Level = 'allow', answer: 'yes' | 'no' | 'unanswered' = 'yes') {
  const did: string[] = [];
  const asked: string[] = [];
  const idle: (() => unknown)[] = [];
  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  let zoom = 1;
  const h: StudioHost = {
    state: () => ({
      settings,
      zoom,
      assistant: 'opencode' as AssistantId,
      models: [
        { providerID: 'opencode', id: 'beam-free', name: 'Beam Free', providerName: 'OpenCode', supportsTools: true },
        { providerID: 'anthropic', id: 'claude-sonnet-5', name: 'Claude Sonnet 5', providerName: 'Anthropic', supportsTools: true },
      ],
      model: { providerID: 'opencode', id: 'beam-free' },
      efforts: ['default', 'low', 'high'].map((v) => effortOption(v)),
      effort: 'default',
      mode: 'write' as AgentMode,
      permission,
    }),
    changePreferences: (patch, z) => {
      settings = { ...settings, ...patch };
      if (z !== undefined) zoom = z;
      did.push(`prefs ${JSON.stringify(patch)}${z !== undefined ? ` zoom ${z}` : ''}`);
    },
    approve: async (tool, what) => {
      asked.push(`${tool}: ${what}`);
      return answer;
    },
    whenIdle: (run) => void idle.push(run),
    switchAssistant: (id: AssistantId, choice: ModelChoice) => void did.push(`assistant ${id} ${JSON.stringify(choice)}`),
    chooseModel: async (choice: ModelChoice) => void did.push(`model ${JSON.stringify(choice)}`),
    setMode: async (mode: AgentMode) => void did.push(`mode ${mode}`),
    openSettings: (page) => void did.push(`settings ${page ?? ''}`),
  };
  return { h, did, idle, asked, settings: () => settings, zoom: () => zoom };
}

const rpc = async (h: StudioHost, method: string, params?: object, id: number | 'none' = 1) => {
  const out = await handleMcp(JSON.stringify({ jsonrpc: '2.0', ...(id === 'none' ? {} : { id }), method, params }), h);
  return out ? JSON.parse(out) : null;
};
const call = async (h: StudioHost, name: string, args: object = {}) => {
  const r = await rpc(h, 'tools/call', { name, arguments: args });
  return { text: r.result.content[0].text as string, error: !!r.result.isError };
};

describe('Typst Studio’s tools, as an MCP server', () => {
  it('says hello in the client’s version, lists its tools, and keeps quiet for notifications', async () => {
    const { h } = host();
    const init = await rpc(h, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code' } });
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'typst-studio' } });
    expect((await rpc(h, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-06-18');
    expect(await rpc(h, 'notifications/initialized', {}, 'none')).toBeNull();
    const list = await rpc(h, 'tools/list');
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['get_settings', 'change_settings', 'list_models', 'set_model', 'switch_assistant', 'set_mode', 'open_settings']);
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe('object');
    expect((await rpc(h, 'resources/list')).error.code).toBe(-32601);
    expect(JSON.parse((await handleMcp('{oops', h))!).error.code).toBe(-32700);
    // A batch, answered as one.
    const batch = JSON.parse((await handleMcp(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]), h))!);
    expect(batch).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  });

  it('get_settings: the assistant, the assistants, and each preference with what it takes', async () => {
    const { h } = host();
    const r = await call(h, 'get_settings');
    const s = JSON.parse(r.text);
    expect(s.assistant).toMatchObject({ id: 'opencode', name: 'OpenCode', model: { id: 'beam-free' }, effort: { level: 'default', levels: ['default', 'low', 'high'] }, mode: { id: 'write' } });
    expect(s.assistants.map((a: { id: string }) => a.id)).toContain('claude');
    expect(s.preferences.editorFontSize).toMatchObject({ value: 12, values: '9 to 24' });
    expect(s.preferences.zoom.value).toBe(1);
    expect(s.preferences.permissions).toBeUndefined();
    expect(s.authorOnly).toMatch(/Settings ▸ Permissions/);
  });

  it('change_settings: changes preferences at once, and says what changed', async () => {
    const t = host();
    const r = await call(t.h, 'change_settings', { editorFontSize: 14, rulers: [120, 80], zoom: 1.25, formatOnSave: true });
    expect(r.error).toBe(false);
    expect(t.settings()).toMatchObject({ editorFontSize: 14, rulers: [80, 120] });
    expect(t.zoom()).toBe(1.25);
    expect(r.text).toBe('Changed (in effect now): editorFontSize: 12 px → 14 px; rulers: none → 80, 120; zoom: 100% → 125%; formatOnSave was already true.');
  });

  it('change_settings: also when an assistant wraps them in "settings"', async () => {
    const t = host();
    expect((await call(t.h, 'change_settings', { settings: '{"editorFontSize": 15, "rulers": [100]}' })).error).toBe(false);
    expect(t.settings()).toMatchObject({ editorFontSize: 15, rulers: [100] });
    expect((await call(t.h, 'change_settings', { settings: { wordWrap: 'off' } })).text).toBe('Changed (in effect now): wordWrap: window → off.');
    expect((await call(t.h, 'change_settings', { settings: { permissions: { shell: 'allow' } } })).error).toBe(true);
  });

  it('change_settings: never what the assistant may do, nor a value it doesn’t take', async () => {
    const t = host();
    for (const [args, says] of [
      [{ permissions: { shell: 'allow' } }, /can’t change what you may do without asking.*open_settings/],
      [{ allowCommands: ['rm'] }, /can’t change the commands you may run/],
      [{ toolPaths: { git: '/tmp/x' } }, /programs Typst Studio runs/],
      [{ assistant: 'claude' }, /use switch_assistant/],
      [{ effort: 'high' }, /use set_model/],
      [{ theme: 'dark' }, /No such preference: theme/],
      [{ editorFontSize: 99 }, /editorFontSize \(9 to 24\)/],
      [{ rulers: [5] }, /rulers/],
      [{ zoom: 9 }, /zoom/],
      [{}, /Nothing to change/],
    ] as const) {
      const r = await call(t.h, 'change_settings', args);
      expect(r.error, JSON.stringify(args)).toBe(true);
      expect(r.text).toMatch(says);
    }
    expect(t.did).toEqual([]);
    expect(t.settings().permissions).toEqual(DEFAULT_SETTINGS.permissions);
  });

  it('the assistant, model, effort and mode change when the reply ends', async () => {
    const t = host();
    expect((await call(t.h, 'switch_assistant', { assistant: 'claude', model: 'default' })).text).toMatch(/When your reply ends, Typst Studio switches to Claude Code \(model “default”\)\. This conversation stays with OpenCode/);
    expect((await call(t.h, 'set_model', { model: 'sonnet', effort: 'high' })).text).toMatch(/switches the model to “sonnet” and sets the effort to “high”/);
    expect((await call(t.h, 'set_mode', { mode: 'plan' })).text).toBe('When your reply ends, the chat switches to Plan mode.');
    expect(t.did).toEqual([]);
    for (const run of t.idle) await run();
    expect(t.did).toEqual(['assistant claude {"model":"default"}', 'model {"model":"sonnet","effort":"high"}', 'mode plan']);
  });

  it('with the settings permission at Never, looks but changes nothing, and says why', async () => {
    const t = host('deny');
    expect(JSON.parse((await call(t.h, 'get_settings')).text).changing).toMatch(/You may not change them/);
    for (const [name, args] of [
      ['change_settings', { editorFontSize: 14 }],
      ['set_model', { effort: 'low' }],
      ['switch_assistant', { assistant: 'claude' }],
      ['set_mode', { mode: 'plan' }],
    ] as const) {
      const r = await call(t.h, name, args);
      expect(r.error, name).toBe(true);
      expect(r.text).toMatch(/turned that off in Settings ▸ Permissions.*Nothing was changed/);
    }
    expect(t.did).toEqual([]);
    expect(t.idle).toEqual([]);
    expect((await call(t.h, 'open_settings', { page: 'permissions' })).error).toBe(false);
    expect(JSON.parse((await call(host('ask').h, 'get_settings')).text).changing).toMatch(/asked before each change/);
  });

  it('with the settings permission at Ask, changes only with the author’s yes, saying what to their card', async () => {
    const yes = host('ask', 'yes');
    expect((await call(yes.h, 'change_settings', { editorFontSize: 15, rulers: [100] })).error).toBe(false);
    expect(yes.asked).toEqual(['change_settings: text size 15 px, rulers at 100']);
    expect(yes.settings().editorFontSize).toBe(15);
    await call(yes.h, 'switch_assistant', { assistant: 'claude', model: 'default' });
    await call(yes.h, 'set_mode', { mode: 'plan' });
    expect(yes.asked.slice(1)).toEqual(['switch_assistant: Claude Code (model “default”)', 'set_mode: Plan mode']);
    expect(yes.idle).toHaveLength(2);
    // Looking never asks.
    await call(yes.h, 'get_settings');
    expect(yes.asked).toHaveLength(3);

    const no = host('ask', 'no');
    const refused = await call(no.h, 'change_settings', { editorFontSize: 15 });
    expect(refused).toEqual({ text: 'The author didn’t allow it. Nothing was changed.', error: true });
    expect(no.settings().editorFontSize).toBe(12);
    expect((await call(no.h, 'set_mode', { mode: 'plan' })).error).toBe(true);
    expect(no.idle).toEqual([]);

    const away = host('ask', 'unanswered');
    expect((await call(away.h, 'set_model', { effort: 'low' })).text).toMatch(/hasn’t answered.*Ask them in your reply/);
    expect(away.idle).toEqual([]);
    // A mistake is said before anyone is asked.
    expect((await call(yes.h, 'change_settings', { editorFontSize: 99 })).error).toBe(true);
    expect(yes.asked).toHaveLength(3);
  });

  it('says plainly what it can’t do', async () => {
    const { h, idle } = host();
    expect((await call(h, 'switch_assistant', { assistant: 'copilot' })).text).toMatch(/No assistant is called “copilot”/);
    expect((await call(h, 'switch_assistant', { assistant: 'opencode' })).text).toBe('OpenCode is the assistant already.');
    expect((await call(h, 'set_model', { model: 'gpt-99' })).text).toMatch(/no model like “gpt-99”.*list_models/);
    expect((await call(h, 'set_model', { effort: 'ultra' })).text).toMatch(/levels are default, low, high: “ultra” isn’t one/);
    expect((await call(h, 'set_model', {})).error).toBe(true);
    expect((await call(h, 'set_mode', { mode: 'write' })).text).toBe('The chat is in Write mode already.');
    expect(idle).toEqual([]);
  });

  it('list_models and open_settings', async () => {
    const t = host();
    const models = JSON.parse((await call(t.h, 'list_models', { search: 'sonnet' })).text);
    expect(models).toMatchObject({ assistant: 'OpenCode', current: 'beam-free', models: [{ id: 'claude-sonnet-5' }] });
    expect((await call(t.h, 'open_settings', { page: 'permissions' })).text).toBe('Settings is open at permissions for the author.');
    expect(t.did).toEqual(['settings permissions']);
    expect((await call(t.h, 'open_settings', { page: 'secrets' })).error).toBe(true);
  });
});

describe('the tools as the assistants name them', () => {
  it('are known by every assistant’s name for them', () => {
    expect(studioToolName('mcp__typst-studio__set_model')).toBe('set_model');
    expect(studioToolName('typst-studio_get_settings')).toBe('get_settings');
    expect(studioToolName('typst-studio.switch_assistant')).toBe('switch_assistant');
    expect(studioToolName('typst_studio__open_settings')).toBe('open_settings');
    expect(studioToolName('mcp__other__set_model')).toBeNull();
    expect(studioToolName('Read')).toBeNull();
  });

  it('are all of them; OpenCode asks about each by name: those that look are allowed, those that change follow the settings permission', () => {
    expect([...STUDIO_TOOL_NAMES]).toEqual(TOOLS.map((t) => t.name));
    const effect = (preset: keyof typeof PRESETS, t: string) => decide(`typst-studio_${t}`, ['*'], sessionRules(PRESETS[preset].permissions));
    for (const t of ['get_settings', 'list_models', 'open_settings']) for (const p of ['ask', 'edit', 'readonly'] as const) expect(effect(p, t), `${p} ${t}`).toBe('allow');
    for (const t of ['change_settings', 'set_model', 'switch_assistant', 'set_mode']) {
      expect(effect('ask', t)).toBe('ask');
      expect(effect('edit', t)).toBe('allow');
      // Never: the tool itself refuses, saying why.
      expect(effect('readonly', t)).toBe('allow');
    }
  });

  it('over ACP: the app’s name for them, their arguments, and the same permission', () => {
    const claude = appTool({ toolCallId: 't', title: 'mcp__typst-studio__change_settings', kind: 'other', rawInput: { editorFontSize: 14 }, _meta: { claudeCode: { toolName: 'mcp__typst-studio__change_settings' } } });
    expect(claude).toEqual({ name: 'typst-studio_change_settings', input: { editorFontSize: 14 } });
    const codex = appTool({ toolCallId: 'u', title: 'Tool: typst-studio/get_settings', kind: 'other', rawInput: { server: 'typst-studio', tool: 'get_settings', arguments: {} } });
    expect(codex.name).toBe('typst-studio_get_settings');
    const ask = permissionAsk({ toolCallId: 't', title: 'mcp__typst-studio__set_model', _meta: { claudeCode: { toolName: 'mcp__typst-studio__set_model' } } }, '/book');
    expect(ask).toEqual({ action: 'typst-studio', resources: ['set_model'], patches: [] });
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.ask.permissions))).toBe('ask');
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.edit.permissions))).toBe('allow');
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.readonly.permissions, true))).toBe('allow');
    // Plan mode is read-only for the book, not for settings the author asked to change.
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.edit.permissions, true))).toBe('allow');
    const look = permissionAsk({ toolCallId: 'l', title: 'mcp__typst-studio__get_settings', _meta: { claudeCode: { toolName: 'mcp__typst-studio__get_settings' } } }, '/book');
    expect(decide(look.action, look.resources, sessionRules(PRESETS.readonly.permissions, true))).toBe('allow');
    expect(describePermission(ask.action, ask.resources, NO_NAMES).what).toBe('change its model or effort');
    expect(describePermission('typst-studio_change_settings', ['*'], NO_NAMES).what).toBe('change Typst Studio’s settings');
    // Another server's tool still asks.
    const other = permissionAsk({ toolCallId: 'v', title: 'mcp__github__create_issue', _meta: { claudeCode: { toolName: 'mcp__github__create_issue' } } }, '/book');
    expect(decide(other.action, other.resources, sessionRules(PRESETS.edit.permissions))).toBe('ask');
  });

  it('in words, in the chat', () => {
    expect(describeTool('typst-studio_change_settings', { editorFontSize: 14, rulers: [80, 120] }, NO_NAMES)).toMatchObject({ done: 'Changed Typst Studio’s settings', note: 'text size 14 px, rulers at 80, 120' });
    expect(describeTool('mcp__typst-studio__switch_assistant', { assistant: 'claude' }, NO_NAMES).done).toBe('Switched the assistant to Claude Code');
    expect(describeTool('typst-studio_set_model', { model: 'sonnet', effort: 'high' }, NO_NAMES).note).toBe('model “sonnet”, effort “high”, when it finishes');
    expect(describeTool('typst-studio_get_settings', {}, NO_NAMES).running).toBe('Looking at Typst Studio’s settings');
  });
});

describe('the tools’ descriptions', () => {
  it('fit an assistant’s tool list', () => {
    for (const t of TOOLS) expect(t.description.length, t.name).toBeLessThan(700);
  });
});
