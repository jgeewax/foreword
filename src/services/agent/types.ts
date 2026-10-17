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

export type AgentEvent =
  | { type: 'connection'; status: 'open' | 'lost' }
  | { type: 'session-renamed'; sessionId: string; title: string }
  | { type: 'turn-started'; sessionId: string }
  | { type: 'turn-finished'; sessionId: string; outcome: 'succeeded' | 'failed' | 'interrupted' | 'stopped'; error?: string }
  | { type: 'step-finished'; sessionId: string; finish: string }
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
  createSession(model: ModelRef | null): Promise<string>;
  /** Add (or replace) a named instruction block in the session's system context. */
  setInstructions(sessionId: string, key: string, text: string): Promise<void>;
  getInstructions(sessionId: string): Promise<{ key: string; value: unknown }[]>;
  switchModel(sessionId: string, model: ModelRef): Promise<void>;
  /** Resolves when the backend has accepted the message (not when the turn ends). */
  send(sessionId: string, message: string, context: { selection: SourceSelection; stale: boolean }[]): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  replyPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>;
  isRunning(sessionId: string): Promise<boolean>;
  subscribe(onEvent: (event: AgentEvent) => void): () => void;
}
