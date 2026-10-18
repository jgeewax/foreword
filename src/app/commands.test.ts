import { describe, expect, it } from 'vitest';
import { commandLabel, rankCommands, withRecent, type Command } from './commands';

const cmd = (category: string, title: string, more: Partial<Command> = {}): Command => ({ id: `${category}:${title}`, category, title, run: () => {}, ...more });

const commands = [
  cmd('File', 'Save'),
  cmd('File', 'Save All'),
  cmd('File', 'Revert File', { keywords: ['reload from disk'] }),
  cmd('Edit', 'Format Document'),
  cmd('Book', 'Export PDF…'),
  cmd('Book', 'Open Exported PDF'),
  cmd('Preview', 'Restart Preview', { keywords: ['reload preview'] }),
  cmd('Window', 'Reload Window'),
  cmd('Source Control', 'Stage All Changes'),
];
const titles = (rows: ReturnType<typeof rankCommands>) => rows.map((r) => commandLabel(r.command));

describe('the command palette', () => {
  it('lists recently used commands first, then the rest by name', () => {
    const rows = rankCommands(commands, '', ['Window:Reload Window', 'Edit:Format Document', 'gone:Not a command']);
    expect(titles(rows).slice(0, 4)).toEqual(['Window: Reload Window', 'Edit: Format Document', 'Book: Export PDF…', 'Book: Open Exported PDF']);
    expect(rows.map((r) => r.recent).slice(0, 3)).toEqual([true, true, false]);
    expect(rows).toHaveLength(commands.length);
  });

  it('matches the title alone or with its menu, and highlights it in the label', () => {
    expect(titles(rankCommands(commands, 'format', []))[0]).toBe('Edit: Format Document');
    expect(titles(rankCommands(commands, 'export pdf', []))[0]).toBe('Book: Export PDF…');
    const [save] = rankCommands(commands, 'save', []);
    expect(commandLabel(save.command)).toBe('File: Save');
    expect(save.positions.map((p) => save.label[p]).join('')).toBe('Save');
    // By its menu: "book" finds both of Book's.
    expect(titles(rankCommands(commands, 'book', [])).slice(0, 2).sort()).toEqual(['Book: Export PDF…', 'Book: Open Exported PDF']);
  });

  it('finds commands by their other words, below a match in the title', () => {
    const rows = rankCommands(commands, 'reload', []);
    expect(titles(rows)[0]).toBe('Window: Reload Window');
    expect(titles(rows).slice(1).sort()).toEqual(['File: Revert File', 'Preview: Restart Preview']);
    // A keyword match highlights nothing (the word isn't in the label).
    expect(rows[1].positions).toEqual([]);
  });

  it('leaves out what doesn’t match, letters scattered through words too', () => {
    expect(rankCommands(commands, 'zzz', [])).toEqual([]);
    // s…a…v…e are all in "Preview: Restart Preview", but not as the starts of words.
    expect(titles(rankCommands(commands, 'save', []))).toEqual(['File: Save', 'File: Save All']);
    expect(titles(rankCommands(commands, 'show', []))).toEqual([]);
  });

  it('ranks a recently used command a little higher', () => {
    expect(titles(rankCommands(commands, 'pdf', []))[0]).toBe('Book: Export PDF…');
    expect(titles(rankCommands(commands, 'pdf', ['Book:Open Exported PDF']))[0]).toBe('Book: Open Exported PDF');
  });

  it('remembers the newest first, once each, a few at most', () => {
    expect(withRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    const many = Array.from({ length: 12 }, (_, i) => `c${i}`);
    expect(withRecent(many, 'new')).toHaveLength(8);
    expect(withRecent(many, 'new')[0]).toBe('new');
  });
});
