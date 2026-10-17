import { describe, expect, it } from 'vitest';
import { describePermissions, NO_COMPILE_RULES, presetOf, PRESETS, sanitizePermissions, sessionRules, type AgentPermissions, type PermissionRule } from './permissions';

/** OpenCode's wildcard matching for permission resources (`*` = any run of characters). */
const matches = (pattern: string, value: string) =>
  new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(value);

/** Last matching rule wins (verified against OpenCode 2.0.20). */
function effect(action: string, resource: string, rules: readonly PermissionRule[]) {
  let result = 'none';
  for (const r of rules) if ((r.action === '*' || r.action === action) && matches(r.resource, resource)) result = r.effect;
  return result;
}

const ask = sessionRules(PRESETS.ask.permissions);
const edit = sessionRules(PRESETS.edit.permissions);
const ro = sessionRules(PRESETS.readonly.permissions);

describe('always', () => {
  it('denies Typst build commands, last, in every preset and mode', () => {
    for (const rules of [ask, edit, ro, sessionRules({ ...PRESETS.edit.permissions, shell: 'allow' }), sessionRules(PRESETS.edit.permissions, true)]) {
      for (const cmd of ['typst compile main.typ', 'typst c main.typ out.pdf', 'cd book && typst watch main.typ', 'tinymist compile main.typ']) {
        expect(effect('shell', cmd, rules), cmd).toBe('deny');
      }
      expect(rules.slice(-NO_COMPILE_RULES.length)).toEqual([...NO_COMPILE_RULES]);
    }
  });

  it('allows reading the book, asks for .env, and blocks subagents and the question tool', () => {
    for (const rules of [ask, edit, ro]) {
      expect(effect('read', 'chapters/ch1.typ', rules)).toBe('allow');
      expect(effect('grep', 'x', rules)).toBe('allow');
      expect(effect('read', '.env', rules)).toBe('ask');
      expect(effect('subagent', 'explore', rules)).toBe('deny');
      expect(effect('question', 'q', rules)).toBe('deny');
      expect(effect('something-new', 'x', rules)).toBe('ask');
    }
  });
});

describe('presets', () => {
  it('Ask first asks for everything that changes or reaches out', () => {
    expect(effect('edit', 'chapters/ch1.typ', ask)).toBe('ask');
    expect(effect('shell', 'mv a.typ b.typ', ask)).toBe('ask');
    expect(effect('shell', 'rm a.typ', ask)).toBe('ask');
    expect(effect('external_directory', '/Users/x/Desktop', ask)).toBe('ask');
    expect(effect('webfetch', 'https://typst.app', ask)).toBe('ask');
  });

  it('Edit freely edits, creates and renames in the book, but still asks to delete or run commands', () => {
    expect(effect('edit', 'chapters/new.typ', edit)).toBe('allow');
    expect(effect('edit', '.env', edit)).toBe('ask');
    expect(effect('shell', 'mv chapters/a.typ chapters/b.typ', edit)).toBe('allow');
    expect(effect('shell', 'git mv a b', edit)).toBe('allow');
    expect(effect('shell', 'rm chapters/a.typ', edit)).toBe('ask');
    expect(effect('shell', 'ls', edit)).toBe('ask');
  });

  it('Read-only never changes anything', () => {
    expect(effect('edit', 'chapters/ch1.typ', ro)).toBe('deny');
    expect(effect('shell', 'ls', ro)).toBe('deny');
    expect(effect('shell', 'mv a b', ro)).toBe('deny');
    expect(effect('external_directory', '/etc', ro)).toBe('deny');
  });
});

describe('fine-grained', () => {
  const p = (over: Partial<AgentPermissions>) => sessionRules({ ...PRESETS.ask.permissions, ...over });

  it('blocks deletion even inside chained commands when shell is allowed', () => {
    const rules = p({ shell: 'allow', delete: 'deny' });
    expect(effect('shell', 'ls -la', rules)).toBe('allow');
    for (const cmd of ['rm a.typ', 'cd chapters && rm a.typ', 'ls;rm a', 'find . | xargs rm -f', 'git rm a.typ', 'rmdir old']) {
      expect(effect('shell', cmd, rules), cmd).toBe('deny');
    }
  });

  it('separates web access and outside files', () => {
    const rules = p({ web: 'allow', outside: 'deny' });
    expect(effect('websearch', 'typst footnotes', rules)).toBe('allow');
    expect(effect('webfetch', 'https://typst.app/docs', rules)).toBe('allow');
    expect(effect('external_directory', '/Users/x/Documents/other', rules)).toBe('deny');
  });

  it('Plan and Options stay read-only whatever the settings', () => {
    const rules = sessionRules({ ...PRESETS.edit.permissions, shell: 'allow' }, true);
    expect(effect('edit', 'chapters/ch1.typ', rules)).toBe('deny');
    expect(effect('shell', 'mv a b', rules)).toBe('deny');
    expect(effect('read', 'chapters/ch1.typ', rules)).toBe('allow');
  });
});

describe('presets and descriptions', () => {
  it('recognises presets and custom mixes', () => {
    expect(presetOf(PRESETS.edit.permissions)).toBe('edit');
    expect(presetOf({ ...PRESETS.ask.permissions, web: 'allow' })).toBe('custom');
    expect(describePermissions(PRESETS.readonly.permissions)).toMatch(/^Permissions: Read-only/);
    expect(describePermissions({ ...PRESETS.ask.permissions, web: 'allow', delete: 'deny' })).toBe(
      'Permissions changed (allowed: search and read the web; asks first: edit and create files, rename or move files, files outside this book, run other commands; never: delete files).',
    );
  });

  it('sanitizes stored values', () => {
    expect(sanitizePermissions({ edit: 'allow', web: 'yes', junk: 1 })).toEqual({ ...PRESETS.ask.permissions, edit: 'allow' });
    expect(sanitizePermissions('nope')).toBeNull();
  });
});
