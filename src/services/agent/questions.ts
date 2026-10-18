// The assistant's questions, whichever way they come, as the chat's question
// panel shows them (a FormRequest), and the answers back the way they came:
// - OpenCode's question tool: a form (opencode-events.ts);
// - an ACP agent's form elicitation (`elicitation/create`): Claude Code's
//   AskUserQuestion and Codex's request_user_input, or any form an agent asks;
// - a ```questions block in a reply, from an agent with no question tool
//   (Gemini CLI and Antigravity, whose ACP modes leave theirs out): the
//   answers go back as the author's next message.
// Shapes checked against recorded traffic (__fixtures__/acp-questions.jsonl).
import type { FormAnswer, FormField, FormRequest } from './types';

type Value = FormAnswer[string];
type Option = NonNullable<FormField['options']>[number];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** "(Recommended)" after a label: the assistant's pick, shown as a badge. */
const RECOMMENDED = /\s*\(recommended\)\s*$/i;
export const isRecommended = (label: string) => RECOMMENDED.test(label);
export const withoutRecommended = (label: string) => label.replace(RECOMMENDED, '');

/** Kinds of question, as the panel shows them. */
export type QuestionKind = 'choice' | 'multi' | 'yesno' | 'text' | 'number' | 'link';

export function questionKind(f: FormField): QuestionKind {
  if (f.type === 'multiselect') return 'multi';
  if (f.type === 'boolean') return 'yesno';
  if (f.type === 'external') return 'link';
  if (f.type === 'number' || f.type === 'integer') return 'number';
  return f.options?.length ? 'choice' : 'text';
}

/** The question's own words; its short header when that's all there is. */
export const questionText = (f: FormField) => f.description ?? f.title ?? f.key;

/** An answer in words: "Yes", "Background, Examples". */
export function answerText(f: FormField, v: Value | undefined): string {
  if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const label = (x: string) => withoutRecommended(f.options?.find((o) => o.value === x)?.label ?? x);
  return Array.isArray(v) ? v.map(label).join(', ') : label(String(v));
}

export const isAnswered = (v: Value | undefined) => !(v === undefined || v === '' || (Array.isArray(v) && !v.length));

// ---- ACP form elicitations --------------------------------------------------------------

/**
 * How each of the panel's questions goes back into the agent's form: the field
 * for an answer of the author's own (Claude Code's `question_<n>_custom`,
 * Codex's `<id>_note`), and the option that says so (Codex's "None of the above").
 */
export type ElicitationWire = Record<string, { other?: string; none?: string }>;

/** A select's options: `oneOf` / `anyOf` (titled), or a bare `enum`. */
function schemaOptions(p: Record<string, any>): Option[] {
  const titled = p.oneOf ?? p.items?.anyOf;
  if (Array.isArray(titled)) {
    return titled
      .filter((o: any) => typeof o?.const === 'string')
      .map((o: any) => ({
        value: o.const,
        label: str(o.title) ?? o.const,
        description: str(o.description),
        preview: str(o._meta?.['_claude/askUserQuestionOption']?.preview),
      }));
  }
  const bare = p.enum ?? p.items?.enum;
  return Array.isArray(bare) ? bare.filter((v: unknown) => typeof v === 'string').map((v: string) => ({ value: v, label: v })) : [];
}

const NONE_OF_THE_ABOVE = /^(none of the above|other)$/i;

/**
 * A form elicitation as the panel's questions. Claude Code's AskUserQuestion
 * pairs each question (header as title, question as description; one
 * question's text is the message) with a `_custom` field for the author's own
 * answer. Codex's request_user_input has the question as title and the header
 * as description, a "None of the above" option and a `role: user_note` field.
 * Anything else, field by field. Null: nothing the panel can show (a URL).
 */
