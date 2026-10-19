import { describe, expect, it } from 'vitest';
import type { ChatItem } from './studio';
import { attachmentPlace, editOf, linesOf, looksLikeProse, patchChanges, spanWords, statsOf, toolTone, trimPieces, turnsOf, turnTime, turnWords, verbAndRest } from './trace';

const user = (id: string, text = 'Do it'): ChatItem => ({ kind: 'user', id, text, attachments: [] });
const said = (id: string, text = 'Done.'): ChatItem => ({ kind: 'assistant', id, text, done: true });
const tool = (id: string, name: string, input: unknown = {}, status: 'running' | 'done' | 'failed' = 'done', read?: { path: string; from: number; to: number }): ChatItem => ({ kind: 'tool', id, name, summary: '', status, detail: '', input, ...(read ? { read } : {}) });

describe('the conversation in turns', () => {
  it('each message with what followed it; its reply is the last thing said', () => {
    const turns = turnsOf([user('u1'), tool('t1', 'read'), said('a1', 'Let me look.'), tool('t2', 'edit'), said('a2'), user('u2'), said('a3')]);
    expect(turns.map((t) => [t.key, t.steps.map((s) => s.id), t.reply?.id ?? null])).toEqual([
      ['u1', ['t1', 'a1', 't2'], 'a2'],
      ['u2', [], 'a3'],
    ]);
  });

  it('a turn that ends on a step has no reply; questions asked in the reply come after it', () => {
    const ask: ChatItem = { kind: 'question', id: 'q', title: 'Questions', fields: [], state: 'pending', via: 'message' };
    expect(turnsOf([user('u'), tool('t', 'read')])[0]).toMatchObject({ reply: null, steps: [{ id: 't' }] });
    expect(turnsOf([user('u'), said('a'), ask])[0]).toMatchObject({ reply: { id: 'a' }, after: [{ id: 'q' }] });
  });

  it('anything before the first message is a turn of its own', () => {
    const notice: ChatItem = { kind: 'notice', id: 'n', tone: 'info', text: 'Hi' };
    expect(turnsOf([notice, user('u')]).map((t) => [t.key, t.user?.id ?? null])).toEqual([
      ['start', null],
      ['u', 'u'],
    ]);
  });
});

describe('a step’s tone', () => {
  it('looked, changed something, failed, or other', () => {
    expect(toolTone({ name: 'read', status: 'done' })).toBe('look');
    expect(toolTone({ name: 'grep', status: 'running' })).toBe('look');
    expect(toolTone({ name: 'edit', status: 'done' })).toBe('change');
    expect(toolTone({ name: 'edit', status: 'failed' })).toBe('fail');
    expect(toolTone({ name: 'bash', status: 'done' })).toBe('other');
    // A command that only looks is said as a search or a read: blue too.
    expect(toolTone({ name: 'bash', status: 'done' }, 'Searched for “countenance” in the book')).toBe('look');
    expect(toolTone({ name: 'bash', status: 'done' }, 'Ran the build')).toBe('other');
  });
});

describe('an edit in words', () => {
  it('the words it cut and added, in the book', () => {
    const e = editOf({ name: 'edit', status: 'done', input: { filePath: '/b/ch1.typ', oldString: 'something indeed which never', newString: 'something which never' } }, '/b')!;
    expect(e).toMatchObject({ path: 'ch1.typ', added: 0, removed: 1, whole: false });
    expect(e.pieces).toEqual([
      { kind: 'same', text: 'something ' },
      { kind: 'del', text: 'indeed ' },
      { kind: 'same', text: 'which never' },
    ]);
  });

  it('a whole file written; nothing when the call doesn’t say, or failed', () => {
    expect(editOf({ name: 'write', status: 'done', input: { filePath: 'new.typ', content: 'Two words' } }, '/b')).toMatchObject({ whole: true, added: 2, removed: 0 });
    expect(editOf({ name: 'edit', status: 'done', input: { filePath: 'x.typ' } }, '/b')).toBeNull();
    expect(editOf({ name: 'edit', status: 'failed', input: { filePath: 'x.typ', oldString: 'a', newString: 'b' } }, '/b')).toBeNull();
  });

  it('long unchanged stretches cut down around the change', () => {
    const words = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
    const trimmed = trimPieces(
      [
        { kind: 'same', text: `${words(30)} ` },
        { kind: 'del', text: 'cut ' },
        { kind: 'same', text: `${words(30, 'mid')} ` },
        { kind: 'add', text: 'new ' },
        { kind: 'same', text: words(30, 'end') },
      ],
      3,
    );
    expect(trimmed[0].text).toBe('… word27 word28 word29 ');
    expect(trimmed[2].text).toBe('mid0 mid1 mid2 … mid27 mid28 mid29 ');
    expect(trimmed[4].text).toBe('end0 end1 end2 …');
    expect(trimPieces([{ kind: 'same', text: 'short ' }, { kind: 'add', text: 'x' }], 3)).toEqual([{ kind: 'same', text: 'short ' }, { kind: 'add', text: 'x' }]);
  });

  it('book text, not markup or code', () => {
    expect(looksLikeProse('At friendly meetings, and when the wine was to his taste, something eminently human beaconed from his eye.')).toBe(true);
    expect(looksLikeProse('#set page(width: 6in, height: 9in, margin: (x: 0.8in))')).toBe(false);
    expect(looksLikeProse('countenance')).toBe(true);
  });
});

