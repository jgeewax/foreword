// Assistants spoken to over the Agent Client Protocol (ACP): Claude Code,
// Gemini CLI and Codex, each through its ACP program, which the Rust side runs
// in the book's folder (acp.rs). JSON-RPC lines both ways. What OpenCode keeps
// on its server, the app keeps here: each conversation's transcript, its
// instructions (sent with the next message when they change), its permission
// rules (the agent asks; the rules answer, or the author does), and messages
// queued while a turn runs.
import { formatSelectionContext } from '../../editor/selection';
import { Channel, ipc } from '../../lib/ipc';
import { appTool, decide, optionValues, permissionAsk, toolOutput, Transcript, type AcpConfigOption, type AcpToolCall } from './acp-events';
import { formatAuthorEdits } from './author-edits';
import { DEFAULT_PERMISSIONS, sessionRules, type AgentPermissions } from './permissions';
import type { AgentAdapter, AgentEvent, Delivery, FilePatch, FormAnswer, FormRequest, MessageContext, ModelInfo, ModelRef, PermissionDecision } from './types';

export type AcpKind = 'claude' | 'gemini' | 'codex';

export const ACP_NAMES: Record<AcpKind, string> = { claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex' };

/** Instructions go before the author's message, inside these, and are taken out again when a conversation is replayed. */
const INSTRUCTIONS_OPEN = '<typst-studio-instructions>';
const INSTRUCTIONS_CLOSE = '</typst-studio-instructions>';
export const stripInstructions = (text: string) => text.replace(new RegExp(`^${INSTRUCTIONS_OPEN}[\\s\\S]*?${INSTRUCTIONS_CLOSE}\\s*`), '');

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

/** How messages reach the agent's program: the Rust side's, or a test's. */
export type AcpTransport = {
  start(kind: AcpKind, onMessage: (m: any) => void): Promise<unknown>;
  send(line: string): Promise<void>;
  stop(): Promise<void>;
};

const tauriTransport: AcpTransport = {
  start: (kind, onMessage) => {
    const channel = new Channel<any>();
    channel.onmessage = onMessage;
    return ipc.acpStart(kind, channel);
  },
  send: (line) => ipc.acpSend(line),
  stop: () => ipc.acpStop(),
};

type Session = {
  id: string;
  transcript: Transcript;
  config: AcpConfigOption[];
  modes: string[];
  running: boolean;
  turn: number;
  permissions: AgentPermissions;
  readOnly: boolean;
  allowCommands: string[];
  instructions: Map<string, string>;
  /** The instructions as last sent (sent again when they change). */
  sentInstructions: string;
  queue: { inboxId: string; text: string }[];
  /** Permission requests waiting for the author: our request id → the agent's JSON-RPC id and options. */
  asking: Map<string, { rpcId: number | string; options: { optionId: string; kind: string }[]; ask: { action: string; resources: string[]; patches: FilePatch[] } }>;
  /** Each tool call as the agent has described it so far (updates add to it), and as the app's tool. */
  tools: Map<string, { call: AcpToolCall; name: string; input: Record<string, unknown> }>;
  title: string;
  /** Replaying (session/load): updates fill the transcript but aren't live events. */
  replaying: boolean;
};

export class AcpError extends Error {}

export class AcpAdapter implements AgentAdapter {
  private listeners = new Set<(e: AgentEvent) => void>();
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private sessions = new Map<string, Session>();
  private caps: Record<string, any> = {};
  /** A session made at start: its config options give the models, and the first conversation starts at once. */
  private warm: Promise<Session | null> | null = null;
  private seq = 0;

  constructor(
    private readonly root: string,
    readonly kind: AcpKind,
    private readonly transport: AcpTransport = tauriTransport,
  ) {}

  // ---- the connection ------------------------------------------------------------------

  async start() {
    await this.transport.start(this.kind, (m) => this.receive(m));
    this.emit({ type: 'connection', status: 'open' });
    const init = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'typst-studio', title: 'Typst Studio', version: '0.1.0' },
    });
    this.caps = init ?? {};
    // A failure here (signed out, say) is the start's failure, in the agent's own words.
    const warm = await this.newSession();
    this.warm = Promise.resolve(warm);
  }

  async stop() {
    for (const s of this.sessions.values()) if (s.running) this.notify('session/cancel', { sessionId: s.id });
    await this.transport.stop();
  }

  private send_(message: object) {
    void this.transport.send(JSON.stringify(message)).catch((e) => console.warn('acp: send failed', e));
  }

  private request(method: string, params: object): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })).catch((e) => {
        this.pending.delete(id);
        reject(e);
      });
    });
  }

  private notify(method: string, params: object) {
    this.send_({ jsonrpc: '2.0', method, params });
  }

  private respond(id: number | string, result: object) {
    this.send_({ jsonrpc: '2.0', id, result });
  }

  private receive(m: any) {
    if (m?.$exit) {
      for (const p of this.pending.values()) p.reject(new AcpError(`${ACP_NAMES[this.kind]} stopped.`));
      this.pending.clear();
      for (const s of this.sessions.values()) if (s.running) this.finish(s, 'failed', `${ACP_NAMES[this.kind]} stopped.`);
      this.emit({ type: 'connection', status: 'lost' });
      return;
    }
    if (m.method === undefined && m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new AcpError(m.error.data?.message ?? m.error.message ?? 'The assistant refused.'));
      else p.resolve(m.result);
      return;
    }
    if (m.method === 'session/update') return this.update(m.params);
    if (m.method === 'session/request_permission') return this.askPermission(m.id, m.params);
    // Anything else the agent asks of us (files, terminals): not offered.
    if (m.id !== undefined) this.send_({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `${m.method} isn't supported` } });
  }

  private emit(e: AgentEvent) {
    for (const l of this.listeners) l(e);
  }

  subscribe(onEvent: (event: AgentEvent) => void) {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }

  // ---- sessions and their settings -----------------------------------------------------

  private async newSession(): Promise<Session> {
    const res = await this.request('session/new', { cwd: this.root, mcpServers: [] });
    return this.track(res.sessionId, res);
  }

  private track(id: string, res: any): Session {
    const s: Session = {
      id,
      transcript: this.sessions.get(id)?.transcript ?? new Transcript(),
      config: Array.isArray(res?.configOptions) ? res.configOptions : [],
      modes: (res?.modes?.availableModes ?? []).map((m: any) => String(m.id)),
      running: false,
      turn: 0,
      permissions: DEFAULT_PERMISSIONS,
      readOnly: false,
      allowCommands: [],
      instructions: new Map(),
      sentInstructions: '',
      queue: [],
      asking: new Map(),
      tools: new Map(),
      title: '',
      replaying: false,
    };
    this.sessions.set(id, s);
    return s;
  }

  private session(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new AcpError('That conversation isn’t open.');
    return s;
  }

  private modelOption(s: Session | null | undefined) {
    return s?.config.find((o) => o.category === 'model' || o.id === 'model');
  }

  async listModels(): Promise<ModelInfo[]> {
    const option = this.modelOption((await this.warm) ?? [...this.sessions.values()][0]);
    const provider = ACP_NAMES[this.kind];
    return option
      ? optionValues(option).map((o) => ({ providerID: this.kind, id: o.value, name: o.name, providerName: provider, supportsTools: true }))
      : [{ providerID: this.kind, id: 'default', name: 'Default', providerName: provider, supportsTools: true }];
  }

  async defaultModel(): Promise<ModelRef | null> {
    const option = this.modelOption((await this.warm) ?? [...this.sessions.values()][0]);
    return { providerID: this.kind, id: String(option?.currentValue ?? 'default') };
  }

  async createSession(model: ModelRef | null, { permissions = DEFAULT_PERMISSIONS as AgentPermissions, readOnly = false, agent = 'build' as 'build' | 'plan', allowCommands = [] as string[] } = {}) {
    const warm = this.warm ? await this.warm : null;
    this.warm = null;
    const s = warm ?? (await this.newSession());
    Object.assign(s, { permissions, readOnly, allowCommands });
    if (model && model.providerID === this.kind) await this.switchModel(s.id, model).catch(() => {});
    if (agent === 'plan') await this.switchAgent(s.id, 'plan').catch(() => {});
    return s.id;
  }

  async setPermissions(sessionId: string, permissions: AgentPermissions, readOnly = false, allowCommands: string[] = []) {
    Object.assign(this.session(sessionId), { permissions, readOnly, allowCommands });
  }

  /** Plan: the agent's own plan mode, when it has one (its read-only rules apply either way). */
  async switchAgent(sessionId: string, agent: 'build' | 'plan') {
    const s = this.session(sessionId);
    const mode = agent === 'plan' ? 'plan' : s.modes.includes('default') ? 'default' : s.modes[0];
    if (mode && s.modes.includes(mode)) await this.request('session/set_mode', { sessionId, modeId: mode });
  }

  async setInstructions(sessionId: string, key: string, text: string) {
    this.session(sessionId).instructions.set(key, text);
  }

  async getInstructions(sessionId: string) {
    return [...this.session(sessionId).instructions].map(([key, value]) => ({ key, value: value as unknown }));
  }

  async removeInstructions(sessionId: string, key: string) {
    this.session(sessionId).instructions.delete(key);
  }

  async switchModel(sessionId: string, model: ModelRef) {
    const s = this.session(sessionId);
    const option = this.modelOption(s);
    if (!option || option.currentValue === model.id) return;
    const res = await this.request('session/set_config_option', { sessionId, configId: option.id, value: model.id });
    if (Array.isArray(res?.configOptions)) s.config = res.configOptions;
    else option.currentValue = model.id;
  }

  // ---- conversations -------------------------------------------------------------------

  async listSessions(limit = 50) {
    if (!this.caps.agentCapabilities?.sessionCapabilities?.list) {
      return [...this.sessions.values()]
        .filter((s) => s.transcript.messages.length)
        .map((s) => ({ id: s.id, title: s.title, updated: Date.now(), tokens: null }))
        .slice(0, limit);
    }
    const res = await this.request('session/list', { cwd: this.root });
    return ((res?.sessions ?? []) as any[]).slice(0, limit).map((s) => ({
      id: String(s.sessionId),
      title: String(s.title ?? this.sessions.get(s.sessionId)?.title ?? ''),
      updated: s.updatedAt ? Date.parse(s.updatedAt) : 0,
      tokens: null,
    }));
  }

  /** A conversation's messages: kept since it was opened here, or replayed by the agent (session/load). */
  async sessionContext(sessionId: string) {
    let s = this.sessions.get(sessionId);
    if (!s && this.caps.agentCapabilities?.loadSession) {
      s = this.track(sessionId, null);
      s.replaying = true;
      try {
        const res = await this.request('session/load', { sessionId, cwd: this.root, mcpServers: [] });
        s.config = Array.isArray(res?.configOptions) ? res.configOptions : [];
        s.modes = (res?.modes?.availableModes ?? []).map((m: any) => String(m.id));
      } catch (e) {
        this.sessions.delete(sessionId);
        throw e;
      } finally {
        s.replaying = false;
        s.transcript.endTurn();
      }
    }
    return s ? (s.transcript.messages as any[]) : [];
  }

  async compact(sessionId: string) {
    // Claude Code compacts on its /compact command; ACP has no request for it.
    if (this.kind !== 'claude') throw new AcpError(`${ACP_NAMES[this.kind]} can’t compact a conversation.`);
    await this.prompt(this.session(sessionId), '/compact', { record: false, command: true });
    await waitFor(() => !this.sessions.get(sessionId)?.running);
  }

  async activeSessions() {
    return new Set([...this.sessions.values()].filter((s) => s.running).map((s) => s.id));
  }

  async isRunning(sessionId: string) {
    return !!this.sessions.get(sessionId)?.running;
  }

  // ---- messages and turns --------------------------------------------------------------

  async send(sessionId: string, message: string, context: MessageContext[], delivery?: Delivery) {
    const s = this.session(sessionId);
    const text = [message, ...context.map((c) => ('authorEdits' in c ? formatAuthorEdits(c.authorEdits) : formatSelectionContext(c.selection, c.stale)))].join('\n\n');
    if (!s.running) {
      await this.prompt(s, text);
      return null;
    }
    const inboxId = `acp-inbox-${++this.seq}`;
    if (delivery === 'steer' && this.canSteer()) {
      await this.steerNow(s, inboxId, text);
      return inboxId;
    }
    s.queue.push({ inboxId, text });
    return inboxId;
  }

  private canSteer() {
    return !!this.caps._meta?.steering?.supported;
  }

  /** Into the running turn, at its next step (Claude Code's steering). */
  private async steerNow(s: Session, inboxId: string, text: string) {
    await this.request('_session/steering', { sessionId: s.id, prompt: [{ type: 'text', text }] });
    s.transcript.user(inboxId, text);
    this.emit({ type: 'inbox-delivered', sessionId: s.id, inboxId });
  }

  async steer(sessionId: string, inboxId: string) {
    const s = this.session(sessionId);
    const at = s.queue.findIndex((q) => q.inboxId === inboxId);
    if (at < 0 || !this.canSteer() || !s.running) return;
    const [q] = s.queue.splice(at, 1);
    await this.steerNow(s, q.inboxId, q.text);
  }

  async unqueue(sessionId: string, inboxId: string) {
    const s = this.session(sessionId);
    s.queue = s.queue.filter((q) => q.inboxId !== inboxId);
  }

  async resume(sessionId: string) {
    await this.prompt(
      this.session(sessionId),
      "The author stopped you (or the model failed) and now wants you to carry on. Continue the task from where you left off; don't redo steps that are already done.",
      { record: false },
    );
  }

  /**
   * Start a turn: the instructions first when they've changed. The request
   * returns when the turn ends; this returns once it's sent.
   */
  private async prompt(s: Session, text: string, { record = true, command = false } = {}) {
    // A slash command must come first, so the instructions wait for the next message.
    const instructions = command ? s.sentInstructions : [...s.instructions.values()].join('\n\n');
    const changed = instructions !== s.sentInstructions;
    const full = changed && instructions ? `${INSTRUCTIONS_OPEN}\n${instructions}\n${INSTRUCTIONS_CLOSE}\n\n${text}` : text;
    s.sentInstructions = instructions;
    s.turn++;
    if (record) s.transcript.user(`${s.id}:u${s.turn}`, text);
    s.running = true;
    this.emit({ type: 'turn-started', sessionId: s.id });
    this.request('session/prompt', { sessionId: s.id, prompt: [{ type: 'text', text: full }] }).then(
      (res) => {
        const reason = res?.stopReason;
        if (reason === 'end_turn') this.finish(s, 'succeeded');
        else if (reason === 'cancelled') this.finish(s, 'interrupted');
        else this.finish(s, 'failed', reason === 'refusal' ? 'The model refused.' : reason === 'max_tokens' ? 'The reply was too long for the model.' : `The turn ended early (${reason}).`);
      },
      (e) => this.finish(s, 'failed', e instanceof Error ? e.message : String(e)),
    );
  }

  private finish(s: Session, outcome: 'succeeded' | 'failed' | 'interrupted', error?: string) {
    if (!s.running) return;
    this.endPart(s);
    s.transcript.endTurn();
    s.running = false;
    // Requests the turn left open are over.
    for (const [requestId] of s.asking) this.emit({ type: 'permission-replied', sessionId: s.id, requestId, reply: 'reject' });
    s.asking.clear();
    this.emit({ type: 'turn-finished', sessionId: s.id, outcome, error });
    const next = s.queue.shift();
    if (next) {
      this.emit({ type: 'inbox-delivered', sessionId: s.id, inboxId: next.inboxId });
      void this.prompt(s, next.text);
    }
  }

  async cancel(sessionId: string) {
    const s = this.session(sessionId);
    // The protocol: answer every open permission request as cancelled, then cancel.
    for (const [, a] of s.asking) this.respond(a.rpcId, { outcome: { outcome: 'cancelled' } });
    this.notify('session/cancel', { sessionId });
  }

  // ---- what the agent sends ------------------------------------------------------------

  /** A text or thinking part is over: say so, with its whole text. */
  private endPart(s: Session) {
    const part = s.transcript.current();
    if (!part || s.replaying) return;
    const [messageId, n] = part.itemId.split(/:r?(?=\d+$)/);
    const ordinal = Number(n);
    if (part.kind === 'text') this.emit({ type: 'text-ended', sessionId: s.id, messageId, ordinal, text: part.text });
    else this.emit({ type: 'reasoning-ended', sessionId: s.id, messageId, ordinal, text: part.text });
  }

  private update({ sessionId, update: u }: { sessionId: string; update: any }) {
    const s = this.sessions.get(sessionId);
    if (!s || !u) return;
    const live = !s.replaying;
    const replyId = `${s.id}:a${s.turn}`;
    switch (u.sessionUpdate) {
      case 'user_message_chunk':
        // A replay: the author's messages, without the instructions sent with them.
        // Claude Code's note that a turn was stopped isn't the author's.
        if (u.content?.type === 'text' && !/^\[Request interrupted by user[^\]]*\]$/.test(u.content.text.trim())) {
          if (!s.transcript.inUserMessage()) s.turn++;
          s.transcript.userChunk(`${s.id}:u${s.turn}`, stripInstructions(u.content.text));
        }
        break;
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        if (u.content?.type !== 'text' || !u.content.text) break;
        const kind = u.sessionUpdate === 'agent_message_chunk' ? 'text' : 'reasoning';
        const before = s.transcript.current();
        if (before && before.kind !== kind) this.endPart(s);
        const { itemId } = s.transcript.append(kind, replyId, u.content.text);
        if (!live) break;
        const [messageId, n] = itemId.split(/:r?(?=\d+$)/);
        if (kind === 'text') this.emit({ type: 'text-delta', sessionId, messageId, ordinal: Number(n), delta: u.content.text });
        else this.emit({ type: 'reasoning-delta', sessionId, messageId, ordinal: Number(n), delta: u.content.text });
        break;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const update = u as AcpToolCall;
        const known = s.tools.get(update.toolCallId);
        if (!known) this.endPart(s);
        // Updates carry only what changed: the call is what they add up to.
        const defined = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined && v !== null));
        const call = { ...known?.call, ...defined } as AcpToolCall;
        const tool = { call, ...appTool(call) };
        s.tools.set(update.toolCallId, tool);
        const status = update.status === 'completed' ? 'completed' : update.status === 'failed' ? 'failed' : 'running';
        const output = status === 'running' ? undefined : toolOutput(update.rawOutput !== undefined || update.content ? update : call, tool.name);
        s.transcript.tool(replyId, call.toolCallId, tool.name, tool.input, status, output);
        if (!live) break;
        if (!known) this.emit({ type: 'tool-started', sessionId, callId: update.toolCallId, name: tool.name });
        if (update.rawInput !== undefined || !known) this.emit({ type: 'tool-called', sessionId, callId: update.toolCallId, input: tool.input });
        if (status === 'completed') this.emit({ type: 'tool-succeeded', sessionId, callId: update.toolCallId, output: output ?? '' });
        else if (status === 'failed') this.emit({ type: 'tool-failed', sessionId, callId: update.toolCallId, error: output || 'It failed.' });
        break;
      }
      case 'usage_update':
        if (typeof u.used === 'number' && u.used > 0) s.transcript.setTokens(replyId, u.used);
        if (live && u.cost?.amount != null) this.emit({ type: 'usage', sessionId, inputTokens: u.used ?? 0, outputTokens: 0, cost: u.cost.amount });
        break;
      case 'session_info_update':
        if (typeof u.title === 'string' && u.title) {
          s.title = u.title;
          if (live) this.emit({ type: 'session-renamed', sessionId, title: u.title });
        }
        break;
      case 'config_option_update':
        if (Array.isArray(u.configOptions)) s.config = u.configOptions;
        break;
    }
  }

  /** The agent asks: the conversation's rules answer when they can, otherwise the author does. */
  private askPermission(rpcId: number | string, params: any) {
    const s = this.sessions.get(params?.sessionId);
    const options = (params?.options ?? []) as { optionId: string; kind: string }[];
    const pick = (kinds: string[]) => options.find((o) => kinds.includes(o.kind))?.optionId;
    if (!s) return this.respond(rpcId, { outcome: { outcome: 'cancelled' } });
    const ask = permissionAsk(params.toolCall as AcpToolCall, this.root);
    const effect = decide(ask.action, ask.resources, sessionRules(s.permissions, s.readOnly, s.allowCommands));
    if (effect !== 'ask') {
      const optionId = effect === 'allow' ? pick(['allow_once', 'allow_always']) : pick(['reject_once', 'reject_always']);
      return this.respond(rpcId, optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } });
    }
    const requestId = `acp-perm-${++this.seq}`;
    s.asking.set(requestId, { rpcId, options, ask });
    this.emit({ type: 'permission-asked', sessionId: s.id, requestId, ...ask });
  }

  async replyPermission(sessionId: string, requestId: string, decision: PermissionDecision) {
    const s = this.session(sessionId);
    const a = s.asking.get(requestId);
    if (!a) throw new AcpError('That request is no longer open.');
    s.asking.delete(requestId);
    const kinds = decision === 'once' ? ['allow_once'] : decision === 'always' ? ['allow_always', 'allow_once'] : ['reject_once', 'reject_always'];
    const optionId = a.options.find((o) => kinds.includes(o.kind))?.optionId;
    this.respond(a.rpcId, optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } });
    this.emit({ type: 'permission-replied', sessionId, requestId, reply: decision });
  }

  async pendingPermissions(sessionId: string) {
    return [...(this.sessions.get(sessionId)?.asking ?? new Map()).entries()].map(([requestId, a]) => ({ requestId, ...a.ask }));
  }

  // The question tool is OpenCode's: ACP agents ask in their replies.
  async pendingForms(): Promise<FormRequest[]> {
    return [];
  }

  async replyForm(_sessionId: string, _formId: string, _answer: FormAnswer) {}

  async cancelForm() {}
}

function waitFor(done: () => boolean, ms = 120000): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => (done() || Date.now() - t0 > ms ? resolve() : setTimeout(tick, 200));
    tick();
  });
}
