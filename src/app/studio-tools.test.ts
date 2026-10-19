import { describe, expect, it } from 'vitest';
import { appTool, decide, permissionAsk } from '../services/agent/acp-events';
import { effortOption } from '../services/agent/models';
import { PRESETS, sessionRules } from '../services/agent/permissions';
import { STUDIO_TOOL_NAMES, studioToolName } from '../services/agent/studio-tool';
import type { AgentMode } from '../services/agent/modes';
import { DEFAULT_SETTINGS, type AppSettings, type AssistantId } from './settings';
import { handleMcp, TOOLS, type ModelChoice, type StudioHost } from './studio-tools';
import { describeTool, NO_NAMES } from './tool-labels';

/** A stand-in for Typst Studio: what the tools changed, and what waits for the reply's end. */
function host() {
  const did: string[] = [];
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
    }),
    changePreferences: (patch, z) => {
      settings = { ...settings, ...patch };
      if (z !== undefined) zoom = z;
      did.push(`prefs ${JSON.stringify(patch)}${z !== undefined ? ` zoom ${z}` : ''}`);
    },
    whenIdle: (run) => void idle.push(run),
    switchAssistant: (id: AssistantId, choice: ModelChoice) => void did.push(`assistant ${id} ${JSON.stringify(choice)}`),
    chooseModel: async (choice: ModelChoice) => void did.push(`model ${JSON.stringify(choice)}`),
    setMode: async (mode: AgentMode) => void did.push(`mode ${mode}`),
    openSettings: (page) => void did.push(`settings ${page ?? ''}`),
  };
  return { h, did, idle, settings: () => settings, zoom: () => zoom };
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

  it('are all of them, and OpenCode’s asks about each are allowed', () => {
    expect([...STUDIO_TOOL_NAMES]).toEqual(TOOLS.map((t) => t.name));
    for (const t of STUDIO_TOOL_NAMES) expect(sessionRules(PRESETS.ask.permissions).filter((r) => r.action === `typst-studio_${t}` && r.effect === 'allow')).toHaveLength(1);
  });

  it('over ACP: the app’s name for them, their arguments, and allowed without asking (even read-only)', () => {
    const claude = appTool({ toolCallId: 't', title: 'mcp__typst-studio__change_settings', kind: 'other', rawInput: { editorFontSize: 14 }, _meta: { claudeCode: { toolName: 'mcp__typst-studio__change_settings' } } });
    expect(claude).toEqual({ name: 'typst-studio_change_settings', input: { editorFontSize: 14 } });
    const codex = appTool({ toolCallId: 'u', title: 'Tool: typst-studio/get_settings', kind: 'other', rawInput: { server: 'typst-studio', tool: 'get_settings', arguments: {} } });
    expect(codex.name).toBe('typst-studio_get_settings');
    const ask = permissionAsk({ toolCallId: 't', title: 'mcp__typst-studio__set_model', _meta: { claudeCode: { toolName: 'mcp__typst-studio__set_model' } } }, '/book');
    expect(ask).toEqual({ action: 'typst-studio', resources: ['set_model'], patches: [] });
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.ask.permissions))).toBe('allow');
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.readonly.permissions, true))).toBe('allow');
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
