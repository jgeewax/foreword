import { describe, expect, it } from 'vitest';
import { formatAuthorEdits } from '../services/agent/author-edits';
import { ASK_REMINDER } from '../services/agent/ask-mode';
import { messageText } from '../services/agent/message-context';
import type { ChatItem } from './studio';
import { asksTaskDone, contextTokens, itemsFromContext, keptItems, mergeTasks, readKeptChat, readsFromContext, readTaskRecords, splitUserText, TASK_INSTRUCTIONS, TASK_MARKER, withLatestTurn, withoutMarker, type TaskRecord } from './tasks';

describe('the task-done marker', () => {
  it('is recognised at the end of a reply, even bolded, and hidden for display', () => {
    expect(asksTaskDone(`Changed the heading.\n\n${TASK_MARKER}`)).toBe(true);
    expect(asksTaskDone('Changed the heading.\n**TASK COMPLETE?**\n')).toBe(true);
    expect(asksTaskDone('Is the TASK COMPLETE? Not yet.')).toBe(false);
    expect(withoutMarker(`Changed the heading.\n\n${TASK_MARKER}\n`)).toBe('Changed the heading.');
    expect(asksTaskDone(`Done.\n\n${TASK_MARKER}\nADDRESSED: c1`)).toBe(true);
  });

  it('is explained in the instructions', () => {
    expect(TASK_INSTRUCTIONS).toContain(`end your reply with this exact line on its own:\n${TASK_MARKER}`);
    expect(TASK_INSTRUCTIONS).toMatch(/restate the goal in one sentence/);
  });
});