describe('what a turn did', () => {
  const items = [
    tool('r1', 'read', { filePath: 'ch1.typ' }, 'done', { path: 'ch1.typ', from: 1, to: 15 }),
    tool('r2', 'read', { filePath: '/b/ch1.typ' }),
    tool('g', 'grep', { pattern: 'x' }),
    tool('e1', 'edit', { filePath: 'ch1.typ', oldString: 'a b c', newString: 'a d' }),
    tool('e2', 'edit', { filePath: 'ch1.typ', oldString: 'x', newString: 'x y' }),
    tool('f', 'bash', {}, 'failed'),
  ];

  it('counts what it looked at and changed', () => {
    const s = statsOf(items, '/b');
    expect(s).toMatchObject({ looked: 3, reads: 2, searches: 1, read: ['ch1.typ'], changed: 2, failed: 1 });
    expect([...s.files]).toEqual([['ch1.typ', { added: 2, removed: 2 }]]);
  });

  it('a command that only looks counts as a search or a read', () => {
    const s = statsOf([tool('b', 'bash', { command: 'grep -n x ch1.typ' }), tool('c', 'bash', { command: 'sed -n 1,9p ch1.typ' })], '/b', (it) => ((it.input as { command: string }).command.startsWith('grep') ? 'Searched for “x”' : 'Read ch1.typ'));
    expect(s).toMatchObject({ looked: 2, searches: 1, reads: 1 });
  });

  it('in a few words, when folded', () => {
    expect(turnWords(statsOf(items, '/b'))).toBe('Edited 1 file · +2 −2');
    expect(turnWords(statsOf(items.slice(0, 2), '/b'), (p) => p === 'ch1.typ')).toBe('Read 1 chapter');
    expect(turnWords(statsOf([items[2]], '/b'))).toBe('Searched 1 time');
    expect(turnWords(statsOf([], '/b'))).toBe('');
  });
});

describe('words for the chat', () => {
  it('times', () => {
    expect(spanWords(420)).toBe('0.4 s');
    expect(spanWords(12_400)).toBe('12 s');
    expect(spanWords(4 * 60_000)).toBe('4 min');
    expect(spanWords(65 * 60_000)).toBe('1 h 5 min');
    expect(turnTime(21_300)).toBe('21 s');
    expect(turnTime(300)).toBe('1 s');
  });

  it('a step’s verb apart from the rest', () => {
    expect(verbAndRest('Read “Story of the Door” (chapter 1)')).toEqual(['Read', '“Story of the Door” (chapter 1)']);
    expect(verbAndRest('Thought')).toEqual(['Thought', '']);
  });

  it('an attachment as a place', () => {
    expect(attachmentPlace('chapters/01-door.typ:5–11')).toEqual({ path: 'chapters/01-door.typ', where: 'lines 5–11' });
    expect(attachmentPlace('main.typ:3')).toEqual({ path: 'main.typ', where: 'line 3' });
    expect(attachmentPlace('main.typ:3:7')).toEqual({ path: 'main.typ', where: 'line 3' });
    expect(attachmentPlace('Your edit: ch1.typ')).toBeNull();
  });

  it('where an edit is in the file now', () => {
    expect(linesOf('one\ntwo\nthree\n', 'two\nthree')).toEqual({ from: 2, to: 3 });
    expect(linesOf('a\na\n', 'a')).toBeNull();
    expect(linesOf('abc', '')).toBeNull();
  });
});

describe('a permission’s patch as changes', () => {
  it('each run of removed and added lines, with its line in the new file', () => {
    const patch = ['Index: ch10.typ', '===================================================================', '--- ch10.typ', '+++ ch10.typ', '@@ -193,3 +193,3 @@', ' Before.', '-so black a countenance as', '+so black a face as', ' After.', '@@ -215,1 +215,2 @@', '-wear the countenance', '+wear the face', '+of Jekyll.', ''].join('\n');
    expect(patchChanges(patch)).toEqual([
      { line: 194, before: 'so black a countenance as', after: 'so black a face as' },
      { line: 215, before: 'wear the countenance', after: 'wear the face\nof Jekyll.' },
    ]);
  });
});
