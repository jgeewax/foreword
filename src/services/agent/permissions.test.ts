import { describe, expect, it } from 'vitest';
import { NO_COMPILE_RULES, SESSION_PERMISSIONS, sessionPermissions } from './opencode';

/** OpenCode's wildcard matching for permission resources (`*` = any run of characters). */
const matches = (pattern: string, value: string) =>
  new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(value);

/** Last matching rule wins (verified against OpenCode 2.0.20). */
function effect(action: string, resource: string, rules: readonly { action: string; resource: string; effect: string }[] = SESSION_PERMISSIONS) {
  let result = 'none';
  for (const r of rules) {
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

describe('edit policy', () => {
  const ask = sessionPermissions({ allowEdits: false });
  const allow = sessionPermissions({ allowEdits: true });

  it('asks before edits by default (the same rules as before)', () => {
    expect(ask).toEqual([...SESSION_PERMISSIONS]);
    expect(effect('edit', 'chapters/ch1.typ', ask)).toBe('ask');
  });

  it('allows edits and new files without asking when enabled, except .env files', () => {
    expect(effect('edit', 'chapters/ch1.typ', allow)).toBe('allow');
    expect(effect('edit', 'chapters/new-chapter.typ', allow)).toBe('allow');
    expect(effect('edit', '.env', allow)).toBe('ask');
    expect(effect('edit', 'config/.env.local', allow)).toBe('ask');
  });

  it('never lets auto-edit re-enable compiling or other shell commands', () => {
    expect(effect('shell', 'typst compile main.typ', allow)).toBe('deny');
    expect(effect('shell', 'ls', allow)).toBe('ask');
    expect(allow.slice(-NO_COMPILE_RULES.length)).toEqual([...NO_COMPILE_RULES]);
  });
});

describe('plan mode', () => {
  it('blocks edits and commands even with auto-edit on, and keeps reading allowed', () => {
    for (const allowEdits of [false, true]) {
      const plan = sessionPermissions({ allowEdits, planning: true });
      expect(effect('edit', 'chapters/ch1.typ', plan)).toBe('deny');
      expect(effect('edit', 'chapters/new.typ', plan)).toBe('deny');
      expect(effect('shell', 'ls', plan)).toBe('deny');
      expect(effect('read', 'chapters/ch1.typ', plan)).toBe('allow');
      expect(plan.slice(-NO_COMPILE_RULES.length)).toEqual([...NO_COMPILE_RULES]);
    }
  });
});
