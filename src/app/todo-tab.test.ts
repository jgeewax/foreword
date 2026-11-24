import { describe, expect, it } from 'vitest';
import { findRow, nearText, openCount, todoGroups, todoRows, type BookChapter, type TodoGroupsInput } from './todo-tab';
import { parseTodos, restoreTodo, takeOutTodo } from './todos';

const CH3 = `#import "../style.typ": *

= On Relative Growings

// TODO: Open with the ladder
All through the calculus we are dealing with quantities that are growing.

#figure(
  image("../figures/triangle.svg"),
  caption: [], // FIXME: empty caption
) <fig-triangle>

== How to read differentials

One reads $d x$ thus: "dee-eks."
#todo[A small table]
The differential coefficient`;

const CH3_FIG = `// TODO: Redraw the ladder
#figure(image("ladder.svg"))`;

const CH5 = `= Constants

== Added constants <added>
So the 5 has quite disappeared.
// TODO: Two exercises`;

const MAIN = `#include "chapters/03.typ"
// TODO: a dedication`;

const todos = [...parseTodos(CH3, 'chapters/03.typ'), ...parseTodos(CH3_FIG, 'chapters/03-fig.typ'), ...parseTodos(CH5, 'chapters/05.typ'), ...parseTodos(MAIN, 'main.typ')];
const chapters: BookChapter[] = [
  { path: 'chapters/03.typ', files: ['chapters/03.typ', 'chapters/03-fig.typ'] },
  { path: 'chapters/05.typ', files: ['chapters/05.typ'] },
];
const titles: Record<string, string> = { 'chapters/03.typ': '3. On Relative Growings', 'chapters/05.typ': '5. Constants' };
const base: TodoGroupsInput = { todos, done: [], scope: 'chapter', chapter: chapters[0], chapters, here: 'chapters/03.typ', titleOf: (p) => titles[p], kinds: { todo: true, fix: true }, query: '' };
const shape = (input: Partial<TodoGroupsInput>) => todoGroups({ ...base, ...input }).map((g) => [g.title, g.sub, g.here, g.open, g.rows.map((r) => `${r.done ? '~' : ''}${r.todo.line} ${r.todo.text}`)]);

describe('parseTodos for the tab', () => {
  it('knows a FIXME, the heading it is under, and the line it sits by', () => {
    expect(parseTodos(CH3, 'chapters/03.typ').map((t) => [t.line, !!t.fix, t.section, t.near])).toEqual([
      [5, false, 'On Relative Growings', 'All through the calculus we are dealing with quantities that are growing.'],
      [10, true, 'On Relative Growings', 'caption: [],'],
      [16, false, 'How to read differentials', 'The differential coefficient'],
    ]);
    // A label and a trailing comment aren't part of a heading; one at the end looks back.
    expect(parseTodos(CH5, 'c.typ').map((t) => [t.section, t.near])).toEqual([['Added constants', 'So the 5 has quite disappeared.']]);
    expect(parseTodos('= Intro // TODO: rename', 'c.typ')[0].section).toBe('Intro');
    expect(parseTodos('# Notes\n- [ ] ask\n', 'n.md')[0].section).toBe('Notes');
  });
});

describe('Done and Undo', () => {
  it('takes a TODO out and puts it back where it was, after the lines around it moved', () => {
    const [first, fix] = parseTodos(CH3, 'chapters/03.typ');
    const out = takeOutTodo(CH3, first)!;
    expect(out.text.split('\n')[4]).toBe('All through the calculus we are dealing with quantities that are growing.');
    expect(restoreTodo(out.text, out.done)).toBe(CH3);
    // Two lines typed above it: still back between the same lines.
    const moved = `one\ntwo\n${out.text}`;
    expect(restoreTodo(moved, out.done)).toBe(`one\ntwo\n${CH3}`);
    // An inline FIXME: its comment comes back on its line.
    const inline = takeOutTodo(CH3, fix)!;
    expect(inline.text.split('\n')[9]).toBe('  caption: [],');
    expect(restoreTodo(inline.text, inline.done)).toBe(CH3);
  });

  it('gives up when it is back already, or the text around it is gone', () => {
    const [first] = parseTodos(CH3, 'chapters/03.typ');
    const out = takeOutTodo(CH3, first)!;
    expect(restoreTodo(CH3, out.done)).toBeNull();
    expect(restoreTodo('something else entirely', out.done)).toBeNull();
    const [call] = parseTodos('#todo[x]', 'c.typ');
    expect(takeOutTodo('#todo[x]', call)).toBeNull();
  });
});

