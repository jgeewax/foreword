import { describe, expect, it } from 'vitest';
import { contextTokens, itemsFromContext } from '../../app/tasks';
import { readOf } from '../../app/ai-marks';
import recorded from './__fixtures__/acp-claude.jsonl?raw';
import recordedCodex from './__fixtures__/acp-codex.jsonl?raw';
import { AcpAdapter, stripInstructions, type AcpTransport } from './acp';
import { appTool, conversationTitle, decide, permissionAsk, toolOutput, type AcpToolCall } from './acp-events';
import { PRESETS, sessionRules } from './permissions';
import type { AgentEvent } from './types';

// Claude Code's ACP program, recorded: a shell command (wc), a grep, a read of
// lines 25–34, an edit (asked about, allowed), and the reply "done".
const ROOT = '/Users/ada/Books/Linear Algebra';
const messages = recorded
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const updates = messages.filter((m) => m.method === 'session/update').map((m) => m.params.update);
/** Each tool call as its updates add up. */
const calls = new Map<string, AcpToolCall>();
for (const u of updates.filter((u) => u.sessionUpdate.startsWith('tool_call'))) calls.set(u.toolCallId, { ...calls.get(u.toolCallId), ...u });
const byTool = (name: string) => [...calls.values()].filter((c) => c._meta?.claudeCode?.toolName === name);

describe('ACP tool calls as the app’s tools', () => {
  it('names and inputs, as the chat describes them', () => {
    expect(appTool(byTool('Bash')[0])).toEqual({ name: 'bash', input: { command: 'wc -w chapters/ch1-vectors.typ', description: 'Count words in chapter 1 file' } });
    expect(appTool(byTool('Read')[0])).toEqual({ name: 'read', input: { filePath: `${ROOT}/chapters/ch1-vectors.typ`, offset: 25, limit: 10 } });
    expect(appTool(byTool('Edit')[0])).toMatchObject({ name: 'edit', input: { filePath: `${ROOT}/chapters/ch1-vectors.typ`, oldString: 'Two vectors are orthogonal', newString: 'Two vectors are perpendicular' } });
    // Another agent's call: by its kind and locations.
    expect(appTool({ toolCallId: 'x', kind: 'read', title: 'Read notes', locations: [{ path: `${ROOT}/notes.typ` }] })).toEqual({ name: 'read', input: { filePath: `${ROOT}/notes.typ` } });
    expect(appTool({ toolCallId: 'y', kind: 'execute', rawInput: { command: ['bash', '-lc', 'ls'] } })).toEqual({ name: 'bash', input: { command: 'bash -lc ls' } });
  });

  it('a read’s lines are numbered as the app reads them, so its lines are marked', () => {
    const read = byTool('Read')[0];
    const tool = appTool(read);
    const out = toolOutput(read, tool.name);
    expect(out.split('\n')[1]).toBe('26: == Inner products');
    const marks = readOf(ROOT, tool.name, tool.input, out)!;
    expect([marks.path, marks.start, marks.start + marks.lines.length - 1]).toEqual(['chapters/ch1-vectors.typ', 25, 34]);
  });

  it('a permission request: the action, the file in the book, the edit as a patch', () => {
    const request = messages.find((m) => m.method === 'session/request_permission');
    const ask = permissionAsk(request.params.toolCall, ROOT);
    expect(ask.action).toBe('edit');
    expect(ask.resources).toEqual(['chapters/ch1-vectors.typ']);
    expect(ask.patches[0].file).toBe('chapters/ch1-vectors.typ');
    expect(ask.patches[0].patch.split('\n')).toEqual(['--- chapters/ch1-vectors.typ', '+++ chapters/ch1-vectors.typ', '-Two vectors are orthogonal', '+Two vectors are perpendicular']);
    expect(permissionAsk({ toolCallId: 'z', kind: 'edit', locations: [{ path: '/etc/hosts' }] }, ROOT).action).toBe('external_directory');
  });

  it('the permission rules answer what they can', () => {
    const ask = sessionRules(PRESETS.ask.permissions);
    const edit = sessionRules(PRESETS.edit.permissions);
    const readOnly = sessionRules(PRESETS.edit.permissions, true);
    expect(decide('edit', ['chapters/ch1.typ'], ask)).toBe('ask');
    expect(decide('edit', ['chapters/ch1.typ'], edit)).toBe('allow');
    expect(decide('edit', ['chapters/ch1.typ'], readOnly)).toBe('deny');
    expect(decide('shell', ['ls chapters'], ask)).toBe('allow');
    expect(decide('shell', ['cat main.typ | grep include'], ask)).toBe('allow');
    expect(decide('shell', ['ls; rm notes.typ'], edit)).toBe('ask');
    expect(decide('shell', ['typst compile main.typ'], edit)).toBe('deny');
    expect(decide('shell', ['ls $(rm x)'], edit)).toBe('ask');
    expect(decide('webfetch', ['https://typst.app'], ask)).toBe('ask');
  });
});

