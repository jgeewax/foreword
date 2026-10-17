import type { AgentPermissions } from './permissions';
// Provider-neutral agent interface (SPEC §4). The UI depends only on this;
// OpenCodeAdapter is the first implementation.
import type { SourceSelection } from '../../editor/selection';

export type ModelRef = { providerID: string; id: string };

export type ModelInfo = ModelRef & {
  name: string;
  providerName: string;
  supportsTools: boolean;
  /** Context window in tokens, when the provider reports it. */
  contextWindow?: number;
};

export type PermissionDecision = 'once' | 'always' | 'reject';

export type FilePatch = { file: string; patch: string };

/** A field of an OpenCode form (the question tool asks with one string or multiselect field per question). */
export type FormField = {
  key: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external';
  title?: string;
  description?: string;
  required?: boolean;
  options?: { value: string; label: string; description?: string }[];
  /** Free text allowed besides the options. */
  custom?: boolean;
  placeholder?: string;
  url?: string;
};
export type FormRequest = {
  id: string;
  title: string;
  fields: FormField[];
  metadata?: Record<string, unknown>;
  /** For the question tool: the tool call that asked. */
  callId?: string;
};
export type FormAnswer = Record<string, string | number | boolean | string[]>;

/** How a message sent during a turn reaches it (OpenCode's inbox). */
export type Delivery = 'queue' | 'steer';

export type AgentEvent =
  | { type: 'connection'; status: 'open' | 'lost' }
  | { type: 'session-renamed'; sessionId: string; title: string }
  | { type: 'turn-started'; sessionId: string }
  | { type: 'turn-finished'; sessionId: string; outcome: 'succeeded' | 'failed' | 'interrupted' | 'stopped'; error?: string }
  | { type: 'step-started'; sessionId: string }
  /** The assistant asks (the question tool): answer with replyForm, or dismiss. */
  | { type: 'form-asked'; sessionId: string; form: FormRequest }
  | { type: 'form-settled'; sessionId: string; formId: string; outcome: 'answered' | 'cancelled' }
  /** A message (ours, queued or not) reached the conversation. */
  | { type: 'inbox-delivered'; sessionId: string; inboxId: string }
  | { type: 'step-finished'; sessionId: string; finish: string }
  | { type: 'reasoning-delta'; sessionId: string; messageId: string; ordinal: number; delta: string }
  | { type: 'reasoning-ended'; sessionId: string; messageId: string; ordinal: number; text: string }
  /** The provider failed (busy, rate limit): OpenCode tries again at `at` (ms since 1970). */
  | { type: 'retry-scheduled'; sessionId: string; attempt: number; at: number; message: string }
  | { type: 'text-delta'; sessionId: string; messageId: string; ordinal: number; delta: string }
  | { type: 'text-ended'; sessionId: string; messageId: string; ordinal: number; text: string }
  | { type: 'tool-started'; sessionId: string; callId: string; name: string }
  | { type: 'tool-called'; sessionId: string; callId: string; input: unknown }
  | { type: 'tool-succeeded'; sessionId: string; callId: string; output: string }
  | { type: 'tool-failed'; sessionId: string; callId: string; error: string }
  | {
      type: 'permission-asked';
      sessionId: string;
      requestId: string;
      action: string;
      resources: string[];
      patches: FilePatch[];
    }
  | { type: 'permission-replied'; sessionId: string; requestId: string; reply: string }
  | { type: 'usage'; sessionId: string; inputTokens: number; outputTokens: number; cost: number }
  | { type: 'session-error'; sessionId: string; message: string };

export interface AgentAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
  defaultModel(): Promise<ModelRef | null>;
  createSession(model: ModelRef | null, opts?: { permissions?: AgentPermissions; readOnly?: boolean; agent?: 'build' | 'plan'; allowCommands?: string[] }): Promise<string>;
  /**
   * What the agent may do (`readOnly` forces no changes: Plan and Options; `allowCommands`
   * run without asking); applies to a running session.
   */
  setPermissions(sessionId: string, permissions: AgentPermissions, readOnly?: boolean, allowCommands?: string[]): Promise<void>;
  switchAgent(sessionId: string, agent: 'build' | 'plan'): Promise<void>;
  /** Add (or replace) a named instruction block in the session's system context. */
  setInstructions(sessionId: string, key: string, text: string): Promise<void>;
  getInstructions(sessionId: string): Promise<{ key: string; value: unknown }[]>;
  removeInstructions(sessionId: string, key: string): Promise<void>;
  switchModel(sessionId: string, model: ModelRef): Promise<void>;
  /** This book's conversations, newest first. */
  listSessions(limit?: number): Promise<{ id: string; title: string; updated: number; tokens: number | null }[]>;
  /** A conversation's messages (user text, assistant text and tool parts). */
  sessionContext(sessionId: string): Promise<any[]>;
  /** Summarize the conversation so far to free up the context window. */
  compact(sessionId: string): Promise<void>;
  /** Resolves when the backend has accepted the message (not when the turn ends). */
  /**
   * Send a message. While a turn runs, `queue` delivers it when the turn ends and
   * `steer` hands it to the running turn at its next step. Returns its inbox id.
   */
  send(sessionId: string, message: string, context: { selection: SourceSelection; stale: boolean }[], delivery?: Delivery): Promise<string | null>;
  /** Questions waiting for the author (after a reload or a switch of conversation). */
  pendingForms(sessionId: string): Promise<FormRequest[]>;
  replyForm(sessionId: string, formId: string, answer: FormAnswer): Promise<void>;
  cancelForm(sessionId: string, formId: string): Promise<void>;
  /** A queued message: send it to the running turn now, or take it back. */
  steer(sessionId: string, inboxId: string): Promise<void>;
  unqueue(sessionId: string, inboxId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  replyPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>;
  isRunning(sessionId: string): Promise<boolean>;
  subscribe(onEvent: (event: AgentEvent) => void): () => void;
}
