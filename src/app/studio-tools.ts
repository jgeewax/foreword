// Foreword's own tools for the writing assistant, as an MCP server (the
// Rust side, mcp.rs, carries the requests here): what the app is set to, and
// changing it when the author asks: another assistant, model, effort or mode,
// or a preference (text size, wrapping, marks, …). It can't change what it may
// do itself (permissions, commands it may run, the programs Foreword runs):
// only the author does that, in Settings, which it can open for them.
//
// Changes to the assistant itself (which one, model, effort, mode) wait until
// its reply ends, so they never pull the rug from under the turn that asked.
import type { AgentMode } from '../services/agent/modes';
import { AGENT_MODES, modeConfig } from '../services/agent/modes';
import { effortFor } from '../services/agent/models';
import { matchesQuery } from '../services/agent/model-search';
import type { EffortOption, ModelInfo, ModelRef } from '../services/agent/types';
import { ZOOM_STEPS } from '../lib/zoom';
import type { Level } from '../services/agent/permissions';
import { describeTool, NO_NAMES } from './tool-labels';
import { ASSISTANT_NAMES, ASSISTANTS, AUTO_SAVE_MINUTES, EDITOR_COLUMNS, EDITOR_FONT_SIZES, sanitize, type AppSettings, type AssistantId } from './settings';

export { STUDIO_TOOLS } from '../services/agent/studio-tool';
import { STUDIO_TOOLS } from '../services/agent/studio-tool';

/** The Settings pages open_settings can open. */
export const SETTINGS_PAGES = ['general', 'editor', 'assistant', 'permissions', 'tools', 'book', 'book-assistant', 'book-color'] as const;
export type ToolsSettingsPage = (typeof SETTINGS_PAGES)[number];

/** Model and effort to use once an assistant is switched to (or now): a model's id or part of its name ("default": its own), an effort level. */
export type ModelChoice = { model?: string; effort?: string };

/** What the tools act on: Foreword (studio.ts), or a test's stand-in. */
export type StudioHost = {
  state(): {
    settings: AppSettings;
    zoom: number;
    assistant: AssistantId;
    models: ModelInfo[];
    model: ModelRef | null;
    efforts: EffortOption[];
    effort: string | null;
    mode: AgentMode;
    /** Whether it may change settings (Settings ▸ Permissions): without asking, after asking the author, or not at all. */
    permission: Level;
  };
  /**
   * With the settings permission at Ask: the author's yes for this change.
   * Taken from their answer to the assistant's own ask when there was one (Claude
   * Code, OpenCode); otherwise asked in the chat (Codex asks no one about these
   * tools). "unanswered": no answer before the assistant would give up waiting.
   */
  approve(tool: string, what: string): Promise<'yes' | 'no' | 'unanswered'>;
  /** App preferences (the settings file), and the UI zoom: at once. */
  changePreferences(patch: Partial<AppSettings>, zoom?: number): void;
  /** Once the assistant's reply ends (the turn that asked). */
  whenIdle(run: () => unknown): void;
  /** Another assistant, then its model and effort when it has started. */
  switchAssistant(id: AssistantId, choice: ModelChoice): void;
  /** This assistant's model and effort (the chat says what came of it). */
  chooseModel(choice: ModelChoice): Promise<void>;
  setMode(mode: AgentMode): Promise<void>;
  openSettings(page?: ToolsSettingsPage): void;
};