describe('restoring a conversation', () => {
  const context = [
    {
      id: 'msg_u1',
      type: 'user',
      text: 'Fix the TODO.\n\nSelected in the editor: chapters/ch1.typ lines 6:1–6:82\n<selection path="chapters/ch1.typ" start="6:1" end="6:82">\n// TODO: x\n</selection>',
    },
    {
      id: 'msg_a1',
      type: 'assistant',
      tokens: { input: 8922 },
      content: [{ type: 'tool', id: 'call_1', name: 'read', state: { status: 'completed', input: { path: 'chapters/ch1.typ' }, content: [{ text: '1: = Vectors' }] } }],
    },
    {
      id: 'msg_a2',
      type: 'assistant',
      tokens: { input: 1500, cache: { read: 8000 } },
      content: [
        { type: 'tool', id: 'call_2', name: 'edit', state: { status: 'error', input: { path: 'x.typ' }, error: 'Permission denied' } },
        { type: 'text', text: 'Done.' },
      ],
    },
    { id: 'msg_i', type: 'idle' },
  ];

  it('turns saved messages into chat items, without the attached selection text', () => {
    expect(itemsFromContext(context).map((i) => [i.kind, 'text' in i ? i.text : `${(i as any).name} ${(i as any).summary} ${(i as any).status}`])).toEqual([
      ['user', 'Fix the TODO.'],
      ['tool', 'read chapters/ch1.typ done'],
      ['tool', 'edit x.typ failed'],
      ['assistant', 'Done.'],
    ]);
    expect((itemsFromContext(context)[0] as any).attachments).toEqual(['chapters/ch1.typ:6']);
  });

  it('knows which lines each read covered', () => {
    const items = itemsFromContext(context, '/books/b');
    expect(items[1]).toMatchObject({ summary: 'chapters/ch1.typ · line 1', read: { path: 'chapters/ch1.typ', from: 1, to: 1 } });
    expect(readsFromContext(context, '/books/b')).toEqual([{ path: 'chapters/ch1.typ', start: 1, lines: ['= Vectors'], time: expect.any(Number) }]);
    // Reads kept through a compaction count; summarized ones are gone.
    expect(readsFromContext([{ id: 'c', type: 'compaction', summary: 'x', recent: context }], '/books/b')).toHaveLength(1);
  });

  it('gives items the ids live events use, so a switch mid-reply carries on', () => {
    const items = itemsFromContext([
      {
        id: 'msg_a',
        type: 'assistant',
        content: [
          { type: 'reasoning', text: 'Plan it.' },
          { type: 'tool', id: 'call_9', name: 'read', state: { status: 'running', input: { path: 'main.typ' } } },
          { type: 'text', text: '' },
          { type: 'text', text: 'Second text part.' },
        ],
      },
    ]);
    expect(items.map((i) => `${i.kind}:${i.id}${i.kind === 'tool' ? `:${i.status}` : ''}`)).toEqual(['thinking:msg_a:r0', 'tool:call_9:running', 'assistant:msg_a:1']);
  });

  it('reads the context size from the latest call', () => {
    expect(contextTokens(context)).toBe(9500);
    expect(contextTokens([])).toBeNull();
  });

  it('shows a compacted conversation as its summary', () => {
    const items = itemsFromContext([{ id: 'c1', type: 'compaction', summary: '## Objective\n- Change the heading.' }, { id: 'i', type: 'idle' }]);
    expect(items).toEqual([{ kind: 'assistant', id: 'c1', text: '**Summary of the conversation so far**\n\n## Objective\n- Change the heading.', done: true }]);
  });

  it('splits the cursor-position context too', () => {
    expect(splitUserText('Hi\n\nThe cursor is in a.typ at line 3, column 1.')).toEqual({ text: 'Hi', attachments: [] });
    // The author's edits to the assistant's text: chips, and gone from the text.
    const sent = `Tighten it\n\n${formatAuthorEdits([
      { path: 'ch1.typ', from: 4, to: 5, wrote: 'A', now: 'B' },
      { path: 'ch2.typ', from: 9, to: 8, wrote: 'C', now: '' },
    ])}`;
    expect(splitUserText(sent)).toEqual({ text: 'Tighten it', attachments: ['Your edit: ch1.typ:4–5', 'Your edit: ch2.typ:9'] });
  });

  it('leaves out the mode’s reminder of how to reply', () => {
    const sent = messageText('Is chapter 3 too long?', [{ selection: { relativePath: 'ch3.typ', start: { line: 2, column: 1 }, end: { line: 4, column: 1 }, selectedText: 'x', documentVersion: 1 } as never, stale: false }, { reminder: ASK_REMINDER }]);
    expect(sent.endsWith(ASK_REMINDER)).toBe(true);
    expect(splitUserText(sent).text).toBe('Is chapter 3 too long?');
    expect(splitUserText(`Why?\n\n${ASK_REMINDER}`)).toEqual({ text: 'Why?', attachments: [] });
  });
});