export function formFromElicitation(id: string, params: any): { form: FormRequest; wire: ElicitationWire } | null {
  if (!isRecord(params) || (params.mode !== undefined && params.mode !== 'form')) return null;
  const props: Record<string, any> = isRecord(params.requestedSchema?.properties) ? params.requestedSchema.properties : {};
  const required = new Set<string>(Array.isArray(params.requestedSchema?.required) ? params.requestedSchema.required : []);
  const message = str(params.message);
  // Each question's free-text companion.
  const companions = new Map<string, string>();
  for (const [key, p] of Object.entries(props)) {
    if (!isRecord(p) || p.type !== 'string' || p.oneOf || p.enum) continue;
    const of = str(p._meta?.codex?.role === 'user_note' ? p._meta.codex.questionId : undefined) ?? (key.endsWith('_custom') ? key.slice(0, -'_custom'.length) : undefined);
    if (of && of !== key && isRecord(props[of]) && !companions.has(of)) companions.set(of, key);
  }
  const companionKeys = new Set(companions.values());
  const keys = Object.keys(props).filter((k) => isRecord(props[k]) && !companionKeys.has(k));
  const wire: ElicitationWire = {};
  const fields: FormField[] = [];
  for (const key of keys) {
    const p = props[key];
    const type: FormField['type'] | null =
      p.type === 'array' ? 'multiselect' : p.type === 'boolean' ? 'boolean' : p.type === 'number' ? 'number' : p.type === 'integer' ? 'integer' : p.type === 'string' ? 'string' : null;
    if (!type) continue;
    let options = schemaOptions(p);
    const other = companions.get(key);
    const none = other ? options.find((o) => NONE_OF_THE_ABOVE.test(o.value)) : undefined;
    if (none) options = options.filter((o) => o !== none);
    // Codex: the question is the title, its header the description.
    let [header, text] = p._meta?.codex ? [str(p.description), str(p.title)] : [str(p.title), str(p.description)];
    if (!text && keys.length === 1 && message) text = message;
    if (!text) [header, text] = [undefined, header];
    wire[key] = { ...(other ? { other } : {}), ...(none ? { none: none.value } : {}) };
    fields.push({
      key,
      type,
      title: header,
      description: text,
      required: required.has(key),
      options: options.length ? options : undefined,
      custom: !!other,
      placeholder: str(p._meta?.placeholder),
    });
  }
  if (!fields.length) return null;
  const callId = str(params.toolCallId);
  return { form: { id, title: message ?? 'Questions', fields, ...(callId ? { callId } : {}) }, wire };
}

/** The author's answers as the form's content: their own words in the companion fields. */
export function elicitationContent(form: FormRequest, wire: ElicitationWire, answer: FormAnswer): Record<string, Value> {
  const content: Record<string, Value> = {};
  for (const f of form.fields) {
    const v = answer[f.key];
    if (!isAnswered(v)) continue;
    const w = wire[f.key] ?? {};
    const known = (x: string) => !f.options || f.options.some((o) => o.value === x);
    if (f.type === 'multiselect' && Array.isArray(v)) {
      const picks = v.filter(known);
      const own = v.filter((x) => !known(x));
      if (picks.length || !w.other) content[f.key] = w.other ? picks : v;
      if (own.length && w.other) content[w.other] = own.join(', ');
    } else if (typeof v === 'string' && !known(v) && w.other) {
      if (w.none) content[f.key] = w.none;
      content[w.other] = v;
    } else if (f.type === 'number' || f.type === 'integer') {
      const n = Number(v);
      if (Number.isFinite(n)) content[f.key] = f.type === 'integer' ? Math.round(n) : n;
    } else content[f.key] = v;
  }
  return content;
}

// ---- questions in a reply (agents without a question tool) ------------------------------

const BLOCK_OPEN = /(^|\n)[ \t]*```+[ \t]*questions[^\n]*\n/i;

/** Questions as the assistant writes them, in a block or a tool's input. */
export function fieldsFromQuestions(raw: unknown): FormField[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.questions) ? raw.questions : [];
  const fields: FormField[] = [];
  list.forEach((q: any, i: number) => {
    const text = str(q?.question) ?? str(q?.text);
    if (!text) return;
    const options: Option[] = (Array.isArray(q.options) ? q.options : [])
      .map((o: any) => (typeof o === 'string' ? { label: o } : o))
      .filter((o: any) => str(o?.label))
      .map((o: any) => ({ value: o.label, label: o.label, description: str(o.description), preview: str(o.preview) }));
    const yesno = /^(yesno|yes\/no|boolean|confirm)$/i.test(String(q.type ?? ''));
    const free = /^(text|free|open)$/i.test(String(q.type ?? '')) || (!yesno && !options.length);
    fields.push({
      key: `q${i}`,
      type: yesno ? 'boolean' : free ? 'string' : q.multiSelect === true || q.multiple === true ? 'multiselect' : 'string',
      title: str(q.header),
      description: text,
      required: false,
      options: yesno || free ? undefined : options,
      custom: !free,
      placeholder: str(q.placeholder),
    });
  });
  return fields;
}

/**
 * A reply's ```questions block, taken out of its text. `writing`: the block has
 * started but isn't finished (the reply is still coming), so it's hidden for
 * now. A block that isn't valid questions stays in the text, as written.
 */