/** The app preferences the assistant may change, what each does, and the values it takes. */
const PREFERENCES: Record<string, { about: string; values: string; schema: Record<string, unknown> }> = {
  editorFontSize: { about: 'The editor’s text size, in px.', values: `${EDITOR_FONT_SIZES.min} to ${EDITOR_FONT_SIZES.max}`, schema: { type: 'number', minimum: EDITOR_FONT_SIZES.min, maximum: EDITOR_FONT_SIZES.max } },
  wordWrap: {
    about: 'Where long lines wrap in the editor: at its edge (window), at wordWrapColumn (column), or not at all (off).',
    values: 'window, column, off',
    schema: { type: 'string', enum: ['window', 'column', 'off'] },
  },
  wordWrapColumn: { about: 'The column long lines wrap at, with wordWrap "column".', values: `${EDITOR_COLUMNS.min} to ${EDITOR_COLUMNS.max}`, schema: { type: 'integer', minimum: EDITOR_COLUMNS.min, maximum: EDITOR_COLUMNS.max } },
  rulers: { about: 'Vertical lines in the editor at these columns (e.g. [80, 120]); [] for none.', values: `up to 8 columns, ${EDITOR_COLUMNS.min} to ${EDITOR_COLUMNS.max}`, schema: { type: 'array', items: { type: 'integer' } } },
  formatOnSave: { about: 'Format Typst files (typstyle) when the author saves them.', values: 'true, false', schema: { type: 'boolean' } },
  autoSaveMinutes: {
    about: 'Save files with unsaved changes every this many minutes; 0 turns auto save off.',
    values: `0 to ${AUTO_SAVE_MINUTES.max}`,
    schema: { type: 'integer', minimum: 0, maximum: AUTO_SAVE_MINUTES.max },
  },
  sendKey: { about: 'Which key sends a chat message: Enter (Shift+Enter for a new line), or Cmd+Enter (Enter for a new line).', values: 'enter, mod-enter', schema: { type: 'string', enum: ['enter', 'mod-enter'] } },
  markAiEdits: { about: 'Mark the lines the assistant changed, in the editor’s gutter.', values: 'true, false', schema: { type: 'boolean' } },
  markAiReads: { about: 'Mark the lines the assistant read in this conversation.', values: 'true, false', schema: { type: 'boolean' } },
  aiEditColor: { about: 'The colour of the marks for lines the assistant changed.', values: '#rrggbb', schema: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
  aiReadColor: { about: 'The colour of the marks for lines the assistant read.', values: '#rrggbb', schema: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
  checkForUpdates: { about: 'Look for a new version of Foreword when it starts.', values: 'true, false', schema: { type: 'boolean' } },
  zoom: { about: 'The size of the whole window’s text and controls (1 is 100%).', values: ZOOM_STEPS.join(', '), schema: { type: 'number', minimum: ZOOM_STEPS[0], maximum: ZOOM_STEPS[ZOOM_STEPS.length - 1] } },
};

/** Settings only the author changes: what the assistant may do, and the programs the app runs. */
const AUTHOR_ONLY: Record<string, string> = {
  permissions: 'what you may do without asking',
  alwaysAllow: 'the commands you may run without asking',
  neverAllow: 'the commands you may never run',
  allowCommands: 'the commands you may run without asking',
  toolPaths: 'the programs Foreword runs',
  skippedUpdate: 'a skipped update',
};
const AUTHOR_ONLY_NOTE =
  'What the assistant may do (Settings ▸ Permissions), the commands it may run without asking, and the programs Foreword runs (Settings ▸ Tools) are the author’s to change, in Settings: open_settings opens the page for them.';
const BOOK_NOTE =
  'This book’s own settings (its main file, Typst root, output folder, font folders) are in .foreword.json in the book’s folder: change them by editing that file. The writing style guide is WRITING_STYLE.md there.';

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  run(input: Record<string, unknown>, host: StudioHost): Promise<string> | string;
};

/** A refusal or a mistake: the assistant reads it as the tool's error. */
class ToolError extends Error {}

/** The author's permission for changes, said to the assistant. */
const PERMISSION_WORDS: Record<Level, string> = {
  allow: 'You may change them without asking (the author allows it in Settings ▸ Permissions).',
  ask: 'The author is asked before each change (Settings ▸ Permissions).',
  deny: 'You may not change them: the author has turned that off in Settings ▸ Permissions. You can open that page for them (open_settings).',
};

/** A tool that changes something, when the author has said never (the tools say it: an assistant's own refusal says nothing). */
function mayChange(host: StudioHost) {
  if (host.state().permission === 'deny') throw new ToolError(`${PERMISSION_WORDS.deny} Nothing was changed.`);
}

/** At Ask: the author's yes for this change (`what`, in words for their card), or a refusal the assistant can pass on. */
async function approved(host: StudioHost, tool: string, what: string) {
  if (host.state().permission !== 'ask') return;
  const answer = await host.approve(tool, what);
  if (answer === 'no') throw new ToolError('The author didn’t allow it. Nothing was changed.');
  if (answer === 'unanswered') throw new ToolError('The author hasn’t answered whether you may make this change, so nothing was changed. Ask them in your reply, and do it once they say yes.');
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
const words = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A preference's value as the author would read it. */
function shown(key: string, v: unknown): string {
  if (key === 'zoom') return `${Math.round(Number(v) * 100)}%`;
  if (key === 'editorFontSize') return `${v} px`;
  if (key === 'autoSaveMinutes') return v === 0 ? 'off' : `every ${v} minute${v === 1 ? '' : 's'}`;
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  return String(v);
}

const ASSISTANT_IDS = ASSISTANTS as readonly string[];

/** The preferences, also when wrapped as {"settings": {…}} or {"settings": "{…}"} (as Claude Code's Haiku sends them). */
function unwrapped(input: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(input);
  if (keys.length !== 1 || (keys[0] !== 'settings' && keys[0] !== 'preferences')) return input;
  let inner = input[keys[0]];
  if (typeof inner === 'string') {
    try {
      inner = JSON.parse(inner);
    } catch {
      return input;
    }
  }
  return inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as Record<string, unknown>) : input;
}

export const TOOLS: Tool[] = [
  {
    name: 'get_settings',
    title: 'Foreword’s settings',
    description:
      'What Foreword is set to now: the writing assistant (which program, its model, effort and chat mode), the assistants it can switch to, and every app preference you can change with change_settings, with what each one does and the values it takes. Call this before changing anything.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    run: (_input, host) => {
      const s = host.state();
      const model = s.model ? s.models.find((m) => m.providerID === s.model!.providerID && m.id === s.model!.id) : null;
      return json({
        assistant: {
          id: s.assistant,
          name: ASSISTANT_NAMES[s.assistant],
          model: model ? { id: model.id, name: model.name, provider: model.providerName } : s.model,
          effort: s.efforts.length ? { level: s.effort, levels: s.efforts.map((e) => e.value) } : 'this model has no effort setting',
          mode: { id: s.mode, about: modeConfig(s.mode).description, modes: AGENT_MODES },
        },
        assistants: ASSISTANTS.map((id) => ({ id, name: ASSISTANT_NAMES[id] })),
        preferences: Object.fromEntries(
          Object.entries(PREFERENCES).map(([key, p]) => [key, { value: key === 'zoom' ? s.zoom : s.settings[key as keyof AppSettings], about: p.about, values: p.values }]),
        ),
        changing: PERMISSION_WORDS[s.permission],
        authorOnly: AUTHOR_ONLY_NOTE,
        book: BOOK_NOTE,
      });
    },
  },
  {
    name: 'change_settings',
    title: 'Change Foreword’s preferences',
    description:
      'Change app preferences, at once: give only the ones to change, with the values get_settings lists (e.g. {"editorFontSize": 14, "rulers": [80]}). Not for the assistant, model, effort or mode (switch_assistant, set_model, set_mode), and not for permissions or programs, which only the author changes.',
    inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(PREFERENCES).map(([k, p]) => [k, { ...p.schema, description: p.about }])) },
    run: async (given, host) => {
      mayChange(host);
      const input = unwrapped(given);
      const keys = Object.keys(input);
      if (!keys.length) throw new ToolError('Nothing to change: give the preferences to change and their new values (see get_settings).');
      const refused = keys.filter((k) => AUTHOR_ONLY[k]);
      if (refused.length) throw new ToolError(`You can’t change ${refused.map((k) => AUTHOR_ONLY[k]).join(' or ')}: ${AUTHOR_ONLY_NOTE}`);
      const elsewhere: Record<string, string> = { assistant: 'switch_assistant', model: 'set_model', effort: 'set_model', mode: 'set_mode' };
      const moved = keys.filter((k) => elsewhere[k]);
      if (moved.length) throw new ToolError(`${moved.join(', ')}: use ${[...new Set(moved.map((k) => elsewhere[k]))].join(' and ')} instead.`);
      const unknown = keys.filter((k) => !PREFERENCES[k]);
      if (unknown.length) throw new ToolError(`No such preference: ${unknown.join(', ')}. The ones you can change: ${Object.keys(PREFERENCES).join(', ')}.`);
      const { zoom, ...rest } = input;
      const patch = sanitize(rest);
      const bad = Object.keys(rest).filter((k) => !(k in patch));
      // Rulers are kept to those that are columns: one that isn't is a mistake to say.
      if (Array.isArray(rest.rulers) && patch.rulers && patch.rulers.length !== new Set(rest.rulers).size && !bad.includes('rulers')) bad.push('rulers');
      if (zoom !== undefined && !(typeof zoom === 'number' && zoom >= ZOOM_STEPS[0] && zoom <= ZOOM_STEPS[ZOOM_STEPS.length - 1])) bad.push('zoom');
      if (bad.length) throw new ToolError(`Not a value it takes: ${bad.map((k) => `${k} (${PREFERENCES[k].values})`).join('; ')}. Nothing was changed.`);
      await approved(host, 'change_settings', describeTool(`${STUDIO_TOOLS}_change_settings`, input, NO_NAMES).note ?? keys.join(', '));
      const before = host.state();
      host.changePreferences(patch, zoom as number | undefined);
      // In the order asked.
      const applied: Record<string, unknown> = { ...patch, ...(zoom !== undefined ? { zoom } : {}) };
      const changes = keys.map((k) => [k, applied[k]] as const).map(([k, v]) => {
        const was = k === 'zoom' ? before.zoom : before.settings[k as keyof AppSettings];
        return JSON.stringify(was) === JSON.stringify(v) ? `${k} was already ${shown(k, v)}` : `${k}: ${shown(k, was)} → ${shown(k, v)}`;
      });
      return `Changed (in effect now): ${changes.join('; ')}.`;
    },
  },
  {
    name: 'list_models',
    title: 'The assistant’s models',
    description: 'The models the current assistant offers (id, name, provider), and the current one’s effort levels. Give part of a name to narrow a long list.',
    inputSchema: { type: 'object', properties: { search: { type: 'string', description: 'Words in the model’s name or id, e.g. "sonnet"' } }, additionalProperties: false },
    readOnly: true,
    run: (input, host) => {
      const s = host.state();
      const search = words(input.search);
      const found = s.models.filter((m) => m.supportsTools && matchesQuery(m, search));
      const shownModels = found.slice(0, 80);
      return json({
        assistant: ASSISTANT_NAMES[s.assistant],
        current: s.model?.id ?? null,
        currentEfforts: s.efforts.map((e) => e.value),
        models: shownModels.map((m) => ({ id: m.id, name: m.name, provider: m.providerName })),
        ...(found.length > shownModels.length ? { more: `${found.length - shownModels.length} more: give a search to narrow the list` } : {}),
      });
    },
  },
  {
    name: 'set_model',
    title: 'Change the model or effort',
    description:
      'Change the current assistant’s model, effort, or both, from the author’s next message on (it changes when your reply ends). model: its id or part of its name ("sonnet"), or "default" for the assistant’s own default. effort: one of the model’s levels (e.g. "low", "high"; get_settings lists them).',
    inputSchema: {
      type: 'object',
      properties: { model: { type: 'string', description: 'A model id or part of its name, or "default"' }, effort: { type: 'string', description: 'An effort level, e.g. "high"' } },
      additionalProperties: false,
    },
    run: async (input, host) => {
      mayChange(host);
      const model = words(input.model);
      const effort = words(input.effort);
      if (!model && !effort) throw new ToolError('Give a model, an effort, or both.');
      const s = host.state();
      if (model && model.toLowerCase() !== 'default' && !s.models.some((m) => m.supportsTools && (m.id === model || matchesQuery(m, model)))) {
        throw new ToolError(`${ASSISTANT_NAMES[s.assistant]} has no model like “${model}”. list_models lists them.`);
      }
      // The same model: its levels are known now.
      if (effort && !model && s.efforts.length && !effortFor(effort, s.efforts)) throw new ToolError(`This model’s effort levels are ${s.efforts.map((e) => e.value).join(', ')}: “${effort}” isn’t one.`);
      if (effort && !model && !s.efforts.length) throw new ToolError('This model has no effort setting.');
      await approved(host, 'set_model', [model && `model “${model}”`, effort && `effort “${effort}”`].filter(Boolean).join(', '));
      host.whenIdle(() => host.chooseModel({ model: model || undefined, effort: effort || undefined }));
      return `When your reply ends, Foreword ${[model && `switches the model to “${model}”`, effort && `sets the effort to “${effort}”`].filter(Boolean).join(' and ')}, for the author’s next message. The chat says if it can’t.`;
    },
  },
  {
    name: 'switch_assistant',
    title: 'Switch the writing assistant',
    description: `Make another program the writing assistant: ${ASSISTANTS.map((id) => `${id} (${ASSISTANT_NAMES[id]})`).join(', ')}. It happens when your reply ends: this conversation stays with the current assistant, and the author's next message starts a new one with the other. Optionally its model ("default" for its own) and effort.`,
    inputSchema: {
      type: 'object',
      properties: {
        assistant: { type: 'string', enum: [...ASSISTANTS], description: 'Which program' },
        model: { type: 'string', description: 'Its model: an id or part of a name, or "default"' },
        effort: { type: 'string', description: 'An effort level, e.g. "high"' },
      },
      required: ['assistant'],
      additionalProperties: false,
    },
    run: async (input, host) => {
      mayChange(host);
      const id = words(input.assistant).toLowerCase();
      if (!ASSISTANT_IDS.includes(id)) throw new ToolError(`No assistant is called “${id}”: ${ASSISTANTS.join(', ')}.`);
      const choice = { model: words(input.model) || undefined, effort: words(input.effort) || undefined };
      const s = host.state();
      const then = [choice.model && `model “${choice.model}”`, choice.effort && `effort “${choice.effort}”`].filter(Boolean).join(', ');
      if (id === s.assistant) {
        if (!choice.model && !choice.effort) return `${ASSISTANT_NAMES[id as AssistantId]} is the assistant already.`;
        await approved(host, 'set_model', then);
        host.whenIdle(() => host.chooseModel(choice));
        return `${ASSISTANT_NAMES[id as AssistantId]} is the assistant already; its ${[choice.model && 'model', choice.effort && 'effort'].filter(Boolean).join(' and ')} change${choice.model && choice.effort ? '' : 's'} when your reply ends.`;
      }
      await approved(host, 'switch_assistant', `${ASSISTANT_NAMES[id as AssistantId]}${then ? ` (${then})` : ''}`);
      host.whenIdle(() => host.switchAssistant(id as AssistantId, choice));
      return `When your reply ends, Foreword switches to ${ASSISTANT_NAMES[id as AssistantId]}${then ? ` (${then})` : ''}. This conversation stays with ${ASSISTANT_NAMES[s.assistant]}; the author's next message starts a new conversation with ${ASSISTANT_NAMES[id as AssistantId]}. Tell the author so.`;
    },
  },
  {
    name: 'set_mode',
    title: 'Change the chat’s mode',
    description: `The chat's mode, from the author's next message on (it changes when your reply ends): ${AGENT_MODES.map((m) => `${m} (${modeConfig(m).description})`).join('; ')}`,
    inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: [...AGENT_MODES] } }, required: ['mode'], additionalProperties: false },
    run: async (input, host) => {
      mayChange(host);
      const mode = words(input.mode).toLowerCase() as AgentMode;
      if (!AGENT_MODES.includes(mode)) throw new ToolError(`No mode is called “${mode}”: ${AGENT_MODES.join(', ')}.`);
      if (mode === host.state().mode) return `The chat is in ${modeConfig(mode).label} mode already.`;
      await approved(host, 'set_mode', `${modeConfig(mode).label} mode`);
      host.whenIdle(() => host.setMode(mode));
      return `When your reply ends, the chat switches to ${modeConfig(mode).label} mode.`;
    },
  },
  {
    name: 'open_settings',
    title: 'Open Settings for the author',
    description:
      'Open Foreword’s Settings at a page, for the author to see or change something themselves (the only way to change permissions or the programs it runs). Pages: general, editor, assistant, permissions, tools, book (this book’s settings), book-assistant (this book’s assistant permissions), book-color (the colour this book’s window wears).',
    inputSchema: { type: 'object', properties: { page: { type: 'string', enum: [...SETTINGS_PAGES] } }, additionalProperties: false },
    run: (input, host) => {
      const page = words(input.page) as ToolsSettingsPage;
      if (page && !SETTINGS_PAGES.includes(page)) throw new ToolError(`No such page: ${SETTINGS_PAGES.join(', ')}.`);
      host.openSettings(page || undefined);
      return `Settings is open${page ? ` at ${page}` : ''} for the author.`;
    },
  },
];

