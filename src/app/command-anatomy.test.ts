import { describe, expect, it } from 'vitest';
import { commandAnatomy, commandFacts, unwrapped } from './command-anatomy';

const parts = (command: string, root?: string) => commandAnatomy(command, root).parts.map((p) => [p.dir ? `${p.dir}${p.text}` : p.text, p.label]);
const patterns = (command: string) => commandAnatomy(command).choices.map((c) => c.pattern);
const suggested = (command: string) => commandAnatomy(command).choices.find((c) => c.suggested)?.pattern;

describe('commandAnatomy', () => {
  it('reads a script run through uv as the script, not as “uv”', () => {
    const a = commandAnatomy('uv run python src/scripts/lint.py 17');
    expect(parts('uv run python src/scripts/lint.py 17')).toEqual([
      ['uv run', 'through uv'],
      ['python', 'Python'],
      ['src/scripts/lint.py', 'the script, in this book'],
      ['17', 'argument'],
    ]);
    expect(a.parts[2]).toMatchObject({ dir: 'src/scripts/', text: 'lint.py' });
    expect([a.name, a.what, a.inline]).toEqual(['lint.py', ', a Python script in this book', false]);
    expect(a.choices.map((c) => [c.pattern, c.title, !!c.risk, !!c.danger, !!c.suggested])).toEqual([
      ['uv run python src/scripts/lint.py 17', 'Exactly this command', false, false, false],
      ['uv run python src/scripts/lint.py *', 'lint.py, with any arguments', false, false, true],
      ['uv run python *', 'Any Python script, through uv', true, false, false],
      ['uv run *', 'Anything through uv', true, true, false],
    ]);
  });

  it('keeps a wrapper’s own options with it', () => {
    expect(parts('uv run --package api python -m pytest -q')).toEqual([
      ['uv run --package api', 'through uv'],
      ['python', 'Python'],
      ['-m pytest', 'the module'],
      ['-q', 'option'],
    ]);
    expect(commandAnatomy('uv run --package api python -m pytest -q').name).toBe('pytest');
    expect(suggested('uv run --package api python -m pytest -q')).toBe('uv run --package api python -m pytest *');
    expect(parts('LANG=C time npx prettier --write chapters/a.md')).toEqual([
      ['LANG=C', 'setting'],
      ['time', 'timed'],
      ['npx', 'through npx'],
      ['prettier', 'the program'],
      ['--write chapters/a.md', 'arguments'],
    ]);
  });

  it('offers any code given the same way for code written on the spot, never this exact code', () => {
    const code = commandAnatomy(`python3 -c 'from pathlib import Path\np = Path("a.typ")\nprint(p.read_text())'`);
    expect([code.inline, code.lang, code.name, code.what]).toEqual([true, 'Python', '3 lines of Python', ' it just wrote']);
    expect(code.parts.map((p) => p.kind)).toEqual(['interpreter', 'code']);
    expect(code.choices.map((c) => [c.pattern, c.title, !!c.risk, !!c.danger, !!c.suggested])).toEqual([
      ['python3 -c *', 'Any Python code it writes', true, false, true],
      ['python3 *', 'Any Python script or code', true, false, false],
    ]);
    expect(commandAnatomy(`uv run python -c "\nimport numpy as np\nprint(np.eye(2) > 0)"`).choices.map((c) => [c.pattern, c.title, !!c.suggested])).toEqual([
      ['uv run python -c *', 'Any Python code it writes, through uv', true],
      ['uv run python *', 'Any Python script or code, through uv', false],
      ['uv run *', 'Anything through uv', false],
    ]);
    expect(patterns(`uv run --with numpy python -c "print(1)" extra`)).toEqual(['uv run --with numpy python -c *', 'uv run --with numpy python *', 'uv run --with numpy *']);
    expect(patterns('node -e "console.log(1)"')).toEqual(['node -e *', 'node *']);
    // A here-document's lines are left out of the rules, so only the interpreter's rule covers them.
    const heredoc = commandAnatomy("python3 <<'EOF'\nprint(1)\nprint(2)\nEOF");
    expect([heredoc.inline, heredoc.name, heredoc.choices.map((c) => c.pattern)]).toEqual([true, '2 lines of Python', ['python3 *']]);
    expect(commandAnatomy("cat > notes.txt <<'EOF'\nhi\nEOF").choices).toEqual([]);
  });

  it('opens a command a shell was given whole', () => {
    const a = commandAnatomy(`/bin/zsh -lc "uv run python lint.py 17"`);
    expect([a.command, a.wrappedIn, a.name]).toEqual(['uv run python lint.py 17', 'zsh -lc', 'lint.py']);
  });

  it('names a tool by what it does', () => {
    expect(parts('git -C book add chapters/1.typ')).toEqual([
      ['git -C book', 'Git'],
      ['add', 'what it does'],
      ['chapters/1.typ', 'a file'],
    ]);
    expect(commandAnatomy('git add chapters/1.typ').choices.map((c) => [c.title, !!c.suggested])).toEqual([
      ['Exactly this command', false],
      ['git add, with any arguments', true],
      ['Any git command', false],
    ]);
  });

  it('warns about broad rules for programs that delete or reach out, and suggests the exact one', () => {
    const rm = commandAnatomy('rm -rf build');
    expect(rm.choices.map((c) => [c.pattern, c.danger ?? false])).toEqual([
      ['rm -rf build', false],
      ['rm *', true],
    ]);
    expect(rm.choices.find((c) => c.suggested)?.pattern).toBe('rm -rf build');
    expect(suggested('pandoc a.md -o b.pdf')).toBe('pandoc *');
  });

  it('never offers a rule whose command has a wildcard in it', () => {
    expect(patterns('grep -c storm chapters/*.typ')).toEqual(['grep *']);
  });

  it('says whether a script is in the book', () => {
    expect(parts('python3 ../tools/x.py')[1]).toEqual(['../tools/x.py', 'the script']);
    expect(parts('python3 /b/tools/x.py', '/b')[1]).toEqual(['/b/tools/x.py', 'the script, in this book']);
    expect(commandAnatomy('bash scripts/build.sh').what).toBe(', a shell script in this book');
  });
});

