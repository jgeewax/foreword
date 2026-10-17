import { describe, expect, it } from 'vitest';
import { asksTaskDone, contextTokens, itemsFromContext, readsFromContext, splitUserText, TASK_INSTRUCTIONS, TASK_MARKER, withoutMarker } from './tasks';

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
  });
});
