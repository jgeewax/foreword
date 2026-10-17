// OpenCode 2.x adapter. Talks to the app-managed `opencode serve` through the
// Rust bridge (agent.rs). API shapes verified against the server's own
// /openapi.json (OpenCode 2.0.20); the npm SDK (1.x) targets the older API.
import { formatSelectionContext } from '../../editor/selection';
import { Channel, ipc } from '../../lib/ipc';
import { mapOpenCodeEvent } from './opencode-events';
import { DEFAULT_PERMISSIONS, sessionRules, type AgentPermissions } from './permissions';
import type { AgentAdapter, AgentEvent, ModelInfo, ModelRef, PermissionDecision } from './types';

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

export class OpenCodeAdapter implements AgentAdapter {
  private listeners = new Set<(e: AgentEvent) => void>();

  constructor(private readonly root: string) {}

  async start() {
    await ipc.agentStart();
    const channel = new Channel<any>();
    channel.onmessage = (raw) => {
      const event = mapOpenCodeEvent(raw);
      if (event) for (const l of this.listeners) l(event);
    };
    await ipc.agentSubscribe(channel);
  }

  async stop() {
    await ipc.agentStop();
  }

  async listModels(): Promise<ModelInfo[]> {
    const [models, providers] = await Promise.all([call('GET', '/api/model'), call('GET', '/api/provider')]);
    const providerNames = new Map<string, string>((providers.data ?? []).map((p: any) => [p.id, p.name ?? p.id]));
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
    { permissions = DEFAULT_PERMISSIONS as AgentPermissions, readOnly = false, agent = 'build' as 'build' | 'plan' } = {},
  ): Promise<string> {
    const res = await call('POST', '/api/session', {
      location: { directory: this.root },
      model: model ? { providerID: model.providerID, id: model.id } : null,
      agent: agent === 'build' ? null : agent,
      permissions: sessionRules(permissions, readOnly),
    });
    return res.data.id;
  }

  /** Update a live session's rules (verified to apply mid-session). */
  async setPermissions(sessionId: string, permissions: AgentPermissions, readOnly = false) {
    await call('PATCH', `/api/session/${sessionId}`, { permissions: sessionRules(permissions, readOnly) });
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
    await call('POST', `/api/session/${sessionId}/model`, { model: { providerID: model.providerID, id: model.id } });
  }

  async send(sessionId: string, message: string, context: Parameters<AgentAdapter['send']>[2]) {
    const text = [message, ...context.map((c) => formatSelectionContext(c.selection, c.stale))].join('\n\n');
    await call('POST', `/api/session/${sessionId}/prompt`, { text });
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
    await call('POST', `/api/session/${sessionId}/permission/${requestId}/reply`, { decision });
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
