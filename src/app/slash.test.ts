import { describe, expect, it } from 'vitest';
import { parseSlash, slashMatches, slashToken, withoutSlash } from './slash';

describe('slash commands', () => {
  it('reads a command and its argument', () => {
    expect(parseSlash('/plan')).toEqual({ name: 'plan', arg: '' });
    expect(parseSlash('  /Model  claude sonnet ')).toEqual({ name: 'model', arg: 'claude sonnet' });
    expect(parseSlash('plan this chapter')).toBeNull();
    expect(parseSlash('/ path/to/x')).toBeNull();
  });

  it('lists matches while the name is typed, then stops', () => {
    expect(slashMatches('/').length).toBeGreaterThan(10);
    expect(slashMatches('/p').map((c) => c.name).slice(0, 3)).toEqual(['plan', 'permissions', 'pdf']);
    expect(slashMatches('/mod').map((c) => c.name)).toEqual(['model']);
    expect(slashMatches('/model son')).toEqual([]);
    expect(slashMatches('hello')).toEqual([]);
    // Words in the description count too.
    expect(slashMatches('/conversation').map((c) => c.name)).toContain('new');
  });

  it('lists them mid-message too, at the caret, but only the ones that run at once', () => {
    expect(slashMatches('rewrite this /opt').map((c) => c.name)).toEqual(['options']);
    expect(slashMatches('rewrite this\n/pl').map((c) => c.name)).toEqual(['plan']);
    // Arguments need the box to themselves.
    expect(slashMatches('rewrite this /effort')).toEqual([]);
    expect(slashMatches('rewrite this /p').map((c) => c.name)).not.toContain('permissions');
    // Before the rest of the message, with the caret after the name.
    const text = 'rewrite /pl this';
    expect(slashMatches(text, 'rewrite /pl'.length).map((c) => c.name)).toEqual(['plan']);
    expect(slashMatches(text)).toEqual([]);
    // Not inside a word: "and/or", paths, URLs.
    expect(slashMatches('this and/o')).toEqual([]);
    expect(slashMatches('see http:/')).toEqual([]);
    expect(slashMatches('/pl', 2)).toEqual([]);
    expect(slashMatches('/plxyz', 3)).toEqual([]);
  });

  it('takes the picked command out of the message', () => {
    const cut = (text: string, caret = text.length) => withoutSlash(text, slashToken(text, caret)!);
    expect(cut('rewrite this /opt')).toEqual({ text: 'rewrite this', caret: 12 });
    expect(cut('rewrite /pl this', 11)).toEqual({ text: 'rewrite this', caret: 8 });
    expect(cut('/pl this', 3)).toEqual({ text: 'this', caret: 0 });
    expect(cut('/plan')).toEqual({ text: '', caret: 0 });
    expect(cut('first line\n/opt')).toEqual({ text: 'first line', caret: 10 });
  });
});
