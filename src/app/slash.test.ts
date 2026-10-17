import { describe, expect, it } from 'vitest';
import { parseSlash, slashMatches } from './slash';

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
});
