import { describe, expect, it } from 'vitest';
import { changedWhere, clip, plainLine, doneGroup, findInTask, isQuiet, taskLive, taskMeta, taskSections, whenLabel, type LiveSource, type Listed } from './task-list';
import type { TaskSummary } from './tasks';
import type { BookNames } from './tool-labels';

// Saturday 24 October 2026, 3 pm, local time.
const NOW = new Date(2026, 9, 24, 15, 0).getTime();
const at = (day: number, hour = 12, month = 9, year = 2026) => new Date(year, month, day, hour).getTime();

const idle: LiveSource = { sessionId: null, running: false, activity: '', asking: null, stopped: false, background: {} };
const task = (sessionId: string, patch: Partial<TaskSummary> = {}): TaskSummary => ({ sessionId, title: sessionId, status: 'open', updated: NOW, tokens: null, ...patch });

const names: BookNames = {
  root: '/book',
  entry: 'main.typ',
  chapters: ['chapters/00-preface.typ', 'chapters/01-door.typ', 'chapters/02-search.typ', 'chapters/03-ease.typ', 'chapters/04-carew.typ'],
  titles: { 'chapters/00-preface.typ': 'Preface', 'chapters/01-door.typ': 'The Door', 'chapters/02-search.typ': 'The Search', 'chapters/03-ease.typ': 'At Ease', 'chapters/04-carew.typ': 'Carew' },
  unnumbered: ['chapters/00-preface.typ'],
};

describe('taskLive', () => {
  it('reads the shown conversation from the chat', () => {
    const shown = { ...idle, sessionId: 'a' };
    expect(taskLive(task('a'), { ...shown, asking: 'question', asks: 'Whose eyes?' })).toEqual({ state: 'question', note: 'Has a question: Whose eyes?' });
    expect(taskLive(task('a'), { ...shown, asking: 'permission', asks: 'run typst compile' })).toEqual({ state: 'permission', note: 'Asks to run typst compile' });
    expect(taskLive(task('a'), { ...shown, running: true, activity: 'Reading “Carew” (chapter 4)' })).toEqual({ state: 'working', note: 'Reading “Carew” (chapter 4)' });
    expect(taskLive(task('a'), { ...shown, stopped: true }).state).toBe('stopped');
    expect(taskLive(task('a', { status: 'done' }), shown)).toEqual({ state: 'done', note: '' });
  });

  it('reads the others from their background status', () => {
    const bg = (b: Partial<LiveSource['background'][string]>) => ({ ...idle, background: { b: { running: false, attention: null, unread: false, label: '', since: 0, ...b } } });
    expect(taskLive(task('b'), bg({ attention: 'permission', running: true })).state).toBe('permission');
    expect(taskLive(task('b'), bg({ running: true, label: 'Writing…' }))).toEqual({ state: 'working', note: 'Writing…' });
    expect(taskLive(task('b'), bg({ unread: true }))).toEqual({ state: 'unread', note: 'New reply' });
    expect(taskLive(task('b'), bg({ unread: true, failed: 'the model was busy' }))).toEqual({ state: 'stopped', note: 'Stopped: the model was busy' });
    expect(taskLive(task('b', { status: 'done' }), idle).state).toBe('done');
  });
});

describe('whenLabel', () => {
  it('says how long ago, briefly', () => {
    expect(whenLabel(NOW - 20_000, NOW)).toBe('now');
    expect(whenLabel(NOW - 4 * 60_000, NOW)).toBe('4 min');
    expect(whenLabel(NOW - 3 * 3_600_000, NOW)).toBe('3 h');
    expect(whenLabel(at(23, 22), NOW)).toBe('Yesterday');
    expect(whenLabel(at(22), NOW)).toBe(new Date(at(22)).toLocaleDateString([], { weekday: 'short' }));
    expect(whenLabel(at(5), NOW)).toBe(new Date(at(5)).toLocaleDateString([], { month: 'short', day: 'numeric' }));
    expect(whenLabel(at(5, 12, 9, 2025), NOW)).toContain('2025');
  });
});

describe('doneGroup', () => {
  it('files this week by day and earlier by month', () => {
    expect(doneGroup(at(24, 9), NOW).label).toBe('Today');
    expect(doneGroup(at(23), NOW).label).toBe('Yesterday');
    expect(doneGroup(at(18), NOW)).toMatchObject({ label: 'This week', month: false });
    expect(doneGroup(at(17), NOW)).toMatchObject({ label: `Earlier in ${new Date(NOW).toLocaleDateString([], { month: 'long' })}`, month: true });
    expect(doneGroup(at(12, 12, 8), NOW).label).toBe(new Date(at(12, 12, 8)).toLocaleDateString([], { month: 'long' }));
    expect(doneGroup(at(12, 12, 8, 2025), NOW).label).toContain('2025');
  });
});

