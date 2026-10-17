import { describe, expect, it } from 'vitest';
import { cellStatus, describeProblem, duplicateNames, parseCells, parseOutputs, rawText, serializeOutputs, type CodeOutput } from './cells';

const DOC = `= Examples

#run("fib", \`\`\`python
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
print(fib(10))
\`\`\`, expect: "55")

- In a list:
  #run("indented", \`\`\`bash
  echo "a \\"quoted\\" word"
  \`\`\`)

#run("with \\"quotes\\"", expect: "x\\ny", \`\`\`\`js
console.log("x\\ny")
\`\`\`\`)
`;

describe('parseCells', () => {
  const cells = parseCells(DOC, 'chapters/01.typ');

  it('finds each example with its name, language, code, expectation and line', () => {
    expect(cells.map((c) => [c.name, c.lang, c.expect, c.line])).toEqual([
      ['fib', 'python', '55', 3],
      ['indented', 'bash', null, 10],
      ['with "quotes"', 'js', 'x\ny', 14],
    ]);
  });

  it("gives the code exactly as Typst's raw text (dedented, without the fence newlines)", () => {
    expect(cells[0].code).toBe('def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\nprint(fib(10))');
    expect(cells[1].code).toBe('echo "a \\"quoted\\" word"');
    expect(cells[2].code).toBe('console.log("x\\ny")');
  });

  it('ignores calls without a raw block', () => {
    expect(parseCells('#run("x", y)\n#run("z")', 'a.typ')).toEqual([]);
  });

  it('dedents like Typst', () => {
    expect(rawText('    a\n      b\n\n    c')).toBe('a\n  b\n\nc');
  });
});

describe('status', () => {
  const [fib] = parseCells(DOC, 'a.typ');
  const out = (o: Partial<CodeOutput>): CodeOutput => ({ code: fib.code, lang: 'python', stdout: '55\n', stderr: '', exit: 0, ...o });

  it('follows the same rules as code.typ', () => {
    expect(cellStatus(fib, undefined)).toBe('not-run');
    expect(cellStatus(fib, out({}))).toBe('ok');
    expect(cellStatus(fib, out({ code: 'print(1)' }))).toBe('outdated');
    expect(cellStatus(fib, out({ code: `\n${fib.code}\n` }))).toBe('ok');
    expect(cellStatus(fib, out({ exit: 1, stderr: 'Traceback\nValueError: x\n' }))).toBe('failed');
    expect(cellStatus(fib, out({ stdout: '54\n' }))).toBe('mismatch');
  });

  it('describes problems in one line', () => {
    expect(describeProblem(fib, out({ stdout: '54\n' }))).toBe('fib: expected "55", got "54"');
    expect(describeProblem(fib, out({ exit: 1, stderr: 'Traceback\nValueError: x\n' }))).toBe('fib: failed (exit 1): Traceback ValueError: x');
    expect(describeProblem(fib, out({ exit: null, timedOut: true, stderr: 'Stopped after 30 seconds.' }))).toBe('fib: timed out: Stopped after 30 seconds.');
  });
});

describe('outputs file', () => {
  it('round-trips with sorted names and tolerates bad JSON', () => {
    const text = serializeOutputs({ b: { code: '', lang: 'sh', stdout: '', stderr: '', exit: 0 }, a: { code: '', lang: 'sh', stdout: '', stderr: '', exit: 0 } });
    expect(Object.keys(parseOutputs(text))).toEqual(['a', 'b']);
    expect(parseOutputs('nope')).toEqual({});
    expect(parseOutputs('[1]')).toEqual({});
  });

  it('finds duplicate names', () => {
    expect(duplicateNames([...parseCells(DOC, 'a.typ'), ...parseCells(DOC, 'b.typ')]).sort()).toEqual(['fib', 'indented', 'with "quotes"']);
  });
});
