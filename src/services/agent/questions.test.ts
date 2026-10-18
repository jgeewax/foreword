import { describe, expect, it } from 'vitest';
import { itemsFromContext } from '../../app/tasks';
import { describeTool, NO_NAMES } from '../../app/tool-labels';
import recordedQuestions from './__fixtures__/acp-questions.jsonl?raw';
import recordedClaude from './__fixtures__/acp-claude.jsonl?raw';
import { AcpAdapter, type AcpTransport } from './acp';
import { appTool, Transcript, type AcpToolCall } from './acp-events';
import { buildInstructions } from './instructions';
import { answersMessage, answerText, elicitationContent, fieldsFromQuestions, formFromElicitation, questionFromTool, questionKind, splitQuestions } from './questions';
import type { AgentEvent, FormRequest } from './types';

// Recorded with the real programs (claude-agent-acp 0.93.0 on Haiku, codex-acp 2.2.2 with
// default_mode_request_user_input): Claude Code asking two questions (one choice, one with
// several) and then one (skipped), and Codex asking one with request_user_input.
const lines = (raw: string) =>
  raw
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
const recorded = lines(recordedQuestions);
const asks = recorded.filter((m) => m.method === 'elicitation/create');
const [claudeTwo, claudeOne, codexOne] = asks.map((m) => m.params);
const claudeUpdates = recorded.filter((m) => m.method === 'session/update').map((m) => m.params.update);

const form = (params: unknown) => formFromElicitation('f1', params)!;

describe('a form elicitation as the panel’s questions', () => {
  it('Claude Code’s AskUserQuestion: header, question, options; its Other box folded in', () => {
    const { form: f, wire } = form(claudeTwo);
    expect(f.callId).toBe('toolu_01FnXTJ8SNwYvuFs4vBPnP4n');
    expect(f.fields.map((x) => [x.key, x.type, x.title, x.description, x.custom, x.required])).toEqual([
      ['question_0', 'string', 'Tone', 'Which tone should the next chapter have?', true, false],
      ['question_1', 'multiselect', 'Topics', 'Which topics should the next chapter cover?', true, false],
    ]);
    expect(f.fields[0].options?.map((o) => o.label)).toEqual(['Conversational', 'Formal', 'Narrative']);
    expect(f.fields[0].options?.[0].description).toBe('Warm, direct, and personal, like explaining to a friend.');
    expect(questionKind(f.fields[0])).toBe('choice');
    expect(questionKind(f.fields[1])).toBe('multi');
    expect(wire).toEqual({ question_0: { other: 'question_0_custom' }, question_1: { other: 'question_1_custom' } });
  });

  it('one question: its words are the message', () => {
    const { form: f } = form(claudeOne);
    expect(f.fields).toHaveLength(1);
    expect(f.fields[0]).toMatchObject({ title: 'Next chapter', description: 'Should the next chapter be about eigenvalues or determinants?', custom: true });
  });

  it('Codex’s request_user_input: question and header the other way round, “None of the above” and its note as Other', () => {
    const { form: f, wire } = form(codexOne);
    expect(f.fields).toHaveLength(1);
    expect(f.fields[0]).toMatchObject({ key: 'next_chapter', type: 'string', title: 'Next chapter', description: 'Should the next chapter be about eigenvalues or determinants?', required: true, custom: true });
    expect(f.fields[0].options?.map((o) => o.value)).toEqual(['Eigenvalues', 'Determinants']);
    expect(wire.next_chapter).toEqual({ other: 'next_chapter_note', none: 'None of the above' });
  });

  it('answers go back the way the form takes them', () => {
    const two = form(claudeTwo);
    // As recorded: a pick and a tick.
    const reply = recorded.find((m) => m.result?.action === 'accept').result;
    expect(elicitationContent(two.form, two.wire, { question_0: 'Formal', question_1: ['Background'] })).toEqual(reply.content);
    // Your own words go in the Other boxes (with picks, for several).
    expect(elicitationContent(two.form, two.wire, { question_0: 'Like a letter', question_1: ['Examples', 'History of the idea'] })).toEqual({
      question_0_custom: 'Like a letter',
      question_1: ['Examples'],
      question_1_custom: 'History of the idea',
    });
    expect(elicitationContent(two.form, two.wire, { question_1: ['Only mine'] })).toEqual({ question_1_custom: 'Only mine' });
    // Codex: "None of the above", with your words as the note.
    const codex = form(codexOne);
    expect(elicitationContent(codex.form, codex.wire, { next_chapter: 'Determinants' })).toEqual({ next_chapter: 'Determinants' });
    expect(elicitationContent(codex.form, codex.wire, { next_chapter: 'Both, briefly' })).toEqual({ next_chapter: 'None of the above', next_chapter_note: 'Both, briefly' });
  });

  it('any other form, field by field; a link isn’t offered', () => {
    const { form: f, wire } = form({
      mode: 'form',
      sessionId: 's',
      message: 'Set up the export',
      requestedSchema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', title: 'Overwrite?', description: 'Replace main.pdf?' },
          copies: { type: 'integer', title: 'Copies' },
          paper: { type: 'string', enum: ['A4', 'Letter'] },
          note: { type: 'string', title: 'Note' },
        },
        required: ['copies'],
      },
    });
    expect(f.fields.map((x) => [x.key, questionKind(x), x.required])).toEqual([
      ['ok', 'yesno', false],
      ['copies', 'number', true],
      ['paper', 'choice', false],
      ['note', 'text', false],
    ]);
    expect(f.fields[1].description).toBe('Copies');
    expect(elicitationContent(f, wire, { ok: true, copies: '2' as never, paper: 'A4', note: ' ' })).toEqual({ ok: true, copies: 2, paper: 'A4', note: ' ' });
    expect(formFromElicitation('u', { mode: 'url', sessionId: 's', url: 'https://example.com', elicitationId: 'e' })).toBeNull();
    expect(formFromElicitation('e', { mode: 'form', sessionId: 's', message: 'Continue?', requestedSchema: { type: 'object', properties: {} } })).toBeNull();
  });
});

