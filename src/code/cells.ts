// Runnable code examples: `#run("name", ```lang …```, expect: "…")` in .typ
// files (helper: code.typ). Parsing mirrors Typst's raw-block text (the
// newline after the opening fence and before the closing one dropped, common
// indentation removed), so the code stored with an output is exactly the code
// Typst compares against. Outputs live in code-output/outputs.json.

export const OUTPUTS_FILE = 'code-output/outputs.json';
export const HELPER_FILE = 'code.typ';

export type CodeCell = {
  name: string;
  lang: string;
  code: string;
  expect: string | null;
  path: string;
  /** 1-based line of `#run(`. */
  line: number;
};

export type CodeOutput = {
  code: string;
  lang: string;
  stdout: string;
  stderr: string;
  exit: number | null;
  timedOut?: boolean;
  durationMs?: number;
  ranAt?: string;
};

export type Outputs = Record<string, CodeOutput>;

export type CellStatus = 'not-run' | 'ok' | 'outdated' | 'failed' | 'mismatch';

/** Typst's raw-block text: the lines between the fences, with common indentation removed. */
export function rawText(body: string): string {
  const lines = body.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(Math.min(cut, /^[ \t]*/.exec(l)![0].length))).join('\n');
}

/** A Typst string literal's value (common escapes). */
function unescape(s: string): string {
  return s.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (_, c: string, hex?: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[c] ?? c,
  );
}

const RUN = /#run\(\s*"((?:[^"\\]|\\.)*)"\s*,/g;

export function parseCells(text: string, path: string): CodeCell[] {
  const cells: CodeCell[] = [];
  for (const m of text.matchAll(RUN)) {
    const after = m.index! + m[0].length;
    // The raw block: ``` (or more), a language tag, a newline, the body, the same fence.
    const open = /^([^`]*?)(`{3,})([^\n`]*)\n/.exec(text.slice(after));
    if (!open || open[1].includes(')')) continue;
    const fence = open[2];
    const bodyStart = after + open[0].length;
    const close = new RegExp(`\\n[ \\t]*${fence}(?!\`)`).exec(text.slice(bodyStart));
    if (!close) continue;
    const body = text.slice(bodyStart, bodyStart + close.index);
    // Named arguments around the raw block, up to the call's closing parenthesis.
    const restStart = bodyStart + close.index + close[0].length;
    const rest = text.slice(restStart, restStart + 400);
    const end = rest.indexOf(')');
    const args = `${open[1]} ${end >= 0 ? rest.slice(0, end) : ''}`;
    const expect = /expect:\s*"((?:[^"\\]|\\.)*)"/.exec(args);
    cells.push({
      name: unescape(m[1]),
      lang: open[3].trim(),
      code: rawText(body),
      expect: expect ? unescape(expect[1]) : null,
      path,
      line: text.slice(0, m.index).split('\n').length,
    });
  }
  return cells;
}

/** Same rules as code.typ, so the app and the book agree. */
export function cellStatus(cell: CodeCell, out: CodeOutput | undefined): CellStatus {
  if (!out) return 'not-run';
  if (out.code.trim() !== cell.code.trim()) return 'outdated';
  if (out.exit !== 0) return 'failed';
  if (cell.expect != null && out.stdout.trim() !== cell.expect.trim()) return 'mismatch';
  return 'ok';
}

export function parseOutputs(text: string): Outputs {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Outputs) : {};
  } catch {
    return {};
  }
}

/** Stable JSON (sorted names) so the file diffs cleanly in History and Git. */
export function serializeOutputs(outputs: Outputs): string {
  const sorted: Outputs = {};
  for (const k of Object.keys(outputs).sort()) sorted[k] = outputs[k];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** One line per problem, for the chat ("fib: expected 55, got 54"). */
export function describeProblem(cell: CodeCell, out: CodeOutput | undefined): string {
  switch (cellStatus(cell, out)) {
    case 'not-run':
      return `${cell.name}: not run`;
    case 'outdated':
      return `${cell.name}: out of date`;
    case 'failed':
      return `${cell.name}: ${out!.timedOut ? 'timed out' : `failed (exit ${out!.exit})`}${out!.stderr.trim() ? `: ${out!.stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`;
    case 'mismatch':
      return `${cell.name}: expected ${JSON.stringify(cell.expect!.trim())}, got ${JSON.stringify(out!.stdout.trim())}`;
    case 'ok':
      return `${cell.name}: ok`;
  }
}

/** Names used by more than one example (each needs its own output). */
export function duplicateNames(cells: CodeCell[]): string[] {
  const seen = new Map<string, number>();
  for (const c of cells) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([name]) => name);
}
