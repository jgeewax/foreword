// OpenCode 2.x adapter. Talks to the app-managed `opencode serve` through the
// Rust bridge (agent.rs). API shapes verified against the server's own
// /openapi.json (OpenCode 2.0.20); the npm SDK (1.x) targets the older API.
import { formatSelectionContext } from '../../editor/selection';
import { Channel, ipc } from '../../lib/ipc';
import { mapOpenCodeEvent } from './opencode-events';
import type { AgentAdapter, AgentEvent, ModelInfo, ModelRef, PermissionDecision } from './types';

/**
 * Session permission rules. OpenCode's built-in agents allow everything
 * (`* → allow`); the spec forbids that, so edits, shell, web and anything
 * unknown ask first. Rules are last-match-wins (verified: reads ran without a
 * prompt, an edit raised permission.asked). Subagents ("task") are denied
 * because they run under their agent's own allow-all rules.
 *
 * The preview compiles live, so Typst build commands are denied outright
 * (TODO: never compile). The shell tool's permission action is `shell` and its
 * resource is the full command line (verified: `typst compile …` is refused
 * with "Permission denied: shell", no prompt, no output written).
 */
export const NO_COMPILE_RULES = [
  { action: 'shell', resource: 'typst *', effect: 'deny' },
  { action: 'shell', resource: '*typst compile*', effect: 'deny' },
  { action: 'shell', resource: '*typst c *', effect: 'deny' },
  { action: 'shell', resource: '*typst watch*', effect: 'deny' },
  { action: 'shell', resource: '*typst w *', effect: 'deny' },
  { action: 'shell', resource: '*tinymist*', effect: 'deny' },
] as const;

/**
 * Auto-edit (setting "allow edits without asking"). The edit tool and the
 * write tool (new files) both use the `edit` action (verified); .env files
 * still ask.
 */
export const ALLOW_EDIT_RULES = [
  { action: 'edit', resource: '*', effect: 'allow' },
  { action: 'edit', resource: '*.env', effect: 'ask' },
  { action: 'edit', resource: '*.env.*', effect: 'ask' },
] as const;

export type PermissionRule = { action: string; resource: string; effect: 'allow' | 'ask' | 'deny' };

/** Rules for a session. Build-command denials always come last (last match wins). */
export function sessionPermissions({ allowEdits }: { allowEdits: boolean }): PermissionRule[] {
  const base = SESSION_PERMISSIONS.slice(0, SESSION_PERMISSIONS.length - NO_COMPILE_RULES.length);
  return [...base, ...(allowEdits ? ALLOW_EDIT_RULES : []), ...NO_COMPILE_RULES];
}

export const SESSION_PERMISSIONS = [
  { action: '*', resource: '*', effect: 'ask' },
  { action: 'read', resource: '*', effect: 'allow' },
  { action: 'glob', resource: '*', effect: 'allow' },
  { action: 'grep', resource: '*', effect: 'allow' },
  { action: 'list', resource: '*', effect: 'allow' },
  { action: 'read', resource: '*.env', effect: 'ask' },
  { action: 'read', resource: '*.env.*', effect: 'ask' },
  { action: 'external_directory', resource: '*', effect: 'ask' },
  { action: 'task', resource: '*', effect: 'deny' },
  ...NO_COMPILE_RULES,
] as const;

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

  async createSession(model: ModelRef | null, { allowEdits = false } = {}): Promise<string> {
    const res = await call('POST', '/api/session', {
      location: { directory: this.root },
      model: model ? { providerID: model.providerID, id: model.id } : null,
      permissions: sessionPermissions({ allowEdits }),
    });
    return res.data.id;
  }

  /** Switch a live session between asking before edits and editing freely (verified to apply mid-session). */
  async setEditPolicy(sessionId: string, allowEdits: boolean) {
    await call('PATCH', `/api/session/${sessionId}`, { permissions: sessionPermissions({ allowEdits }) });
  }

  // Experimental in OpenCode 2.0.20; entries appear as `api/<key>` in the system context (verified).
  async setInstructions(sessionId: string, key: string, text: string) {
    await call('PUT', `/api/experimental/session/${sessionId}/instructions/entries/${encodeURIComponent(key)}`, { value: text });
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
