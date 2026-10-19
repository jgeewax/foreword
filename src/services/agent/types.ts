import type { AgentPermissions } from './permissions';
// Provider-neutral agent interface (SPEC §4). The UI depends only on this;
// OpenCodeAdapter is the first implementation.
import type { AuthorEdit } from './author-edits';
import type { SourceSelection } from '../../editor/selection';

/** What goes with a message besides its text: a selection, or the author's changes to the assistant's text. */
export type MessageContext = { selection: SourceSelection; stale: boolean } | { authorEdits: AuthorEdit[] };

export type ModelRef = { providerID: string; id: string };


export type ModelInfo = ModelRef & {
  name: string;
  providerName: string;
  supportsTools: boolean;
  /** Context window in tokens, when the provider reports it. */
  contextWindow?: number;
};

/**
 * How hard a model thinks before it answers: Claude Code's effort, Codex's
 * reasoning effort (ACP config options of category `thought_level`), or one
 * of an OpenCode model's variants.
 */
export type EffortOption = { value: string; name: string; description?: string };
/** A model's levels of effort, and the one in use (null: not known). */
export type Efforts = { options: EffortOption[]; current: string | null };

/** OpenCode's "no variant": the model as it comes. */
export const DEFAULT_EFFORT = 'default';

export type PermissionDecision = 'once' | 'always' | 'reject';

export type FilePatch = { file: string; patch: string };

/**
 * One of the assistant's questions (a field of a form): OpenCode's question
 * tool asks with one string or multiselect field per question; ACP agents'
 * forms and questions written in a reply come to the same shape (questions.ts).
 * `title` is its short header ("Tone"), `description` the question itself.
 */
export type FormField = {
  key: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external';
  title?: string;
  description?: string;
  required?: boolean;
  /** `preview`: something to look at for the option (Claude Code's mockups and snippets). */
  options?: { value: string; label: string; description?: string; preview?: string }[];
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
  /** The assistant asks (its question tool): answer with replyForm, or dismiss. */
  | { type: 'form-asked'; sessionId: string; form: FormRequest }
  /** `withdrawn`: the assistant stopped waiting (the turn was stopped, or it gave up). */
  | { type: 'form-settled'; sessionId: string; formId: string; outcome: 'answered' | 'cancelled' | 'withdrawn' }
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
  /** Whether its conversations have Typst Studio's own tools (its settings): given them, and its program takes them. */
  hasStudioTools(): boolean;
  stop(): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
  defaultModel(): Promise<ModelRef | null>;
  /** `effort`: one of the model's levels (efforts()), or null for its own. */
  createSession(
    model: ModelRef | null,
    opts?: { permissions?: AgentPermissions; readOnly?: boolean; agent?: 'build' | 'plan'; allowCommands?: string[]; effort?: string | null },
  ): Promise<string>;
  /**
   * The model's levels of effort, and the one in use: in the conversation, or
   * (no conversation yet) what a new one would start with. Null when the model
   * has none.
   */
  efforts(sessionId: string | null, model: ModelRef): Promise<Efforts | null>;
  /** Think with this effort from the next message on. */
  switchEffort(sessionId: string, model: ModelRef, effort: string): Promise<void>;
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
  send(sessionId: string, message: string, context: MessageContext[], delivery?: Delivery): Promise<string | null>;
  /** Conversations with a turn running now. */
  activeSessions(): Promise<Set<string>>;
  /** Permission requests waiting in a conversation (after a switch). */
  pendingPermissions(sessionId: string): Promise<{ requestId: string; action: string; resources: string[]; patches: FilePatch[] }[]>;
  /** Questions waiting for the author (after a reload or a switch of conversation). */
  pendingForms(sessionId: string): Promise<FormRequest[]>;
  replyForm(sessionId: string, formId: string, answer: FormAnswer): Promise<void>;
  cancelForm(sessionId: string, formId: string): Promise<void>;
  /** Carry on with a stopped (or failed) turn, with the model chosen now. */
  resume(sessionId: string): Promise<void>;
  /** A queued message: send it to the running turn now, or take it back. */
  steer(sessionId: string, inboxId: string): Promise<void>;
  unqueue(sessionId: string, inboxId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  replyPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>;
  isRunning(sessionId: string): Promise<boolean>;
  subscribe(onEvent: (event: AgentEvent) => void): () => void;
}