/** The adapter against the recording: what it sends, what it emits. */
function harness() {
  const sent: any[] = [];
  let deliver: (m: any) => void = () => {};
  const transport: AcpTransport = {
    start: async (_kind, onMessage) => {
      deliver = onMessage;
    },
    send: async (line) => {
      const m = JSON.parse(line);
      sent.push(m);
      // The recording's own replies to initialize and session/new.
      if (m.method === 'initialize' || m.method === 'session/new') queueMicrotask(() => deliver(messages.find((r) => r.id === m.id && r.result)));
    },
    stop: async () => {},
  };
  const adapter = new AcpAdapter(ROOT, 'claude', transport);
  const events: AgentEvent[] = [];
  adapter.subscribe((e) => events.push(e));
  return { adapter, sent, events, deliver: (m: any) => deliver(m) };
}

describe('AcpAdapter', () => {
  it('runs a turn: instructions once, the rules or the author answer, events, transcript, queue', async () => {
    const { adapter, sent, events, deliver } = harness();
    await adapter.start();
    expect(sent.map((m) => m.method)).toEqual(['initialize', 'session/new']);
    const models = await adapter.listModels();
    expect(models.map((m) => m.id)).toContain('opus');
    expect(await adapter.defaultModel()).toEqual({ providerID: 'claude', id: 'opus' });

    const sessionId = await adapter.createSession(null, { permissions: PRESETS.ask.permissions });
    expect(sessionId).toBe(messages.find((m) => m.id === 2).result.sessionId);
    await adapter.setInstructions(sessionId, 'book', 'You are writing a Typst book.');
    await adapter.send(sessionId, 'Count the words, then change one.', []);
    const prompt = sent.at(-1);
    expect(prompt.method).toBe('session/prompt');
    expect(prompt.params.prompt[0].text).toBe('<typst-studio-instructions>\nYou are writing a Typst book.\n</typst-studio-instructions>\n\nCount the words, then change one.');
    expect(stripInstructions(prompt.params.prompt[0].text)).toBe('Count the words, then change one.');

    // The turn as recorded; the edit waits for the author.
    for (const m of messages.filter((m) => m.method)) deliver(m);
    const asked = events.find((e) => e.type === 'permission-asked') as Extract<AgentEvent, { type: 'permission-asked' }>;
    expect(asked).toMatchObject({ action: 'edit', resources: ['chapters/ch1-vectors.typ'] });
    expect((await adapter.pendingPermissions(sessionId)).length).toBe(1);
    await adapter.replyPermission(sessionId, asked.requestId, 'once');
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 0, result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } });
    expect(await adapter.isRunning(sessionId)).toBe(true);

    // A message while it works waits for the turn to end.
    const inboxId = await adapter.send(sessionId, 'And a summary, please.', []);
    expect(inboxId).toBeTruthy();
    deliver({ ...messages.find((m) => m.id === 3 && m.result), id: prompt.id });
    await Promise.resolve();
    const kinds = events.map((e) => e.type);
    expect(kinds.filter((k) => k === 'tool-started').length).toBe(4);
    expect(kinds.filter((k) => k === 'tool-succeeded').length).toBe(4);
    expect(events.find((e) => e.type === 'text-ended')).toMatchObject({ text: 'done' });
    expect(events.find((e) => e.type === 'turn-finished')).toMatchObject({ outcome: 'succeeded' });
    expect(events.at(-2)).toEqual({ type: 'inbox-delivered', sessionId, inboxId });
    expect(events.at(-1)).toEqual({ type: 'turn-started', sessionId });
    // The queued message goes as the next prompt, without the instructions again.
    expect(sent.at(-1).params.prompt[0].text).toBe('And a summary, please.');

    // The conversation as the app rebuilds it after a switch.
    const context = await adapter.sessionContext(sessionId);
    const items = itemsFromContext(context as never, ROOT);
    expect(items.map((i) => i.kind)).toEqual(['user', 'tool', 'tool', 'tool', 'tool', 'assistant', 'user']);
    expect(items.find((i) => i.kind === 'assistant')).toMatchObject({ text: 'done' });
    expect(items.find((i) => i.kind === 'tool' && i.name === 'read')).toMatchObject({ read: { path: 'chapters/ch1-vectors.typ', from: 25, to: 34 } });
    expect(contextTokens(context as never)).toBeGreaterThan(30000);
  });

  it('says how to sign in when the agent isn’t signed in', async () => {
    // Gemini CLI 0.64 without a login, as recorded: session/new fails with auth_required.
    let deliver: (m: any) => void = () => {};
    const transport: AcpTransport = {
      start: async (_kind, onMessage) => {
        deliver = onMessage;
      },
      send: async (line) => {
        const m = JSON.parse(line);
        if (m.method === 'initialize') queueMicrotask(() => deliver({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }] } }));
        if (m.method === 'session/new') queueMicrotask(() => deliver({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'Gemini API key is missing or not configured.' } }));
      },
      stop: async () => {},
    };
    const start = new AcpAdapter(ROOT, 'gemini', transport).start();
    await expect(start).rejects.toThrow('Gemini CLI isn’t signed in (“Gemini API key is missing or not configured.”). In Terminal, run npx @google/gemini-cli (or gemini), choose Log in with Google, then quit it; then start it again.');
  });

  it('answers by the rules without asking, and cancels what’s open on Stop', async () => {
    const { adapter, sent, events, deliver } = harness();
    await adapter.start();
    const sessionId = await adapter.createSession(null, { permissions: PRESETS.edit.permissions });
    await adapter.send(sessionId, 'Change it.', []);
    deliver(messages.find((m) => m.method === 'session/request_permission'));
    expect(events.some((e) => e.type === 'permission-asked')).toBe(false);
    expect(sent.at(-1).result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });

    await adapter.setPermissions(sessionId, PRESETS.ask.permissions);
    deliver({ ...messages.find((m) => m.method === 'session/request_permission'), id: 7 });
    expect(events.some((e) => e.type === 'permission-asked')).toBe(true);
    await adapter.cancel(sessionId);
    expect(sent.slice(-2)).toEqual([
      { jsonrpc: '2.0', id: 7, result: { outcome: { outcome: 'cancelled' } } },
      { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } },
    ]);
  });
});

