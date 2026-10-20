import { describe, expect, it } from 'vitest';
import { claudeRules, codexRules } from './assistant-rules';

describe('claudeRules', () => {
  it('reads the allow and deny lists, commands apart from other tools', () => {
    const text = JSON.stringify({ permissions: { allow: ['Bash(npm run test:*)', 'Bash(git status)', 'Edit', 'WebFetch(domain:github.com)', 7], deny: ['Bash(git push:*)'] }, model: 'opus' });
    expect(claudeRules(text)).toEqual([
      { text: 'npm run test', command: true, more: true, effect: 'allow' },
      { text: 'git status', command: true, more: false, effect: 'allow' },
      { text: 'Edit', command: false, more: false, effect: 'allow' },
      { text: 'WebFetch(domain:github.com)', command: false, more: false, effect: 'allow' },
      { text: 'git push', command: true, more: true, effect: 'deny' },
    ]);
    expect(claudeRules('{ not json')).toEqual([]);
    expect(claudeRules('{"model":"opus"}')).toEqual([]);
  });
});

describe('codexRules', () => {
  it('reads prefix rules, a shell’s command opened', () => {
    const text = [
      'prefix_rule(pattern=["uv", "run"], decision="allow")',
      'prefix_rule(pattern=["rm", "-rf", "tmp"], decision="allow")',
      `prefix_rule(pattern=["/bin/zsh", "-lc", "uv run python -c $'print(\\"hi\\")\\\\nx = 1'"], decision="allow")`,
      'prefix_rule(pattern=["git", "push"], decision="forbidden")',
      '# a comment',
    ].join('\n');
    expect(codexRules(text)).toEqual([
      { text: 'uv run', command: true, more: true, effect: 'allow' },
      { text: 'rm -rf tmp', command: true, more: true, effect: 'allow' },
      { text: `uv run python -c $'print("hi")\\nx = 1'`, command: true, more: true, effect: 'allow' },
      { text: 'git push', command: true, more: true, effect: 'deny' },
    ]);
  });
});
