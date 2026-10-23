import { describe, expect, it } from 'vitest';
import { parseTodos, todoAt, todoPrompt, withoutTodo } from './todos';

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

describe('todoAt (the editor’s hover)', () => {
  const at = (text: string, column?: number) => {
    const r = todoAt(text, 'ch1.typ', 7, column);
    return r && [r.from, r.to, r.todo.kind, r.todo.line, r.todo.text, r.fix];
  };

  it('covers a comment from its slashes to the end of the line', () => {
    expect(at('  // TODO: check this date', 3)).toEqual([3, 27, 'line-comment', 7, 'check this date', false]);
    expect(at('  // TODO: check this date', 2)).toBeNull();
    expect(at('The ship sailed. // FIXME cite the log', 10)).toBeNull();
    expect(at('The ship sailed. // FIXME cite the log', 20)).toEqual([18, 39, 'inline-comment', 7, 'cite the log', true]);
  });

  it('covers a block comment or a #todo call, not what follows it', () => {
    expect(at('/* FIXME too wide */ #figure', 4)).toEqual([1, 21, 'block-comment', 7, 'too wide', true]);
    expect(at('/* FIXME too wide */ #figure', 24)).toBeNull();
    expect(at('Text #todo[Add an example] more', 8)).toEqual([6, 27, 'call', 7, 'Add an example', false]);
    expect(at('#todo("fixme")', 2)?.[5]).toBe(false);
  });

  it('without a column, the line’s TODO; none in Markdown or plain text', () => {
    expect(at('The ship sailed. // todo cite')?.[2]).toBe('inline-comment');
    expect(at('See https://example.com//todo-list', 30)).toBeNull();
    expect(todoAt('TODO: pick a cover', 'notes.md', 1)).toBeNull();
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
