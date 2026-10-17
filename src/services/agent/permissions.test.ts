import { describe, expect, it } from 'vitest';
import { NO_COMPILE_RULES, SESSION_PERMISSIONS } from './opencode';

/** OpenCode's wildcard matching for permission resources (`*` = any run of characters). */
const matches = (pattern: string, value: string) =>
  new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(value);

/** Last matching rule wins (verified against OpenCode 2.0.20). */
function effect(action: string, resource: string) {
  let result = 'none';
  for (const r of SESSION_PERMISSIONS) {
    if ((r.action === '*' || r.action === action) && matches(r.resource, resource)) result = r.effect;
  }
  return result;
}

describe('session permissions', () => {
  it('deny Typst build commands outright, including inside compound commands', () => {
    for (const cmd of ['typst compile main.typ', 'typst c main.typ out.pdf', 'typst watch main.typ', 'cd book && typst compile main.typ', 'tinymist compile main.typ']) {
      expect(effect('shell', cmd), cmd).toBe('deny');
    }
  });

  it('still ask (not deny) for other shell commands, and allow reads', () => {
    expect(effect('shell', 'ls chapters')).toBe('ask');
    expect(effect('read', 'chapters/ch1.typ')).toBe('allow');
    expect(effect('edit', 'chapters/ch1.typ')).toBe('ask');
    expect(effect('read', '.env')).toBe('ask');
  });

  it('put the compile denials last so nothing later can re-allow them', () => {
    const tail = SESSION_PERMISSIONS.slice(-NO_COMPILE_RULES.length);
    expect(tail).toEqual([...NO_COMPILE_RULES]);
  });
});