describe('unwrapped', () => {
  it('drops what runs the program', () => {
    expect(unwrapped('uv run python src/scripts/lint.py 17')).toBe('python src/scripts/lint.py 17');
    expect(unwrapped('FOO=1 npx -p x y --z')).toBe('y --z');
    expect(unwrapped('zsh -lc "ls -la"')).toBe('ls -la');
    expect(unwrapped('ls -la')).toBe('ls -la');
    expect(unwrapped('npx')).toBe('npx');
  });
});

describe('commandFacts', () => {
  const facts = (line: string) => commandFacts(line, '/b').map((f) => f.text);
  it('says what a command line reaches beyond the book', () => {
    expect(facts('curl -L -o ~/Downloads/stix.zip https://github.com/stipub/x.zip')).toEqual(['Uses the internet: github.com', 'Outside the book: ~/Downloads/stix.zip']);
    expect(facts('uv run python lint.py 17 > report.txt 2>&1')).toEqual(['Writes report.txt']);
    expect(facts('python3 x.py > ~/out.txt')).toEqual(['Writes outside the book: ~/out.txt']);
    expect(facts('rm -rf build && git push')).toEqual(['Deletes files', 'Uses the internet']);
    expect(facts('ls /b/chapters 2>/dev/null')).toEqual([]);
    expect(facts('uv run python src/scripts/lint.py 17')).toEqual([]);
  });

  it('reads a < or > in quoted code as code, not as writing a file', () => {
    expect(facts(`uv run python -c "\nimport numpy as np\nif np.eye(2)[0,0] > 0: print('ok')\nprint(1 < 2)"`)).toEqual([]);
    expect(facts(`python3 -c "print(1 > 0)" > out.txt`)).toEqual(['Writes out.txt']);
  });
});