describe('questions written in a reply (assistants without a question tool)', () => {
  const block = '```questions\n{"questions": [{"header": "Tone", "question": "Which tone?", "options": [{"label": "Warm (Recommended)", "description": "Like chapter 1"}, {"label": "Formal"}]}, {"question": "Add exercises?", "type": "yesno"}, {"question": "Anything to avoid?", "type": "text", "placeholder": "Words, topics…"}, {"question": "Which extras?", "multiSelect": true, "options": ["Summary", "Glossary"]}]}\n```';

  it('the block becomes questions, and leaves the reply', () => {
    const { text, fields, writing } = splitQuestions(`Two things before I start.\n\n${block}\n`);
    expect(writing).toBe(false);
    expect(text).toBe('Two things before I start.');
    expect(fields!.map((f) => [f.key, questionKind(f), f.title, f.custom])).toEqual([
      ['q0', 'choice', 'Tone', true],
      ['q1', 'yesno', undefined, true],
      ['q2', 'text', undefined, false],
      ['q3', 'multi', undefined, true],
    ]);
    expect(fields![2].placeholder).toBe('Words, topics…');
    expect(fields![3].options?.map((o) => o.label)).toEqual(['Summary', 'Glossary']);
  });

  it('while it’s still being written, it’s hidden; a block that isn’t questions stays', () => {
    expect(splitQuestions('Hm.\n```questions\n{"questions": [{"quest')).toEqual({ text: 'Hm.', fields: null, writing: true });
    const bad = 'See:\n```questions\nnot json\n```';
    expect(splitQuestions(bad)).toEqual({ text: bad, fields: null, writing: false });
    expect(splitQuestions('No questions here.').fields).toBeNull();
    // Text after the block stays too.
    expect(splitQuestions(`Before.\n${block}\nAfter.`).text).toBe('Before.\n\nAfter.');
  });

  it('answers go back as a message: each question, then the answer', () => {
    const { fields } = splitQuestions(block);
    expect(answersMessage(fields!, { q0: 'Warm (Recommended)', q1: false, q3: ['Summary', 'An index'] })).toBe(
      'My answers:\n- Which tone? Warm\n- Add exercises? No\n- Anything to avoid? (no answer)\n- Which extras? Summary, An index',
    );
    expect(answersMessage(fields!.slice(1, 2), { q1: 'Only for chapter 2' })).toBe('My answer:\n- Add exercises? Only for chapter 2');
    expect(answerText(fields![0], 'Formal')).toBe('Formal');
  });
});