// Codex's ACP program in its read-only mode, recorded: it looks around with
// shell commands, searches, then asks to run a command that writes the file.
const codex = recordedCodex
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

describe('Codex', () => {
  const codexCalls = new Map<string, AcpToolCall>();
  for (const m of codex.filter((m) => m.method === 'session/update' && m.params.update.sessionUpdate.startsWith('tool_call')))
    codexCalls.set(m.params.update.toolCallId, { ...codexCalls.get(m.params.update.toolCallId), ...m.params.update });
  const request = codex.find((m) => m.method === 'session/request_permission');

  it('its tools: commands, searches by their titles, its quoted commands', () => {
    const [first, , , search] = [...codexCalls.values()];
    expect(appTool(first)).toEqual({ name: 'bash', input: { command: "pwd && rg --files -g AGENTS.md -g ch1-vectors.typ -g '!node_modules' -g '!vendor' ." } });
    expect(appTool(search)).toEqual({ name: 'grep', input: { pattern: 'Two vectors are orthogonal' } });
    const ask = permissionAsk(request.params.toolCall, ROOT);
    expect(ask.action).toBe('shell');
    expect(ask.resources[0]).toMatch(/^python3 -c 'from pathlib import Path; p = Path\("chapters\/ch1-vectors.typ"\)/);
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.edit.permissions))).toBe('ask');
  });

  it('a title that is only the instructions sent first isn’t used', () => {
    expect(conversationTitle('<typst-studio-instructions>\n# Typst Studio: writing assistant…')).toBe('');
    expect(conversationTitle('<typst-studio-instructions>\nx\n</typst-studio-instructions>\n\nTighten chapter 2')).toBe('Tighten chapter 2');
    expect(conversationTitle('Tighten chapter 2')).toBe('Tighten chapter 2');
  });

  it('asks in read-only unless edits are allowed; command output streams into the tool’s result', async () => {
    const sent: any[] = [];
    let deliver: (m: any) => void = () => {};
    const transport: AcpTransport = {
      start: async (_kind, onMessage) => {
        deliver = onMessage;
      },
      send: async (line) => {
        const m = JSON.parse(line);
        sent.push(m);
        const reply = m.method === 'initialize' || m.method === 'session/new' ? codex.find((r) => r.id === m.id && r.result) : m.method ? { jsonrpc: '2.0', id: m.id, result: {} } : null;
        if (reply && m.id !== undefined && m.method !== 'session/prompt') queueMicrotask(() => deliver({ ...reply, id: m.id }));
      },
      stop: async () => {},
    };
    const adapter = new AcpAdapter(ROOT, 'codex', transport);
    const events: AgentEvent[] = [];
    adapter.subscribe((e) => events.push(e));
    await adapter.start();
    expect((await adapter.listModels()).map((m) => m.id)).toContain('gpt-6.1-sol');
    const sessionId = await adapter.createSession(null, { permissions: PRESETS.ask.permissions });
    expect(sent.find((m) => m.method === 'session/set_mode')?.params).toEqual({ sessionId, modeId: 'read-only' });
    await adapter.setPermissions(sessionId, PRESETS.edit.permissions);
    expect(sent.filter((m) => m.method === 'session/set_mode').at(-1).params.modeId).toBe('workspace-write');
    await adapter.switchAgent(sessionId, 'plan');
    expect(sent.at(-1)).toMatchObject({ method: 'session/set_config_option', params: { configId: 'collaboration_mode', value: 'plan' } });
    await adapter.switchAgent(sessionId, 'build');

    await adapter.send(sessionId, 'Change it.', []);
    const prompt = sent.at(-1);
    for (const m of codex.filter((m) => m.method)) deliver(m);
    const end = codex.find((m) => m.result?.stopReason);
    deliver({ ...end, id: prompt.id });
    await Promise.resolve();
    const search = [...codexCalls.values()][3];
    expect(events.find((e) => e.type === 'tool-succeeded' && e.callId === search.toolCallId)).toMatchObject({ output: expect.stringContaining('29:Two vectors are orthogonal') });
    expect(events.find((e) => e.type === 'permission-asked')).toMatchObject({ action: 'shell' });
    expect(events.find((e) => e.type === 'session-renamed')).toMatchObject({ title: expect.stringMatching(/^In chapters\/ch1-vectors.typ change/) });
    const compacting = adapter.compact(sessionId);
    await Promise.resolve();
    const compact = sent.at(-1);
    expect(compact.params.prompt[0].text).toBe('/compact');
    deliver({ ...end, id: compact.id });
    await compacting;
    expect(await adapter.isRunning(sessionId)).toBe(false);
  });
});
