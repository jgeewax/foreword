// The Agent Client Protocol (ACP), as far as the app needs it: what its
// messages look like, and how they become the app's own events, words and
// permission checks. Shapes checked against recorded traffic with Claude
// Code's ACP program (__fixtures__/acp-claude.jsonl).
import { diff, splitLines } from '../../lib/diff';
import { ruleEffect, withoutHarmlessRedirects, type Level, type PermissionRule } from './permissions';
import type { FilePatch } from './types';

export type AcpToolContent =
  | { type: 'content'; content: { type: string; text?: string } }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'terminal'; terminalId: string };

/** A tool call (`tool_call`), or what changed in one (`tool_call_update`). */
export type AcpToolCall = {
  toolCallId: string;
  title?: string | null;
  name?: string | null;
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: AcpToolContent[] | null;
  locations?: { path: string; line?: number | null }[] | null;
  _meta?: Record<string, any> | null;
};

export type AcpConfigOption = {
  id: string;
  name: string;
  category?: string | null;
  type?: string;
  currentValue?: string | boolean;
  options?: ({ value: string; name: string; description?: string | null } | { group: string; name: string; options: { value: string; name: string }[] })[];
};

/** A select option's values, groups flattened. */
export function optionValues(option: AcpConfigOption): { value: string; name: string; description?: string | null }[] {
  return (option.options ?? []).flatMap((o) => ('group' in o ? o.options : [o]));
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/**
 * A tool call as one of the app's own tools (OpenCode's names and inputs),
 * which the chat describes in words: Claude Code's tools by name, Gemini CLI's
 * by theirs, and anything else by its ACP kind and locations.
 */
export function appTool(call: AcpToolCall): { name: string; input: Record<string, unknown> } {
  const raw = (call.rawInput && typeof call.rawInput === 'object' ? call.rawInput : {}) as Record<string, unknown>;
  const tool = str(call._meta?.claudeCode?.toolName) ?? call.name ?? '';
  const where = call.locations?.[0]?.path;
  const file = str(raw.file_path) ?? str(raw.absolute_path) ?? str(raw.filePath) ?? str(raw.path) ?? where;
  const command = Array.isArray(raw.command) ? raw.command.map(String).join(' ') : str(raw.command);
  switch (tool) {
    case 'Read':
    case 'read_file':
      return { name: 'read', input: { filePath: file, offset: raw.offset, limit: raw.limit } };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'replace':
      return { name: 'edit', input: { filePath: file, oldString: raw.old_string, newString: raw.new_string } };
    case 'Write':
    case 'write_file':
      return { name: 'write', input: { filePath: file, content: raw.content } };
    case 'Glob':
    case 'glob':
      return { name: 'glob', input: { pattern: raw.pattern, path: raw.path } };
    case 'Grep':
    case 'grep':
    case 'search_file_content':
      return { name: 'grep', input: { pattern: raw.pattern, path: raw.path } };
    case 'LS':
    case 'list_directory':
      return { name: 'list', input: { path: raw.path ?? raw.dir_path } };
    case 'Bash':
    case 'run_shell_command':
      return { name: 'bash', input: { command, description: raw.description } };
    case 'WebFetch':
    case 'web_fetch':
      return { name: 'webfetch', input: { url: raw.url ?? raw.prompt } };
    case 'WebSearch':
    case 'google_web_search':
      return { name: 'websearch', input: { query: raw.query } };
    case 'TodoWrite':
    case 'write_todos':
      return { name: 'todowrite', input: raw };
  }
  switch (call.kind) {
    case 'read':
      return { name: 'read', input: { filePath: file } };
    case 'edit':
    case 'delete':
    case 'move':
      return { name: 'edit', input: { filePath: file } };
    case 'execute':
      return { name: 'bash', input: { command: command ?? call.title ?? '' } };
    case 'search':
      return { name: 'grep', input: { pattern: raw.pattern ?? raw.query ?? call.title } };
    case 'fetch':
      return { name: 'webfetch', input: { url: raw.url ?? call.title } };
  }
  return { name: (tool || call.title || 'tool').toLowerCase(), input: raw };
}

/** A tool's result as text; a read's lines numbered "12: text", as the app reads them. */
export function toolOutput(call: AcpToolCall, name: string): string {
  const text =
    typeof call.rawOutput === 'string'
      ? call.rawOutput
      : (call.content ?? [])
          .map((c) => (c.type === 'content' ? (c.content.text ?? '') : ''))
          .filter(Boolean)
          .join('\n');
  // Claude Code numbers a read's lines like cat -n: "    12\ttext".
  return name === 'read' ? text.replace(/^ *(\d+)\t/gm, '$1: ') : text;
}

/** A diff as a patch for the permission card: changed lines with two lines around them. */
export function unifiedPatch(path: string, before: string, after: string): string {
  const a = splitLines(before);
  const b = splitLines(after);
  const out = [`--- ${path}`, `+++ ${path}`];
  const runs = diff(a, b);
  runs.forEach((r, i) => {
    if (r.type === 'equal') {
      const lines = a.slice(r.a, r.a + r.n);
      const head = i > 0 ? lines.slice(0, 2) : [];
      const tail = i < runs.length - 1 ? lines.slice(-2) : [];
      if (lines.length > head.length + tail.length) out.push(...head.map((l) => ` ${l}`), '@@', ...tail.map((l) => ` ${l}`));
      else out.push(...lines.map((l) => ` ${l}`));
    } else if (r.type === 'delete') out.push(...a.slice(r.a, r.a + r.n).map((l) => `-${l}`));
    else out.push(...b.slice(r.b, r.b + r.n).map((l) => `+${l}`));
  });
  return out.join('\n');
}

/** A path in the book as relative to it; outside it, as it is (with `outside` set). */
function inBook(root: string, path: string | undefined): { path: string; outside: boolean } {
  if (!path) return { path: '*', outside: false };
  if (path === root || path.startsWith(`${root}/`)) return { path: path.slice(root.length + 1) || '.', outside: false };
  return { path, outside: path.startsWith('/') };
}

/**
 * What a permission request is about, in the app's terms: the action and
 * resources its rules and cards use (OpenCode's), and the edit as patches.
 */
export function permissionAsk(call: AcpToolCall, root: string): { action: string; resources: string[]; patches: FilePatch[] } {
  const { name, input } = appTool(call);
  const patches = (call.content ?? [])
    .filter((c): c is Extract<AcpToolContent, { type: 'diff' }> => c.type === 'diff')
    .map((c) => {
      const file = inBook(root, c.path).path;
      return { file, patch: unifiedPatch(file, c.oldText ?? '', c.newText) };
    });
  const file = inBook(root, str(input.filePath) ?? str(input.path));
  switch (name) {
    case 'edit':
    case 'write':
      return { action: file.outside ? 'external_directory' : 'edit', resources: [file.path], patches };
    case 'read':
    case 'glob':
    case 'grep':
    case 'list':
      return { action: file.outside ? 'external_directory' : name, resources: [file.path], patches };
    case 'bash':
      return { action: 'shell', resources: [String(input.command ?? '')], patches };
    case 'webfetch':
      return { action: 'webfetch', resources: [String(input.url ?? '*')], patches };
    case 'websearch':
      return { action: 'websearch', resources: [String(input.query ?? '*')], patches };
  }
  return { action: name, resources: ['*'], patches };
}

/**
 * What the app's permission rules say about a request (OpenCode applies them
 * itself; an ACP agent asks the app). A command line is checked whole and
 * command by command: any part denied denies it, and it runs without asking
 * only when every part may.
 */
export function decide(action: string, resources: readonly string[], rules: readonly PermissionRule[]): Level {
  const effects = resources.flatMap((r) => {
    if (action !== 'shell') return [ruleEffect(action, r, rules) ?? 'ask'];
    const line = withoutHarmlessRedirects(r);
    if (/\$\(|`/.test(line)) return [ruleEffect('shell', line, rules) === 'deny' ? 'deny' : 'ask'];
    const parts = line.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
    return [ruleEffect('shell', line, rules) ?? 'ask', ...parts.map((p) => ruleEffect('shell', p, rules) ?? 'ask')];
  });
  if (effects.includes('deny')) return 'deny';
  return effects.length && effects.every((e) => e === 'allow') ? 'allow' : 'ask';
}

/** A saved conversation as the app rebuilds it (the shape of OpenCode's context). */
export type ContextMessage = {
  id: string;
  type: 'user' | 'assistant';
  text?: string;
  content?: { type: string; text?: string; name?: string; id?: string; state?: { status?: string; input?: Record<string, unknown>; content?: { text?: string }[]; error?: string } }[];
  tokens?: { input?: number };
};

/**
 * One conversation's messages, kept from what the agent sends (live, or
 * replayed by session/load): the author's messages, and each turn's reply as
 * one message of text, thinking and tool parts in order. Its ids are the ones
 * the live events use (`<message>:<n>` for text, `<message>:r<n>` for thinking).
 */
export class Transcript {
  readonly messages: ContextMessage[] = [];
  private reply: ContextMessage | null = null;
  private part: 'text' | 'reasoning' | null = null;
  private texts = 0;
  private thoughts = 0;

  /** The author's message; the next reply starts a new message. */
  user(id: string, text: string) {
    const last = this.messages[this.messages.length - 1];
    // A replayed message can arrive in chunks.
    if (last?.type === 'user' && last.id === id) last.text += text;
    else this.messages.push({ id, type: 'user', text });
    this.reply = null;
  }

  /** A replayed message of the author's, which can arrive in chunks: they join the message they continue. */
  userChunk(id: string, text: string) {
    const last = this.messages[this.messages.length - 1];
    if (last?.type === 'user' && !this.reply) last.text += text;
    else this.user(id, text);
  }

  /** The author's message is the last thing so far (no reply to it yet). */
  inUserMessage(): boolean {
    return this.messages[this.messages.length - 1]?.type === 'user' && !this.reply;
  }

  /** The reply's message id (starting one with `id` if there's none yet). */
  replyId(id: string): string {
    if (!this.reply) {
      this.reply = { id, type: 'assistant', content: [] };
      this.messages.push(this.reply);
      this.part = null;
      this.texts = 0;
      this.thoughts = 0;
    }
    return this.reply.id;
  }

  /** Append to the reply's text or thinking; returns the item id and whether it's a new part. */
  append(kind: 'text' | 'reasoning', id: string, delta: string): { itemId: string; fresh: boolean } {
    const messageId = this.replyId(id);
    const content = this.reply!.content!;
    const fresh = this.part !== kind;
    if (fresh) {
      content.push({ type: kind, text: '' });
      if (kind === 'text') this.texts++;
      else this.thoughts++;
      this.part = kind;
    }
    content[content.length - 1].text += delta;
    return { itemId: kind === 'text' ? `${messageId}:${this.texts - 1}` : `${messageId}:r${this.thoughts - 1}`, fresh };
  }

  /** The text or thinking part being written, if any (it ends when anything else starts). */
  current(): { kind: 'text' | 'reasoning'; itemId: string; text: string } | null {
    if (!this.reply || !this.part) return null;
    const last = this.reply.content![this.reply.content!.length - 1];
    const itemId = this.part === 'text' ? `${this.reply.id}:${this.texts - 1}` : `${this.reply.id}:r${this.thoughts - 1}`;
    return { kind: this.part, itemId, text: last.text ?? '' };
  }

  /** Add or update a tool part. */
  tool(id: string, callId: string, name: string, input: Record<string, unknown>, status: string, output?: string) {
    this.replyId(id);
    this.part = null;
    const content = this.reply!.content!;
    const at = content.find((p) => p.type === 'tool' && p.id === callId);
    const state = { status, input, content: output == null ? undefined : [{ text: output }], error: status === 'failed' ? output : undefined };
    if (at) at.state = { ...at.state, ...state, content: state.content ?? at.state?.content };
    else content.push({ type: 'tool', id: callId, name, state });
  }

  /** How much of the context window the conversation fills (from usage_update). */
  setTokens(id: string, used: number) {
    this.replyId(id);
    this.reply!.tokens = { input: used };
  }

  /** The reply is over: the next text starts a new part, in a new message after the author's next one. */
  endTurn() {
    this.part = null;
  }
}