export function splitQuestions(text: string): { text: string; fields: FormField[] | null; writing: boolean } {
  const open = BLOCK_OPEN.exec(text);
  if (!open) return { text, fields: null, writing: false };
  const start = open.index + open[1].length;
  const bodyStart = open.index + open[0].length;
  const close = /\n[ \t]*```+[ \t]*(\n|$)/.exec(text.slice(bodyStart - 1));
  if (!close) return { text: text.slice(0, start).trimEnd(), fields: null, writing: true };
  const body = text.slice(bodyStart, bodyStart - 1 + close.index);
  const after = text.slice(bodyStart - 1 + close.index + close[0].length);
  let fields: FormField[] = [];
  try {
    fields = fieldsFromQuestions(JSON.parse(body));
  } catch {}
  if (!fields.length) return { text, fields: null, writing: false };
  return { text: [text.slice(0, start).trimEnd(), after.trim()].filter(Boolean).join('\n\n'), fields, writing: false };
}

/** Answers to a reply's questions, as the author's message back: each question, then the answer. */
export function answersMessage(fields: FormField[], answer: FormAnswer): string {
  const lines = fields.map((f) => `- ${questionText(f)} ${answerText(f, answer[f.key]) || '(no answer)'}`);
  return `${fields.length > 1 ? 'My answers' : 'My answer'}:\n${lines.join('\n')}`;
}

// ---- asked with a tool, in a saved conversation -----------------------------------------

/**
 * Questions and their answers as a question tool call, for a conversation's
 * record when the agent doesn't report one (Codex's request_user_input):
 * the input `questionFromTool` reads, and a result in Claude Code's words.
 */
export function questionToolCall(form: FormRequest, answer: FormAnswer | null): { input: Record<string, unknown>; output: string } {
  const questions = form.fields.map((f) => ({
    question: questionText(f),
    header: f.title,
    multiSelect: f.type === 'multiselect',
    ...(f.type === 'boolean' ? { type: 'yesno' } : f.options ? { options: f.options.map((o) => ({ label: o.label, description: o.description })) } : { type: 'text' }),
  }));
  const said = form.fields.filter((f) => answer && isAnswered(answer[f.key])).map((f) => `${JSON.stringify(questionText(f))}=${JSON.stringify(answerText(f, answer![f.key]))}`);
  return { input: { questions }, output: said.length ? `Your questions have been answered: ${said.join(', ')}.` : 'The user did not answer the questions.' };
}

/** Answers in a question tool's result: OpenCode's and Claude Code's say `"Question"="Answer"`. */
function answersInOutput(output: string): Map<string, string> {
  const unq = (s: string) => s.replace(/\\(.)/g, '$1');
  return new Map([...output.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)].map((m) => [unq(m[1]), unq(m[2])]));
}

/**
 * A question tool call as the card it was (OpenCode's question tool, Claude
 * Code's AskUserQuestion): the questions from its input, the answers from its
 * result. Null if the input has no questions.
 */
export function questionFromTool(input: unknown, output: string): { fields: FormField[]; answer: FormAnswer; answered: boolean } | null {
  const fields = fieldsFromQuestions(input);
  if (!fields.length) return null;
  const said = answersInOutput(output);
  const answer: FormAnswer = {};
  for (const f of fields) {
    const a = said.get(questionText(f));
    if (a === undefined) continue;
    answer[f.key] = f.type === 'multiselect' ? a.split(/,\s+/).filter(Boolean) : a;
  }
  return { fields, answer, answered: Object.keys(answer).length > 0 };
}