describe('a question tool call in a saved conversation', () => {
  const asked = claudeUpdates.find((u) => u.rawInput?.questions)!;
  const result = claudeUpdates.find((u) => u.status === 'completed' && /answered/.test(u.rawOutput))!;
  const skipped = claudeUpdates.find((u) => u.status === 'completed' && /did not answer/.test(u.rawOutput))!;

  it('Claude Code’s AskUserQuestion is the app’s question tool', () => {
    const call = { ...claudeUpdates[0], ...asked } as AcpToolCall;
    expect(appTool(call)).toEqual({ name: 'question', input: { questions: asked.rawInput.questions } });
    expect(describeTool('question', asked.rawInput, NO_NAMES, result.rawOutput)).toMatchObject({ done: 'Asked you a question', note: 'you said “Formal”, “Background”' });
  });

  it('the card again: questions from the input, answers from the result', () => {
    const q = questionFromTool(asked.rawInput, result.rawOutput)!;
    expect(q.answered).toBe(true);
    expect(q.fields.map((f) => [f.title, questionKind(f)])).toEqual([
      ['Tone', 'choice'],
      ['Topics', 'multi'],
    ]);
    expect(q.answer).toEqual({ q0: 'Formal', q1: ['Background'] });
    // OpenCode's result says it the same way; its input says `multiple`.
    const open = questionFromTool({ questions: [{ question: 'Extras?', header: 'Extras', multiple: true, options: [{ label: 'A' }, { label: 'B' }] }] }, 'User has answered your questions: "Extras?"="A, B". You can now continue.');
    expect(open?.answer).toEqual({ q0: ['A', 'B'] });
    expect(questionFromTool({ questions: [{ question: 'Q?', options: [{ label: 'x' }] }] }, skipped.rawOutput)?.answered).toBe(false);
    expect(questionFromTool({}, '')).toBeNull();
  });

  it('a saved conversation shows the cards, and a reply’s questions as still waiting until the author writes', () => {
    const t = new Transcript();
    t.user('u1', 'Plan the next chapter.');
    t.tool('a1', asked.toolCallId, 'question', asked.rawInput, 'completed', result.rawOutput);
    t.append('text', 'a1', 'Formal it is.');
    t.user('u2', 'And then?');
    t.append('text', 'a2', 'One more thing.\n```questions\n[{"question": "Exercises?", "type": "yesno"}]\n```');
    let items = itemsFromContext(t.messages as never);
    expect(items.map((i) => i.kind)).toEqual(['user', 'question', 'assistant', 'user', 'assistant', 'question']);
    expect(items[1]).toMatchObject({ kind: 'question', id: asked.toolCallId, state: 'answered', answer: { q0: 'Formal', q1: ['Background'] } });
    expect(items[5]).toMatchObject({ kind: 'question', state: 'pending', via: 'message' });
    t.user('u3', 'My answer:\n- Exercises? Yes');
    items = itemsFromContext(t.messages as never);
    expect(items[5]).toMatchObject({ kind: 'question', state: 'answered', via: 'message' });
    // A question tool still running is its row (the panel comes from the agent).
    const live = new Transcript();
    live.tool('a1', 'call_9', 'question', asked.rawInput, 'running');
    expect(itemsFromContext(live.messages as never).map((i) => i.kind)).toEqual(['tool']);
  });
});

/** The adapter with Claude Code's recorded start, and the questions as recorded. */
function harness() {
  const start = lines(recordedClaude);
  const sent: any[] = [];
  let deliver: (m: any) => void = () => {};
  const transport: AcpTransport = {
    start: async (_kind, onMessage) => {
      deliver = onMessage;
    },
    send: async (line) => {
      const m = JSON.parse(line);
      sent.push(m);
      if (m.method === 'initialize' || m.method === 'session/new') queueMicrotask(() => deliver(start.find((r) => r.id === m.id && r.result)));
    },
    stop: async () => {},
  };
  const adapter = new AcpAdapter('/Users/ada/Books/Linear Algebra', 'claude', transport);
  const events: AgentEvent[] = [];
  adapter.subscribe((e) => events.push(e));
  return { adapter, sent, events, deliver: (m: any) => deliver(m) };
}