describe('taskSections', () => {
  const listed = (t: TaskSummary, state: Listed<TaskSummary>['live']['state']): Listed<TaskSummary> => ({ task: t, live: { state, note: '' } });

  it('puts what needs you first, then at work, open and done', () => {
    const sections = taskSections(
      [
        listed(task('open-old', { updated: at(20) }), 'open'),
        listed(task('done-today', { status: 'done', doneAt: at(24, 9) }), 'done'),
        listed(task('asks', { updated: at(24, 14) }), 'question'),
        listed(task('open-new', { updated: at(24, 10) }), 'open'),
        listed(task('busy'), 'working'),
        listed(task('unread', { updated: at(24, 13) }), 'unread'),
      ],
      NOW,
    );
    expect(sections.map((s) => [s.label, s.count])).toEqual([
      ['Needs you', 2],
      ['At work', 1],
      ['Open', 2],
      ['Done', 1],
    ]);
    expect(sections[0].groups[0].items.map((i) => i.task.sessionId)).toEqual(['asks', 'unread']);
    expect(sections[2].groups[0].items.map((i) => i.task.sessionId)).toEqual(['open-new', 'open-old']);
  });

  it('groups done tasks by when they were done, falling back to their last change', () => {
    const [done] = taskSections(
      [
        listed(task('sep', { status: 'done', updated: at(3, 12, 8) }), 'done'),
        listed(task('today', { status: 'done', updated: at(1), doneAt: at(24, 9) }), 'done'),
        listed(task('week', { status: 'done', doneAt: at(20) }), 'done'),
        listed(task('sep2', { status: 'done', doneAt: at(20, 12, 8) }), 'done'),
      ],
      NOW,
    );
    expect(done.groups.map((g) => [g.label.startsWith('Earlier') ? 'month' : g.key, g.items.map((i) => i.task.sessionId)])).toEqual([
      ['today', ['today']],
      ['week', ['week']],
      ['2026-8', ['sep2', 'sep']],
    ]);
    expect(done.groups[2].month).toBe(true);
  });
});

describe('changedWhere and taskMeta', () => {
  it('names chapters by number, other files by name', () => {
    expect(changedWhere(['chapters/02-search.typ', 'chapters/01-door.typ'], names)).toBe('ch. 1, 2');
    expect(changedWhere(['main.typ'], names)).toBe('main.typ');
    expect(changedWhere(['main.typ', 'chapters/01-door.typ'], names)).toBe('2 files');
    expect(changedWhere(['chapters/01-door.typ', 'chapters/02-search.typ', 'chapters/03-ease.typ', 'chapters/04-carew.typ'], names)).toBe('4 chapters');
    // A preface isn't numbered: it's a file.
    expect(changedWhere(['chapters/00-preface.typ'], names)).toBe('00-preface.typ');
  });

  it('says the mode and what changed, or nothing for a task from before', () => {
    const files = { 'chapters/01-door.typ': { added: 3, deleted: 10, version: 'v1' }, 'chapters/02-search.typ': { added: 2, deleted: 1, version: 'v2' } };
    expect(taskMeta({ mode: 'write', files }, names)).toEqual({ text: 'Write · ch. 1, 2 · ', added: 5, deleted: 11, changed: true });
    expect(taskMeta({ mode: 'ask' }, names)).toEqual({ text: 'Ask · no changes', added: 0, deleted: 0, changed: false });
    expect(taskMeta({}, names)).toBeNull();
  });
});

describe('findInTask', () => {
  const t = task('x', { title: 'Tighten the opening', asked: 'The fog in chapter 4 is scenery. Can it do more?', said: 'The fog lifts with his dread now.' });

  it('matches the title first, then what was asked, then the reply', () => {
    expect(findInTask(t, 'OPENING')).toEqual({ inTitle: true });
    expect(findInTask(t, 'scenery')).toMatchObject({ where: 'asked', match: 'scenery', before: 'The fog in chapter 4 is ' });
    expect(findInTask(t, 'dread')).toMatchObject({ where: 'said', match: 'dread' });
    expect(findInTask(t, 'moon')).toBeNull();
  });

  it('cuts long text round the match', () => {
    const long = task('y', { asked: `${'a '.repeat(40)}needle${' b'.repeat(40)}` });
    const m = findInTask(long, 'needle')!;
    expect(m.before!.startsWith('…')).toBe(true);
    expect(m.after!.endsWith('…')).toBe(true);
  });
});

describe('isQuiet and clip', () => {
  it('offers open tasks untouched for two weeks', () => {
    expect(isQuiet({ updated: at(5) }, { state: 'open', note: '' }, NOW)).toBe(true);
    expect(isQuiet({ updated: at(15) }, { state: 'open', note: '' }, NOW)).toBe(false);
    expect(isQuiet({ updated: at(5) }, { state: 'done', note: '' }, NOW)).toBe(false);
  });

  it('keeps one line', () => {
    expect(clip('one\n two   three', 40)).toBe('one two three');
    expect(clip('abcdefghij', 6)).toBe('abcde…');
  });

  it('keeps a reply’s words, not its Markdown', () => {
    expect(plainLine('**Cut** 14 words in [the door](chapters/01.typ).\n\n```typst\n#set page()\n```\nDone, `see` it.', 80)).toBe('Cut 14 words in the door. Done, see it.');
    expect(plainLine('## Done\n> The heading is `= Vectors <ch-vectors>`.\n- one_two #set', 80)).toBe('Done The heading is = Vectors <ch-vectors>. one_two #set');
  });
});