const SERVER_INSTRUCTIONS =
  'Foreword’s own settings: when the author asks to change how Foreword works (which assistant, model, effort or chat mode, the editor’s text size, wrapping, rulers, marks, zoom…), use these tools rather than editing files. get_settings first. Changes to the assistant itself happen when your reply ends.';

/** The MCP versions this server speaks (the newest first); a client's own is used when it's one of them. */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** One JSON-RPC message: its answer, or null for a notification (or a client's own answer). */
async function answer(m: RpcMessage, host: StudioHost): Promise<object | null> {
  if (typeof m?.method !== 'string') return null;
  const notification = m.id === undefined || m.id === null;
  const ok = (result: object) => ({ jsonrpc: '2.0', id: m.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } });
  switch (m.method) {
    case 'initialize': {
      const asked = String(m.params?.protocolVersion ?? '');
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: STUDIO_TOOLS, title: 'Foreword', version: '1' },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case 'ping':
      return notification ? null : ok({});
    case 'tools/list':
      return ok({
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: false, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return fail(-32602, `No tool called ${String(m.params?.name)}`);
      const args = m.params?.arguments;
      try {
        const text = await tool.run(args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}, host);
        return ok({ content: [{ type: 'text', text }] });
      } catch (e) {
        const message = e instanceof ToolError ? e.message : `Foreword couldn’t do it: ${e instanceof Error ? e.message : String(e)}`;
        return ok({ content: [{ type: 'text', text: message }], isError: true });
      }
    }
  }
  return notification ? null : fail(-32601, `${m.method} isn’t supported`);
}

/** An HTTP request's body (one message, or a batch): the reply's body, or null when there's nothing to send back. */
export async function handleMcp(body: string, host: StudioHost): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Not JSON' } });
  }
  if (Array.isArray(parsed)) {
    const answers = (await Promise.all(parsed.map((m) => answer(m as RpcMessage, host)))).filter(Boolean);
    return answers.length ? JSON.stringify(answers) : null;
  }
  const one = await answer(parsed as RpcMessage, host);
  return one ? JSON.stringify(one) : null;
}
