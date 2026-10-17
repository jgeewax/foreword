import { describe, expect, it } from 'vitest';
import { parseTodos, todoPrompt, withoutTodo } from './todos';

const TYP = `= Vectors
// TODO: check this date with the archive
The ship sailed in 1820. // todo cite the log book
See https://example.com//todo-list for more.
/* FIXME the figure is too wide */
#todo[Add an example with three vectors]
#todo("Mention the dot product")
/* TODO
   longer note */
Plain text mentioning a todo list is fine.`;

describe('parseTodos', () => {
  it('finds comments, blocks and #todo calls with their lines', () => {
    expect(parseTodos(TYP, 'ch1.typ').map((t) => [t.line, t.kind, t.text])).toEqual([
      [2, 'line-comment', 'check this date with the archive'],
      [3, 'inline-comment', 'cite the log book'],
      [5, 'block-comment', 'the figure is too wide'],
      [6, 'call', 'Add an example with three vectors'],
      [7, 'call', 'Mention the dot product'],
      [8, 'block-comment', '(no description)'],
    ]);
  });

  it('reads Markdown checkboxes and TODO lines', () => {
    expect(parseTodos('# Notes\n- [ ] Ask the editor about chapter 3\n- [x] done already\nTODO: pick a cover', 'notes.md').map((t) => t.text)).toEqual([
      'Ask the editor about chapter 3',
      'pick a cover',
    ]);
  });
});

describe('Done and prompts', () => {
  it('removes a TODO comment from its line', () => {
    const [line, inline, block] = parseTodos(TYP, 'ch1.typ');
    expect(withoutTodo('// TODO: check this date', line)).toBe('');
    expect(withoutTodo('The ship sailed in 1820. // todo cite the log book', inline)).toBe('The ship sailed in 1820.');
    expect(withoutTodo('/* FIXME … */', block)).toBeNull();
  });

  it('asks the assistant to do it and remove the TODO', () => {
    const [t] = parseTodos(TYP, 'chapters/ch1.typ');
    expect(todoPrompt(t)).toBe('Work on this TODO in chapters/ch1.typ (line 2): “check this date with the archive”. When it\'s done, remove the TODO itself.');
  });
});