describe('AcpAdapter: questions for the author', () => {
  const ask = (sessionId: string, params: object, id: number) => ({ jsonrpc: '2.0', id, method: 'elicitation/create', params: { ...params, sessionId } });
  const asked = (events: AgentEvent[]) => (events.filter((e) => e.type === 'form-asked').at(-1) as Extract<AgentEvent, { type: 'form-asked' }>).form as FormRequest;

  it('says it can show forms, asks, and answers, skips or withdraws', async () => {
    const { adapter, sent, events, deliver } = harness();
    await adapter.start();
    expect(sent[0].params.clientCapabilities.elicitation).toEqual({ form: {} });
    const sessionId = await adapter.createSession(null);
    await adapter.send(sessionId, 'Ask me.', []);

    // Answered: the agent gets the form's content. (Claude Code reports its tool call first.)
    deliver({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: claudeUpdates[0] } });
    deliver(ask(sessionId, claudeTwo, 70));
    const first = asked(events);
    expect(first.fields).toHaveLength(2);
    expect((await adapter.pendingForms(sessionId)).map((f) => f.id)).toEqual([first.id]);
    await adapter.replyForm(sessionId, first.id, { question_0: 'Formal', question_1: ['Background', 'Mine'] });
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 70, result: { action: 'accept', content: { question_0: 'Formal', question_1: ['Background'], question_1_custom: 'Mine' } } });
    expect(events.at(-1)).toEqual({ type: 'form-settled', sessionId, formId: first.id, outcome: 'answered' });
    expect(await adapter.pendingForms(sessionId)).toEqual([]);
    await expect(adapter.replyForm(sessionId, first.id, {})).rejects.toThrow(/no longer waiting/);

    // Skipped: declined, so it hears you didn't answer and carries on.
    deliver(ask(sessionId, claudeOne, 71));
    await adapter.cancelForm(sessionId, asked(events).id);
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 71, result: { action: 'decline' } });
    expect(events.at(-1)).toMatchObject({ type: 'form-settled', outcome: 'cancelled' });

    // Withdrawn by the agent ($/cancel_request), or by Stop (answered as cancelled).
    deliver(ask(sessionId, codexOne, 72));
    const third = asked(events);
    deliver({ jsonrpc: '2.0', method: '$/cancel_request', params: { requestId: 72 } });
    expect(events.at(-1)).toEqual({ type: 'form-settled', sessionId, formId: third.id, outcome: 'withdrawn' });
    deliver(ask(sessionId, codexOne, 73));
    await adapter.cancel(sessionId);
    expect(sent.slice(-2).map((m) => m.result ?? m.method)).toEqual([{ action: 'cancel' }, 'session/cancel']);
    expect(events.at(-1)).toMatchObject({ type: 'form-settled', outcome: 'withdrawn' });

    // Codex reports no tool call for its question: the conversation's record gets one, so the card is
    // there after switching away and back. (Claude Code's AskUserQuestion call is its own record: the
    // first one, reported as it was recorded, isn't added again.)
    deliver(ask(sessionId, codexOne, 76));
    await adapter.replyForm(sessionId, asked(events).id, { next_chapter: 'Both, briefly' });
    const cards = itemsFromContext((await adapter.sessionContext(sessionId)) as never).filter((i) => i.kind === 'question');
    expect(cards.map((c) => (c.kind === 'question' ? [c.fields[0].title, c.state, c.answer] : null))).toEqual([
      ['Next chapter', 'dismissed', {}],
      ['Next chapter', 'answered', { q0: 'Both, briefly' }],
    ]);

    // What the panel can't show, or a conversation it doesn't know, is declined at once.
    deliver(ask(sessionId, { mode: 'url', url: 'https://example.com', elicitationId: 'x' }, 74));
    deliver(ask('nobody', claudeOne, 75));
    expect(sent.slice(-2)).toEqual([
      { jsonrpc: '2.0', id: 74, result: { action: 'decline' } },
      { jsonrpc: '2.0', id: 75, result: { action: 'decline' } },
    ]);
  });
});

describe('the instructions say how to ask', () => {
  const ctx = { projectName: 'Book', entry: 'main.typ', typFiles: ['main.typ'] };

  it('with the assistant’s own question tool, three options, the recommendation first, no Other', () => {
    const claude = buildInstructions({ ...ctx, assistant: 'claude' });
    expect(claude).toContain('ask with your AskUserQuestion tool, never as questions in your reply');
    expect(claude).toMatch(/three options \(two to four when three don't fit\)/);
    expect(claude).toContain('"(Recommended)"');
    expect(claude).toContain('`multiSelect: true`');
    expect(claude).toMatch(/Don't add an "Other" or "None of the above" option/);
    expect(claude).toMatch(/up to four questions, in the order/);
    expect(buildInstructions({ ...ctx, assistant: 'opencode' })).toContain('your question tool');
    // Codex's takes one answer: several go in the author's own words.
    const codex = buildInstructions({ ...ctx, assistant: 'codex' });
    expect(codex).toContain('request_user_input');
    expect(codex).toMatch(/the author can name several in their own answer/);
  });

  it('without one (Gemini CLI, Antigravity): a questions block the panel shows, with the answers as the next message', () => {
    const gemini = buildInstructions({ ...ctx, assistant: 'gemini' });
    expect(gemini).toContain('ask with a questions block');
    const example = /```questions\n([\s\S]*?)\n```/.exec(gemini)![1];
    // The example in the instructions is one the panel reads.
    expect(fieldsFromQuestions(JSON.parse(example)).map((f) => f.title)).toEqual(['Tone']);
    expect(gemini).toMatch(/"type": "yesno"/);
    expect(buildInstructions({ ...ctx, assistant: 'antigravity' })).toContain('questions block');
  });
});
