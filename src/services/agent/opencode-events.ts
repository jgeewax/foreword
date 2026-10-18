// OpenCode 2.x `/api/event` payloads → AgentEvent. The OpenAPI schema leaves
// event data untyped, so these shapes come from recorded traffic (see
// __fixtures__/opencode-events.jsonl and docs/decisions.md).
import type { AgentEvent, FormField, FormRequest } from './types';

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'multiselect', 'external'] as const;

/** An OpenCode Form.Info, defensively (the event schema is untyped). Null if it isn't one. */
export function toFormRequest(raw: any): FormRequest | null {
  const f = raw?.form ?? raw;
  if (!f || typeof f.id !== 'string' || !Array.isArray(f.fields)) return null;
  const fields: FormField[] = f.fields
    .filter((x: any) => x && typeof x.key === 'string' && FIELD_TYPES.includes(x.type))
    .map((x: any) => ({
      key: x.key,
      type: x.type,
      title: typeof x.title === 'string' ? x.title : undefined,
      description: typeof x.description === 'string' ? x.description : undefined,
      required: x.required === true,
      options: Array.isArray(x.options) ? x.options.filter((o: any) => typeof o?.value === 'string').map((o: any) => ({ value: o.value, label: str(o.label, o.value), description: typeof o.description === 'string' ? o.description : undefined })) : undefined,
      custom: x.custom === true,
      placeholder: typeof x.placeholder === 'string' ? x.placeholder : undefined,
      url: typeof x.url === 'string' ? x.url : undefined,
    }));
  const metadata = f.metadata && typeof f.metadata === 'object' ? f.metadata : undefined;
  const callId = typeof metadata?.tool?.id === 'string' ? metadata.tool.id : undefined;
  // The question tool reports an answer for every question.
  if (metadata?.kind === 'question') for (const field of fields) field.required = true;
  return fields.length ? { id: f.id, title: str(f.title, 'Questions'), fields, metadata, callId } : null;
}

function toolOutput(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content
    .map((c: any) => (c?.type === 'text' ? str(c.text) : ''))
    .filter(Boolean)
    .join('\n');
}

export function mapOpenCodeEvent(raw: any): AgentEvent | null {
  if (raw?.$connection) return { type: 'connection', status: raw.$connection === 'open' ? 'open' : 'lost' };
  const type: string | undefined = raw?.type;
  const d = raw?.data ?? {};
  const sessionId = str(d.sessionID);
  if (!type) return null;

  switch (type) {
    case 'session.execution.started':
      return { type: 'turn-started', sessionId };
    case 'session.renamed':
      return { type: 'session-renamed', sessionId, title: str(d.title) };
    case 'session.step.started':
      return { type: 'step-started', sessionId };
    case 'form.created': {
      const form = toFormRequest(d);
      return form ? { type: 'form-asked', sessionId: str(d.sessionID ?? d.form?.sessionID), form } : null;
    }
    case 'form.replied':
    case 'form.cancelled':
      return {
        type: 'form-settled',
        sessionId: str(d.sessionID ?? d.form?.sessionID),
        formId: str(d.id ?? d.formID ?? d.form?.id),
        outcome: type === 'form.replied' ? 'answered' : 'cancelled',
      };
    case 'session.inbox.delivered':
      return { type: 'inbox-delivered', sessionId, inboxId: str(d.inboxID) };
    case 'session.step.ended':
      return { type: 'step-finished', sessionId, finish: str(d.finish) };
    case 'session.reasoning.delta':
      return { type: 'reasoning-delta', sessionId, messageId: str(d.assistantMessageID), ordinal: d.ordinal ?? 0, delta: str(d.delta) };
    case 'session.reasoning.ended':
      return { type: 'reasoning-ended', sessionId, messageId: str(d.assistantMessageID), ordinal: d.ordinal ?? 0, text: str(d.text) };
    case 'session.retry.scheduled':
      return {
        type: 'retry-scheduled',
        sessionId,
        attempt: typeof d.attempt === 'number' ? d.attempt : 1,
        at: typeof d.at === 'number' ? d.at : Date.now(),
        message: str(d.error?.message) || str(d.error?.type) || 'The model is busy',
      };
    case 'session.text.delta':
      return { type: 'text-delta', sessionId, messageId: str(d.assistantMessageID), ordinal: d.ordinal ?? 0, delta: str(d.delta) };
    case 'session.text.ended':
      return { type: 'text-ended', sessionId, messageId: str(d.assistantMessageID), ordinal: d.ordinal ?? 0, text: str(d.text) };
    case 'session.tool.input.started':
      return { type: 'tool-started', sessionId, callId: str(d.id), name: str(d.name, 'tool') };
    case 'session.tool.called':
      return { type: 'tool-called', sessionId, callId: str(d.id), input: d.input };
    case 'session.tool.success':
      return { type: 'tool-succeeded', sessionId, callId: str(d.id), output: toolOutput(d.content) };
    case 'session.tool.failed':
      return {
        type: 'tool-failed',
        sessionId,
        callId: str(d.id),
        error: str(d.error?.message) || str(d.error?.type) || 'tool failed',
      };
    case 'permission.asked':
      return {
        type: 'permission-asked',
        sessionId,
        requestId: str(d.id),
        action: str(d.action),
        resources: Array.isArray(d.resources) ? d.resources.map(String) : [],
        patches: Array.isArray(d.metadata?.files)
          ? d.metadata.files.map((f: any) => ({ file: str(f.file), patch: str(f.patch) }))
          : [],
      };
    case 'permission.replied':
      return { type: 'permission-replied', sessionId, requestId: str(d.requestID), reply: str(d.reply) };
    case 'session.usage.updated':
      return {
        type: 'usage',
        sessionId,
        inputTokens: d.tokens?.input ?? 0,
        outputTokens: d.tokens?.output ?? 0,
        cost: d.cost ?? 0,
      };
  }
  // Turn endings seen so far: session.execution.succeeded. Map any other
  // non-start execution event as an ending so a turn can't hang in "running".
  if (type.startsWith('session.execution.')) {
    const suffix = type.slice('session.execution.'.length);
    const outcome = suffix === 'succeeded' ? 'succeeded' : suffix.startsWith('interrupt') || suffix === 'cancelled' ? 'interrupted' : 'failed';
    return { type: 'turn-finished', sessionId, outcome, error: str(d.error?.message) || str(d.message) || undefined };
  }
  if (sessionId && /(^|\.)error$|\.failed$/.test(type)) {
    return { type: 'session-error', sessionId, message: str(d.error?.message) || str(d.message) || type };
  }
  return null;
}
