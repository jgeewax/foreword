import { describe, expect, it } from 'vitest';
import { bookEntries, bookEntry, mentionedEntries, mentionedPaths, mentionMatches, mentionParts, mentionsIn, mentionToken, withMention } from './mentions';

const FILES = ['main.typ', 'chapters/01-intro.typ', 'chapters/02-vectors.typ', 'chapters/10-eigen.typ', 'figures/plot.png', 'figures/old/sketch.png', 'my notes/to do.md', 'refs.bib', '.foreword/attachments/x.png'];
const TITLES: Record<string, string> = { 'chapters/01-intro.typ': '1. Introduction', 'chapters/10-eigen.typ': '10. Eigenvalues' };
const title = (p: string) => TITLES[p];

describe('the @ being typed', () => {
  it('starts at the start of the box, after a space or a bracket, and runs to the caret', () => {
    expect(mentionToken('@')).toEqual({ from: 0, to: 1, typed: '', quoted: false });
    expect(mentionToken('is @figures/pl')).toEqual({ from: 3, to: 14, typed: 'figures/pl', quoted: false });
    expect(mentionToken('see (@chap')).toEqual({ from: 5, to: 10, typed: 'chap', quoted: false });
    expect(mentionToken('one\n@ma')?.typed).toBe('ma');
    // A path with spaces, in quotes.
    expect(mentionToken('read @"my notes/to')).toEqual({ from: 5, to: 18, typed: 'my notes/to', quoted: true });
  });

  it('is not an email address, a finished mention, or the middle of a word', () => {
    expect(mentionToken('mail jo@example.com')).toBeNull();
    expect(mentionToken('read @main.typ now')).toBeNull();
    expect(mentionToken('read @"my notes/to do.md" ')).toBeNull();
    expect(mentionToken('read @main.typ now', 'read @ma'.length)).toBeNull();
    expect(mentionToken('read @main.typ now', 'read @main.typ'.length)?.typed).toBe('main.typ');
  });
});

describe('mentions in a message', () => {
  it('finds each path, without quotes, a leading ./ or the sentence’s stop', () => {
    const text = 'Compare @chapters/01-intro.typ with @./main.typ. Then @"my notes/to do.md", (@figures/plot.png)';
    expect(mentionsIn(text).map((m) => m.path)).toEqual(['chapters/01-intro.typ', 'main.typ', 'my notes/to do.md', 'figures/plot.png']);
    const [first] = mentionsIn(text);
    expect(text.slice(first.from, first.to)).toBe('@chapters/01-intro.typ');
    expect(mentionsIn('mail jo@example.com')).toEqual([]);
  });

  it('keeps those that are the book’s files or folders, once each', () => {
    expect(bookEntry('main.typ', FILES)).toEqual({ path: 'main.typ', dir: false });
    expect(bookEntry('chapters/', FILES)).toEqual({ path: 'chapters', dir: true });
    expect(bookEntry('figures/old', FILES)).toEqual({ path: 'figures/old', dir: true });
    expect(bookEntry('chap', FILES)).toBeNull();
    // A Typst label isn't a file.
    expect(mentionedEntries('Why does @fig-plot fail? See @figures/plot.png and @figures/plot.png, and @chapters/.', FILES)).toEqual([
      { path: 'figures/plot.png', dir: false },
      { path: 'chapters', dir: true },
    ]);
  });

  it('cuts a sent message around the files that went with it', () => {
    const files = [{ path: 'main.typ' }, { path: 'chapters' }];
    expect(mentionParts('Is @main.typ ok? @fig-a and @chapters/.', files)).toEqual([
      { text: 'Is ' },
      { text: '@main.typ', path: 'main.typ' },
      { text: ' ok? @fig-a and ' },
      { text: '@chapters/', path: 'chapters' },
      { text: '.' },
    ]);
    expect(mentionParts('no mentions', files)).toEqual([{ text: 'no mentions' }]);
    expect([...mentionedPaths('Is @main.typ ok?', [...files, { path: 'figures/plot.png' }])]).toEqual(['main.typ']);
  });
});

describe('the list while @ is typed', () => {
  it('has the book’s files and their folders, not Foreword’s own', () => {
    const paths = bookEntries(FILES).map((e) => (e.dir ? `${e.path}/` : e.path));
    expect(paths).toContain('figures/old/');
    expect(paths).toContain('my notes/');
    expect(paths.some((p) => p.startsWith('.foreword'))).toBe(false);
  });

  it('starts with the files open, then the top of the book', () => {
    const rows = mentionMatches('', FILES, { recent: ['chapters/02-vectors.typ', 'main.typ'], title });
    expect(rows.map((r) => r.path)).toEqual(['chapters/02-vectors.typ', 'main.typ', 'chapters', 'figures', 'my notes', 'refs.bib']);
  });

  it('lists what’s in a folder once its / is typed', () => {
    expect(mentionMatches('chapters/', FILES).map((r) => r.path)).toEqual(['chapters/01-intro.typ', 'chapters/02-vectors.typ', 'chapters/10-eigen.typ']);
    expect(mentionMatches('figures/', FILES).map((r) => r.path)).toEqual(['figures/old', 'figures/plot.png']);
  });

  it('matches paths, and chapters by their heading', () => {
    expect(mentionMatches('plot', FILES)[0].path).toBe('figures/plot.png');
    expect(mentionMatches('vect', FILES)[0].path).toBe('chapters/02-vectors.typ');
    const eigen = mentionMatches('eigenval', FILES, { title });
    expect(eigen[0]).toMatchObject({ path: 'chapters/10-eigen.typ', inTitle: true, title: '10. Eigenvalues' });
    expect(mentionMatches('fig-plot', FILES)).toEqual([]);
  });

  it('puts a folder before its files when only the folder matches, even an open one', () => {
    const rows = mentionMatches('chap', FILES, { recent: ['chapters/02-vectors.typ'], title });
    expect(rows[0]).toMatchObject({ path: 'chapters', dir: true });
    // Hidden files only by name.
    expect(mentionMatches('', ['.foreword.json', 'main.typ']).map((r) => r.path)).toEqual(['main.typ']);
    expect(mentionMatches('.fore', ['.foreword.json', 'main.typ'])[0].path).toBe('.foreword.json');
  });
});

describe('picking from the list', () => {
  const pick = (text: string, path: string, dir = false, caret = text.length) => withMention(text, mentionToken(text, caret)!, { path, dir });

  it('writes the file’s path and a space', () => {
    expect(pick('is @pl', 'figures/plot.png')).toEqual({ text: 'is @figures/plot.png ', caret: 21 });
    // Before the rest of the message, past the space already there.
    expect(pick('is @pl clear?', 'figures/plot.png', false, 6)).toEqual({ text: 'is @figures/plot.png clear?', caret: 21 });
  });

  it('opens a folder, so the list goes on in it', () => {
    const r = pick('read @ch', 'chapters', true);
    expect(r).toEqual({ text: 'read @chapters/', caret: 15 });
    expect(mentionToken(r.text)?.typed).toBe('chapters/');
  });

  it('quotes a path with spaces', () => {
    const folder = pick('read @my', 'my notes', true);
    expect(folder.text).toBe('read @"my notes/');
    expect(pick(folder.text, 'my notes/to do.md').text).toBe('read @"my notes/to do.md" ');
    expect(mentionsIn('read @"my notes/to do.md" ').map((m) => m.path)).toEqual(['my notes/to do.md']);
  });
});