describe('todoGroups', () => {
  it('lists the chapter by its sections, its included files after it', () => {
    expect(shape({})).toEqual([
      ['On Relative Growings', null, false, 2, ['5 Open with the ladder', '10 empty caption']],
      ['How to read differentials', null, false, 1, ['16 A small table']],
      ['03-fig.typ', '03-fig.typ', false, 1, ['1 Redraw the ladder']],
    ]);
  });

  it('lists the book by chapter, in order, then the files in none', () => {
    expect(shape({ scope: 'book' })).toEqual([
      ['3. On Relative Growings', '03.typ', true, 4, ['5 Open with the ladder', '10 empty caption', '16 A small table', '1 Redraw the ladder']],
      ['5. Constants', '05.typ', false, 1, ['5 Two exercises']],
      ['main.typ', null, false, 1, ['2 a dedication']],
    ]);
  });

  it('filters by kind and words', () => {
    expect(shape({ kinds: { todo: false, fix: true } }).map((g) => g[4])).toEqual([['10 empty caption']]);
    expect(shape({ scope: 'book', query: 'LADDER' }).flatMap((g) => g[4])).toEqual(['5 Open with the ladder', '1 Redraw the ladder']);
    // The line it sits by counts too.
    expect(shape({ scope: 'book', query: 'disappeared' }).flatMap((g) => g[4])).toEqual(['5 Two exercises']);
  });

  it('keeps a done row in its place, struck, until the TODO is back', () => {
    const [first] = parseTodos(CH3, 'chapters/03.typ');
    const out = takeOutTodo(CH3, first)!;
    const after = [...parseTodos(out.text, 'chapters/03.typ'), ...parseTodos(CH3_FIG, 'chapters/03-fig.typ')];
    expect(shape({ todos: after, done: [out.done] })[0]).toEqual(['On Relative Growings', null, false, 1, ['~5 Open with the ladder', '9 empty caption']]);
    // Back again (⌘Z): its own row, not a struck one beside it.
    expect(shape({ done: [out.done] })[0][4]).toEqual(['5 Open with the ladder', '10 empty caption']);
  });

  it('finds the picked row again after the lines move', () => {
    const rows = todoRows(todoGroups(base));
    expect(findRow(rows, { path: 'chapters/03.typ', line: 9, text: 'empty caption' })?.todo.line).toBe(10);
    expect(findRow(rows, { path: 'chapters/03.typ', line: 9, text: 'gone' })).toBeNull();
    expect(findRow(rows, null)).toBeNull();
  });

  it('counts what is left in a scope', () => {
    expect(openCount(todos, null)).toBe(6);
    expect(openCount(todos, chapters[0].files)).toBe(4);
  });
});

describe('nearText', () => {
  it('reads markup as text and leaves code as written', () => {
    expect(nearText('We classify all quantities: _constants_ and $d x$---or *not*.')).toEqual({ text: 'We classify all quantities: constants and $d x$—or not.', code: false });
    expect(nearText('(1) $d$ which merely means "a little bit of."')).toEqual({ text: '(1) $d$ which merely means "a little bit of."', code: false });
    // An underscore inside math isn't emphasis.
    expect(nearText('A vector in $RR^n$ has entries $u_i$ and $v_i$.').text).toBe('A vector in $RR^n$ has entries $u_i$ and $v_i$.');
    expect(nearText('caption: [],')).toEqual({ text: 'caption: [],', code: true });
    expect(nearText('#figure(')).toEqual({ text: '#figure(', code: true });
    expect(nearText('Remember: the snake_case name stays.').code).toBe(false);
    expect(nearText(undefined)).toEqual({ text: '', code: false });
  });
});
