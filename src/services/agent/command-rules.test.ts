import { describe, expect, it } from 'vitest';
import { commandPermissionRules, rulesFrom, rulesUsed, ruleCovers, sanitizeRules, type CommandRule } from './command-rules';
import { decide } from './acp-events';
import { PRESETS, sessionRules } from './permissions';
import { hideQuotedArrows, splitCommands, tokens } from './shell-words';

const lint: CommandRule = { pattern: 'uv run python src/scripts/lint.py *', effect: 'allow', scope: 'book' };
const figures: CommandRule = { pattern: 'python3 scripts/figures.py --all', effect: 'allow', scope: 'all' };
const push: CommandRule = { pattern: 'git push *', effect: 'deny', scope: 'all' };
const gitAll: CommandRule = { pattern: 'git *', effect: 'allow', scope: 'task' };

describe('rules', () => {
  it('cover the command, and with " *" what comes after it', () => {
    expect(ruleCovers(lint.pattern, 'uv run python src/scripts/lint.py')).toBe(true);
    expect(ruleCovers(lint.pattern, 'uv run python src/scripts/lint.py 17 --fix')).toBe(true);
    expect(ruleCovers(lint.pattern, 'uv run python src/scripts/lint.pyc')).toBe(false);
    expect(ruleCovers(figures.pattern, 'python3 scripts/figures.py --all')).toBe(true);
    expect(ruleCovers(figures.pattern, 'python3 scripts/figures.py --all --force')).toBe(false);
  });

  it('are read from the settings files, with the commands allowed by name before them', () => {
    expect(rulesFrom({ alwaysAllow: ['pandoc *', ' pandoc * ', 7, '', '*', '* *', 'a\nb'], allowCommands: ['python3', 'git log', 'rm -rf *'] })).toEqual({
      alwaysAllow: ['pandoc *', 'python3 *', 'git log *'],
      neverAllow: [],
    });
    expect(sanitizeRules(Array.from({ length: 300 }, (_, i) => `c${i} *`))).toHaveLength(200);
  });

  it('say which rules let a line run, command by command, a "never" over an "always"', () => {
    const rules = [lint, figures, gitAll, push];
    expect(rulesUsed('cd src && uv run python src/scripts/lint.py 17', rules)).toEqual([lint]);
    expect(rulesUsed('git push origin main', rules)).toEqual([push]);
    expect(rulesUsed('git add x && git commit -m "x"', rules)).toEqual([gitAll]);
    expect(rulesUsed('echo $(uv run python src/scripts/lint.py)', rules)).toEqual([]);
  });
});

describe('the rules in a conversation', () => {
  const rules = sessionRules(PRESETS.ask.permissions, false, commandPermissionRules([lint, figures, push, gitAll]));
  const shell = (line: string) => decide('shell', [line], rules);

  it('let the commands run, and only those', () => {
    expect(shell('uv run python src/scripts/lint.py 17')).toBe('allow');
    expect(shell('cd chapters && uv run python ../src/scripts/lint.py 17')).toBe('ask');
    expect(shell('ls chapters && uv run python src/scripts/lint.py 17 | tail -5')).toBe('allow');
    expect(shell('python3 scripts/figures.py --all')).toBe('allow');
    expect(shell('python3 scripts/figures.py --all && ls')).toBe('allow');
    expect(shell('python3 scripts/figures.py')).toBe('ask');
  });

  it('never let another command ride along', () => {
    for (const line of [
      'uv run python src/scripts/lint.py 17; rm -rf ~',
      'uv run python src/scripts/lint.py 17 && rm -rf ~',
      'uv run python src/scripts/lint.py 17 & rm -rf ~',
      'uv run python src/scripts/lint.py 17\nrm -rf ~',
      'uv run python src/scripts/lint.py $(rm -rf ~)',
      'uv run python src/scripts/lint.py `rm -rf ~`',
      'uv run python src/scripts/lint.py <(rm -rf ~)',
      'ls & rm x',
      'ls\nrm x',
    ]) {
      expect(shell(line), line).toBe('ask');
    }
    expect(shell('uv run python src/scripts/lint.py 17 2>&1 | tail')).toBe('allow');
  });

  it('let code written on the spot run, with < and > in it, but not writing into a file', () => {
    const code = sessionRules(PRESETS.ask.permissions, false, commandPermissionRules([lint, { pattern: 'uv run python -c *', effect: 'allow', scope: 'book' }]));
    const run = (line: string) => decide('shell', [line], code);
    const numpy = `uv run python -c "\nimport numpy as np\nP=np.array([[1,1],[-1j,1j]]);Pi=np.linalg.inv(P)\nprint(np.round(Pi,3)); print(abs(P[0,0]) > 0, 1 < 2)"`;
    expect(run(numpy)).toBe('allow');
    expect(run(`uv run python src/scripts/lint.py 17 2>&1 | rg -n "10[0-3][0-9]" | head -20; ${numpy}`)).toBe('allow');
    expect(run(`uv run python -c 'print(f(a)>(b))'`)).toBe('allow');
    for (const line of [
      `uv run python -c "print(1)" > ~/.zshrc`,
      `uv run python -c "print(1)"; rm -rf ~`,
      `uv run python -c "print($(rm -rf ~))"`,
      `uv run python -c "print(1)" <(rm -rf ~)`,
      `uv run python src/scripts/x.py`,
    ]) {
      expect(run(line), line).toBe('ask');
    }
  });

  it('keep a "never" over an "always", in every mode', () => {
    expect(shell('git push origin main')).toBe('deny');
    expect(shell('git status && git push')).toBe('deny');
    const readOnly = sessionRules(PRESETS.edit.permissions, true, commandPermissionRules([lint, push]));
    expect(decide('shell', ['uv run python src/scripts/lint.py 17'], readOnly)).toBe('deny');
    expect(decide('shell', ['git push'], readOnly)).toBe('deny');
  });

  it('never let the book be built, whatever the rules', () => {
    const anything = sessionRules(PRESETS.ask.permissions, false, commandPermissionRules([{ pattern: 'typst *', effect: 'allow', scope: 'all' }]));
    expect(decide('shell', ['typst compile main.typ'], anything)).toBe('deny');
  });
});

describe('splitCommands', () => {
  it('splits at a lone &, but not a redirection’s', () => {
    expect(splitCommands('a & b')).toEqual(['a', 'b']);
    expect(splitCommands('a 2>&1 | b')).toEqual(['a 2>&1', 'b']);
    expect(splitCommands('a &> log && b')).toEqual(['a &> log', 'b']);
    expect(splitCommands("echo 'a & b'")).toEqual(["echo 'a & b'"]);
  });
});

describe('hideQuotedArrows', () => {
  it('hides < and > in quotes only', () => {
    expect(hideQuotedArrows(`python3 -c "a > b" > out.txt`)).toBe(`python3 -c "a › b" > out.txt`);
    expect(hideQuotedArrows(`echo 'x<y' "say \\"a>b\\"" 2>&1`)).toBe(`echo 'x‹y' "say \\"a›b\\"" 2>&1`);
    expect(hideQuotedArrows(`echo \\"a > b`)).toBe(`echo \\"a > b`);
  });
});

describe('tokens', () => {
  it('keeps each word as typed, and what it means', () => {
    expect(tokens(`grep -n 'two words' "a \\"b\\"" c\\ d`).map((t) => [t.raw, t.value])).toEqual([
      ['grep', 'grep'],
      ['-n', '-n'],
      ["'two words'", 'two words'],
      ['"a \\"b\\""', 'a "b"'],
      ['c\\ d', 'c d'],
    ]);
  });
});
