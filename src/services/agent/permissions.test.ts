import { describe, expect, it } from 'vitest';
import {
  onlyLooks,
  describePermissions,
  NO_COMPILE_RULES,
  presetOf,
  PRESETS,
  ruleEffect,
  sanitizePermissions,
  sessionRules,
  withoutHarmlessRedirects,
  type AgentPermissions,
  type PermissionRule,
} from './permissions';

/** Last matching rule wins (verified against OpenCode 2.0.20). */
const effect = (action: string, resource: string, rules: readonly PermissionRule[]) => ruleEffect(action, resource, rules) ?? 'none';

const ask = sessionRules(PRESETS.ask.permissions);
const edit = sessionRules(PRESETS.edit.permissions);
const ro = sessionRules(PRESETS.readonly.permissions);

describe('always', () => {
  it('denies Typst build commands, last, in every preset and mode', () => {
    for (const rules of [ask, edit, ro, sessionRules({ ...PRESETS.edit.permissions, shell: 'allow' }), sessionRules(PRESETS.edit.permissions, true)]) {
      for (const cmd of ['typst compile main.typ', 'typst c main.typ out.pdf', 'cd book && typst watch main.typ', 'tinymist compile main.typ', 'make', 'make pdf', 'cd book && make watch']) {
        expect(effect('shell', cmd, rules), cmd).toBe('deny');
      }
      expect(rules.slice(-NO_COMPILE_RULES.length)).toEqual([...NO_COMPILE_RULES]);
    }
  });

  it('allows reading the book and asking the author, asks for .env, and blocks subagents', () => {
    for (const rules of [ask, edit, ro]) {
      expect(effect('read', 'chapters/ch1.typ', rules)).toBe('allow');
      expect(effect('grep', 'x', rules)).toBe('allow');
      expect(effect('read', '.env', rules)).toBe('ask');
      expect(effect('subagent', 'explore', rules)).toBe('deny');
      expect(effect('question', 'q', rules)).toBe('allow');
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
    expect(effect('shell', 'python3 count.py', edit)).toBe('ask');
  });

  it('Read-only never changes anything', () => {
    expect(effect('edit', 'chapters/ch1.typ', ro)).toBe('deny');
    expect(effect('shell', 'python3 x.py', ro)).toBe('deny');
    expect(effect('shell', 'mv a b', ro)).toBe('deny');
    expect(effect('external_directory', '/etc', ro)).toBe('deny');
  });
});

describe('commands that only look', () => {
  // Each command of a chained line arrives on its own (as OpenCode splits them).
  const plan = sessionRules(PRESETS.edit.permissions, true);

  it('never ask, in any preset or mode (ls, cat, grep, git status…)', () => {
    for (const rules of [ask, edit, ro, plan]) {
      for (const cmd of ['ls', 'ls -la chapters', 'cat main.typ', 'head -5 chapters/a.typ', 'wc -l main.typ', 'grep -n Storm chapters/a.typ', 'rg lighthouse', 'find . -name "*.typ"', 'git status', 'git log --oneline -5', 'echo done', 'cd chapters']) {
        expect(effect('shell', cmd, rules), cmd).toBe('allow');
      }
    }
  });

  it('fall back to the shell setting when they would write', () => {
    for (const cmd of ['echo hi > notes.txt', 'cat a.typ >> b.typ', 'find . -name x -delete', 'find . -exec wc {} ;', 'sort -o sorted.txt main.typ', 'git diff --output=x.patch']) {
      expect(effect('shell', cmd, ask), cmd).toBe('ask');
      expect(effect('shell', cmd, plan), cmd).toBe('deny');
      expect(effect('shell', cmd, sessionRules({ ...PRESETS.ask.permissions, shell: 'allow' })), cmd).toBe('allow');
    }
  });

  it('keep other commands, and the delete and build rules, as they were', () => {
    // find -exec rm: the delete rule still has the last word.
    expect(effect('shell', 'find . -exec rm {} ;', sessionRules({ ...PRESETS.ask.permissions, shell: 'allow' }))).toBe('ask');
    expect(effect('shell', 'git commit -m x', ask)).toBe('ask');
    expect(effect('shell', 'git branch -D old', ask)).toBe('ask');
    expect(effect('shell', 'rm a.typ', sessionRules({ ...PRESETS.ask.permissions, delete: 'deny' }))).toBe('deny');
    expect(effect('shell', 'make', edit)).toBe('deny');
  });

  it('take more commands from the config file', () => {
    const rules = sessionRules(PRESETS.ask.permissions, false, ['python3']);
    expect(effect('shell', 'python3 count.py', rules)).toBe('allow');
    expect(effect('shell', 'python3 x.py > out.txt', rules)).toBe('ask');
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

describe('redirections that write nothing', () => {
  it('are taken out: into /dev/null, or one output into another', () => {
    expect(withoutHarmlessRedirects('ls -la . figures 2>&1')).toBe('ls -la . figures');
    expect(withoutHarmlessRedirects('cat style.typ 2>/dev/null')).toBe('cat style.typ');
    expect(withoutHarmlessRedirects('grep -r x . > /dev/null')).toBe('grep -r x .');
    expect(withoutHarmlessRedirects('find . -name "*.typ" &>/dev/null')).toBe('find . -name "*.typ"');
    // Into a file: stays.
    expect(withoutHarmlessRedirects('ls > out.txt 2>&1')).toBe('ls > out.txt');
    expect(withoutHarmlessRedirects('cat a 2>/dev/nullx')).toBe('cat a 2>/dev/nullx');
  });

  it('answer for the author only when the commands would be allowed without them', () => {
    const lookOnly = ['ls -la . figures 2>&1', 'echo', 'cat style.typ 2>/dev/null'];
    for (const rules of [ask, edit, ro]) expect(onlyLooks('shell', lookOnly, rules)).toBe(true);
    // Writing into a file, a command that isn't a look command, hidden commands, other actions: still ask.
    for (const cmd of ['ls > files.txt', 'ls 2>/dev/null > files.txt', 'python3 x.py 2>/dev/null', 'rm a 2>/dev/null', 'find . -delete 2>/dev/null', 'echo $(rm a) 2>/dev/null', 'typst compile main.typ 2>&1', 'sort a < b']) {
      expect(onlyLooks('shell', [cmd], edit), cmd).toBe(false);
    }
    expect(onlyLooks('edit', ['main.typ'], edit)).toBe(false);
    expect(onlyLooks('shell', [], edit)).toBe(false);
    // Commands the author allowed count too, but not in read-only modes.
    expect(onlyLooks('shell', ['python3 x.py 2>/dev/null'], sessionRules(PRESETS.edit.permissions, false, ['python3']))).toBe(true);
    expect(onlyLooks('shell', ['python3 x.py 2>/dev/null'], sessionRules(PRESETS.edit.permissions, true, ['python3']))).toBe(false);
    expect(onlyLooks('shell', ['ls 2>/dev/null'], sessionRules(PRESETS.edit.permissions, true, ['python3']))).toBe(true);
  });

  it('count sed printing line ranges as looking, and no other sed', () => {
    for (const cmd of ["sed -n '205,242p' chapters/ch01_what_is_a_vector.typ", 'sed -n 10p main.typ', `sed -n "1,20p;40,$p" a.typ b.typ`, "sed -n '5,9p' main.typ 2>/dev/null"]) {
      expect(onlyLooks('shell', [cmd], ask), cmd).toBe(true);
    }
    for (const cmd of ["sed -i 's/a/b/' main.typ", "sed -n '1,5w out.txt' main.typ", "sed -n '1,5p' main.typ > out.txt", "sed 's/a/b/' main.typ", "sed -n '1p' $(cat list)", "sed -n '1p;e rm x' a"]) {
      expect(onlyLooks('shell', [cmd], ask), cmd).toBe(false);
    }
  });
});
