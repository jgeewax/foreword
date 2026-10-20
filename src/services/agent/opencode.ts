// OpenCode 2.x adapter. Talks to the app-managed `opencode serve` through the
// Rust bridge (agent.rs). API shapes verified against the server's own
// /openapi.json (OpenCode 2.0.20); the npm SDK (1.x) targets the older API.
import { formatSelectionContext } from '../../editor/selection';
import { formatAuthorEdits } from './author-edits';
import { Channel, ipc } from '../../lib/ipc';
import { mapOpenCodeEvent, toFormRequest } from './opencode-events';
import { DEFAULT_PERMISSIONS, sessionRules, type AgentPermissions, type PermissionRule } from './permissions';
import { effortKey, effortOption } from './models';
import { DEFAULT_EFFORT, type AgentAdapter, type AgentEvent, type Delivery, type Efforts, type FormAnswer, type FormRequest, type ModelInfo, type ModelRef, type PermissionDecision } from './types';

// Permission rules: see permissions.ts (what the assistant may do).
export { NO_COMPILE_RULES, READ_ONLY_RULES, sessionRules } from './permissions';

export class AgentApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await ipc.agentRequest(method, path, body);
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const message = res.body?.message ?? (typeof res.body === 'string' ? res.body : `HTTP ${res.status}`);
  throw new AgentApiError(res.status, `${message}${res.body?._tag ? ` (${res.body._tag})` : ''}`);
}

/** Every raw OpenCode event, for self-tests that check what the server sends. */
export const rawEventTap: { fn?: (raw: any) => void } = {};

/** A model as OpenCode takes it: with a variant (its effort), or as it comes. */
const modelBody = (model: ModelRef, effort?: string | null) => ({ providerID: model.providerID, id: model.id, ...(effort && effort !== DEFAULT_EFFORT ? { variant: effort } : {}) });

export class OpenCodeAdapter implements AgentAdapter {
  private listeners = new Set<(e: AgentEvent) => void>();
  /** Each model's variants (its levels of effort), from the last list of models. */
  private variants = new Map<string, string[]>();

  constructor(
    private readonly root: string,
    /** Foreword's own tools (its settings), an MCP server over HTTP. */
    private readonly tools: { name: string; url: string } | null = null,
  ) {}

  async start() {
    await ipc.agentStart();
    const channel = new Channel<any>();
    channel.onmessage = (raw) => {
      rawEventTap.fn?.(raw);
      const event = mapOpenCodeEvent(raw);
      if (event) for (const l of this.listeners) l(event);
    };
    await ipc.agentSubscribe(channel);
    // For as long as this server runs (OpenCode doesn't keep it in its config).
    if (this.tools) {
      this.toolsAdded = await call('PUT', `/api/experimental/mcp/${encodeURIComponent(this.tools.name)}?location[directory]=${encodeURIComponent(this.root)}`, {
        // Its tools as tools, not called from code ("code mode"): the chat shows each one, and the rules allow them by name.
        config: { type: 'remote', url: this.tools.url, oauth: false, codemode: false },
      }).then(
        () => true,
        (e) => (console.warn('opencode: Foreword’s tools not added', e), false),
      );
    }
  }

  private toolsAdded = false;

  hasStudioTools() {
    return this.toolsAdded;
  }

  async stop() {
    await ipc.agentStop();
  }