describe('tasks across assistants', () => {
  const listed = (id: string, updated: number, title = '') => ({ id, title, updated, tokens: null });

  it('reads records kept before tasks had ids of their own', () => {
    expect(readTaskRecords([{ sessionId: 's1', status: 'done', doneAt: 5 }, { id: 't2', status: 'open' }, { status: 'open' }, null])).toEqual([
      { id: 's1', status: 'done', doneAt: 5 },
      { id: 't2', status: 'open' },
    ]);
    expect(readTaskRecords(null)).toEqual([]);
  });

  it('lists every task, whichever assistant it was with', () => {
    const records: TaskRecord[] = [
      { id: 'c1', status: 'open', title: 'Tighten chapter 2', updated: 100, assistant: 'claude', threads: { claude: { sessionId: 'c1', seen: null } } },
      { id: 'c2', status: 'open', updated: 300, assistant: 'claude', threads: { claude: { sessionId: 'c2', seen: null } }, kept: true },
    ];
    // Codex runs: Claude Code's tasks stay, and Codex's own conversation becomes one.
    const { tasks, records: next, changed } = mergeTasks(records, [listed('x1', 200, 'Fix the figures')], 'codex');
    expect(tasks.map((t) => [t.id, t.title, t.sessionId])).toEqual([
      ['c2', '', null],
      ['x1', 'Fix the figures', 'x1'],
      ['c1', 'Tighten chapter 2', null],
    ]);
    expect(changed).toBe(true);
    expect(next.find((r) => r.id === 'x1')).toEqual({ id: 'x1', status: 'open', title: 'Fix the figures', updated: 200, assistant: 'codex', threads: { codex: { sessionId: 'x1', seen: null } } });
  });

  it('finds a task’s own conversation with this assistant, and keeps the title it started with', () => {
    const records: TaskRecord[] = [
      { id: 'c1', status: 'open', title: 'Tighten chapter 2', updated: 100, assistant: 'codex', threads: { claude: { sessionId: 'c1', seen: 'u1' }, codex: { sessionId: 'x9', seen: null } } },
    ];
    const { tasks, changed } = mergeTasks(records, [listed('x9', 400, 'Carry on')], 'codex');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 'c1', sessionId: 'x9', title: 'Tighten chapter 2', updated: 400 });
    expect(changed).toBe(true);
    // Nothing new: nothing to keep again.
    expect(mergeTasks(mergeTasks(records, [listed('x9', 400)], 'codex').records, [listed('x9', 400)], 'codex').changed).toBe(false);
  });

  it('stamps a task from before with the assistant that lists it, and leaves out what no one has', () => {
    const records: TaskRecord[] = [
      { id: 'old', status: 'done', doneAt: 50 },
      { id: 'gone', status: 'open' },
    ];
    const { tasks, records: next } = mergeTasks(records, [listed('old', 40, 'Old one')], 'claude');
    expect(tasks.map((t) => t.id)).toEqual(['old']);
    expect(next.find((r) => r.id === 'old')).toMatchObject({ assistant: 'claude', threads: { claude: { sessionId: 'old', seen: null } }, status: 'done' });
    // While no assistant runs, the tasks Foreword knows of.
    expect(mergeTasks(next, null, 'claude').tasks.map((t) => t.id)).toEqual(['old']);
  });

  const user = (id: string, text: string): ChatItem => ({ kind: 'user', id, text, attachments: [] });
  const reply = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, text, done: true });

  it('reads a kept chat, and opens it with nothing left waiting', () => {
    expect(readKeptChat('{"items":[],"running":true}')).toEqual({ items: [], running: true });
    expect(readKeptChat('nope')).toBeNull();
    expect(readKeptChat(null)).toBeNull();
    const items: ChatItem[] = [
      user('u1', 'Hi'),
      { kind: 'permission', id: 'p1', action: 'edit', resources: [], patches: [], state: 'pending' },
      { kind: 'permission', id: 'p2', action: 'edit', resources: [], patches: [], state: 'once' },
      { kind: 'question', id: 'q1', title: 'Questions', fields: [], state: 'pending' },
      { kind: 'question', id: 'q2', title: 'Questions', fields: [], state: 'pending', via: 'message' },
      { kind: 'thinking', id: 't1', text: 'Hmm', done: false, started: 1 },
    ];
    expect(keptItems(items).map((i) => `${i.id}${i.kind === 'thinking' ? `:${i.done}` : ''}`)).toEqual(['u1', 'p2', 'q2', 't1:true']);
  });

  it('brings a turn that went on after the chat was kept up to date', () => {
    const kept = [user('u1', 'Hi'), { ...reply('a1', 'Hello'), by: undefined }, user('u2', 'Fix chapter 2'), reply('a2:0', 'Reading')];
    const theirs = [user('m1', 'Hi'), reply('m2:0', 'Hello'), user('m3', 'Fix chapter 2'), reply('m4:0', 'Reading'), reply('m4:1', 'Done: tightened it.')];
    expect(withLatestTurn(kept, theirs).map((i) => i.id)).toEqual(['u1', 'a1', 'u2', 'm4:0', 'm4:1']);
    // Their record doesn't have the message (another assistant's turn): as kept.
    expect(withLatestTurn(kept, [user('m1', 'Hi')]).map((i) => i.id)).toEqual(['u1', 'a1', 'u2', 'a2:0']);
  });
});