  async listModels(): Promise<ModelInfo[]> {
    const [models, providers] = await Promise.all([call('GET', '/api/model'), call('GET', '/api/provider')]);
    const providerNames = new Map<string, string>((providers.data ?? []).map((p: any) => [p.id, p.name ?? p.id]));
    this.variants = new Map(
      (models.data ?? []).map((m: any) => [effortKey({ providerID: m.providerID, id: m.id }), Array.isArray(m.variants) ? m.variants.map((v: any) => String(v?.id ?? '')).filter(Boolean) : []]),
    );
    return (models.data ?? [])
      .filter((m: any) => m.enabled !== false && (m.status ?? 'active') === 'active')
      .map((m: any) => ({
        providerID: m.providerID,
        id: m.id,
        name: m.name ?? m.id,
        providerName: providerNames.get(m.providerID) ?? m.providerID,
        supportsTools: m.capabilities?.tools !== false,
        contextWindow: typeof m.limit?.context === 'number' ? m.limit.context : undefined,
      }))
      .sort((a: ModelInfo, b: ModelInfo) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name));
  }

  async defaultModel(): Promise<ModelRef | null> {
    const d = (await call('GET', '/api/model/default')).data;
    return d ? { providerID: d.providerID, id: d.id } : null;
  }

  async createSession(
    model: ModelRef | null,
    { permissions = DEFAULT_PERMISSIONS as AgentPermissions, readOnly = false, agent = 'build' as 'build' | 'plan', rules = [] as PermissionRule[], effort = null as string | null } = {},
  ): Promise<string> {
    const res = await call('POST', '/api/session', {
      location: { directory: this.root },
      model: model ? modelBody(model, effort) : null,
      agent: agent === 'build' ? null : agent,
      permissions: sessionRules(permissions, readOnly, rules),
    });
    return res.data.id;
  }

  /** Update a live session's rules (verified to apply mid-session). */
  async setPermissions(sessionId: string, permissions: AgentPermissions, readOnly = false, rules: PermissionRule[] = []) {
    await call('PATCH', `/api/session/${sessionId}`, { permissions: sessionRules(permissions, readOnly, rules) });
  }

  /** OpenCode's built-in agents: `build` (default) or `plan`. */
  async switchAgent(sessionId: string, agent: 'build' | 'plan') {
    await call('POST', `/api/session/${sessionId}/agent`, { agent });
  }

  // Experimental in OpenCode 2.0.20; entries appear as `api/<key>` in the system context (verified).
  async setInstructions(sessionId: string, key: string, text: string) {
    await call('PUT', `/api/experimental/session/${sessionId}/instructions/entries/${encodeURIComponent(key)}`, { value: text });
  }

  async removeInstructions(sessionId: string, key: string) {
    await call('DELETE', `/api/experimental/session/${sessionId}/instructions/entries/${encodeURIComponent(key)}`);
  }

  async getInstructions(sessionId: string) {
    return (await call('GET', `/api/experimental/session/${sessionId}/instructions/entries`)).data ?? [];
  }

  async switchModel(sessionId: string, model: ModelRef) {
    await call('POST', `/api/session/${sessionId}/model`, { model: modelBody(model) });
  }

  /** A model's variants (verified on OpenCode 2.0.20: each is a reasoningEffort, and a session's model carries one). "Default" is the model without one. */
  async efforts(sessionId: string | null, model: ModelRef): Promise<Efforts | null> {
    if (!this.variants.size) await this.listModels();
    const variants = this.variants.get(effortKey(model)) ?? [];
    if (!variants.length) return null;
    let current: string | null = DEFAULT_EFFORT;
    if (sessionId) {
      const m = (await call('GET', `/api/session/${sessionId}`)).data?.model;
      current = m?.providerID === model.providerID && m?.id === model.id ? (m.variant ?? DEFAULT_EFFORT) : null;
    }
    return { options: [DEFAULT_EFFORT, ...variants].map((v) => effortOption(v)), current };
  }

  async switchEffort(sessionId: string, model: ModelRef, effort: string) {
    await call('POST', `/api/session/${sessionId}/model`, { model: modelBody(model, effort) });
  }

  async send(sessionId: string, message: string, context: Parameters<AgentAdapter['send']>[2], delivery?: Delivery) {
    const text = [message, ...context.map((c) => ('authorEdits' in c ? formatAuthorEdits(c.authorEdits) : formatSelectionContext(c.selection, c.stale)))].join('\n\n');
    const res = await call('POST', `/api/session/${sessionId}/prompt`, delivery ? { text, delivery } : { text });
    return (res.data?.id as string | undefined) ?? null;
  }

  async activeSessions() {
    const active = (await call('GET', '/api/session/active')).data ?? {};
    return new Set<string>(Array.isArray(active) ? active.map((s: any) => s?.id ?? s) : Object.keys(active));
  }

  async pendingPermissions(sessionId: string) {
    const res = await call('GET', `/api/permission/request?location[directory]=${encodeURIComponent(this.root)}`);
    return ((res.data ?? []) as any[])
      .filter((p) => p?.sessionID === sessionId && typeof p.id === 'string')
      .map((p) => ({
        requestId: p.id as string,
        action: String(p.action ?? ''),
        resources: Array.isArray(p.resources) ? p.resources.map(String) : [],
        patches: Array.isArray(p.metadata?.files) ? p.metadata.files.map((f: any) => ({ file: String(f.file ?? ''), patch: String(f.patch ?? '') })) : [],
      }));
  }

  async pendingForms(sessionId: string) {
    const res = await call('GET', `/api/session/${sessionId}/form`);
    return ((res.data ?? []) as any[]).map(toFormRequest).filter((f): f is FormRequest => !!f);
  }

  async replyForm(sessionId: string, formId: string, answer: FormAnswer) {
    await call('POST', `/api/session/${sessionId}/form/${formId}/reply`, { answer });
  }

  async cancelForm(sessionId: string, formId: string) {
    await call('DELETE', `/api/session/${sessionId}/form/${formId}`);
  }

  async resume(sessionId: string) {
    // A synthetic message (like OpenCode's own reminders): no made-up line from the author.
    await call('POST', `/api/session/${sessionId}/synthetic`, {
      text: 'The author stopped you (or the model failed) and now wants you to carry on. Continue the task from where you left off; don\'t redo steps that are already done.',
      description: 'Resume',
    });
  }

  async steer(sessionId: string, inboxId: string) {
    await call('PATCH', `/api/session/${sessionId}/inbox/${inboxId}`, { delivery: 'steer' });
  }

  async unqueue(sessionId: string, inboxId: string) {
    await call('DELETE', `/api/session/${sessionId}/inbox/${inboxId}`);
  }

  /** This book's conversations, newest first. */
  async listSessions(limit = 50) {
    const res = await call('GET', `/api/session?directory=${encodeURIComponent(this.root)}&limit=${limit}&order=desc`);
    return ((res.data ?? []) as any[]).map((s) => ({
      id: s.id as string,
      title: (s.title as string) ?? '',
      updated: (s.time?.updated ?? s.time?.created ?? 0) as number,
      tokens: (s.tokens?.input as number | undefined) ?? null,
    }));
  }

  /** A conversation's messages, normalized by OpenCode (user text, assistant text and tool parts). */
  async sessionContext(sessionId: string) {
    return ((await call('GET', `/api/session/${sessionId}/context`)).data ?? []) as any[];
  }

  /** Summarize the conversation so far to free up the context window. */
  async compact(sessionId: string) {
    await call('POST', `/api/session/${sessionId}/compact`, {});
  }

  async cancel(sessionId: string) {
    await call('POST', `/api/session/${sessionId}/interrupt`);
  }

  async replyPermission(sessionId: string, requestId: string, decision: PermissionDecision) {
    // "Always" is the app's to keep (command-rules.ts), in this session's rules: OpenCode's own would save `*`.
    await call('POST', `/api/session/${sessionId}/permission/${requestId}/reply`, { decision: decision === 'always' ? 'once' : decision });
  }

  /** A rejected permission ends a turn without a session.execution.* event, so the UI also polls this. */
  async isRunning(sessionId: string): Promise<boolean> {
    const active = (await call('GET', '/api/session/active')).data ?? {};
    return Array.isArray(active) ? active.some((s: any) => s?.id === sessionId || s === sessionId) : sessionId in active;
  }

  subscribe(onEvent: (event: AgentEvent) => void) {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }
}
