// A small Myers diff (the algorithm behind `git diff`): the shortest edit
// script between two sequences, as runs of equal / deleted / inserted items.
// Used on lines, and on words within changed passages (prose diffs, mapping
// old line numbers onto the current text).

export type Run = { type: 'equal' | 'delete' | 'insert'; a: number; b: number; n: number };

/** Runs covering both sequences in order: `a` indexes into `before`, `b` into `after`. */
export function diff<T>(before: readonly T[], after: readonly T[], eq: (x: T, y: T) => boolean = Object.is): Run[] {
  // Common prefix and suffix first: most edits touch a small part of a file.
  let start = 0;
  while (start < before.length && start < after.length && eq(before[start], after[start])) start++;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && eq(before[endA - 1], after[endB - 1])) {
    endA--;
    endB--;
  }
  const runs: Run[] = [];
  const push = (type: Run['type'], a: number, b: number, n: number) => {
    if (n <= 0) return;
    const last = runs[runs.length - 1];
    if (last && last.type === type && last.a + (type === 'insert' ? 0 : last.n) === a && last.b + (type === 'delete' ? 0 : last.n) === b) last.n += n;
    else runs.push({ type, a, b, n });
  };
  push('equal', 0, 0, start);
  middle(before, after, start, endA, start, endB, eq, push);
  push('equal', endA, endB, before.length - endA);
  return runs;
}

function middle<T>(
  A: readonly T[],
  B: readonly T[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  eq: (x: T, y: T) => boolean,
  push: (type: Run['type'], a: number, b: number, n: number) => void,
) {
  const N = a1 - a0;
  const M = b1 - b0;
  if (N === 0) return push('insert', a0, b0, M);
  if (M === 0) return push('delete', a0, b0, N);
  const max = N + M;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // Before step d, only diagonals -d..d matter: keep just that band (memory O(D²), not O(D·(N+M))).
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && eq(A[a0 + x], B[b0 + y])) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
  }
  // Walk the trace back from (N, M) to (0, 0), then emit forwards.
  const steps: Run[] = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const vd = trace[d];
    // vd[i] is diagonal i - d.
    const at = (k: number) => vd[k + d];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const snake = Math.min(x - prevX - (down ? 0 : 1), y - prevY - (down ? 1 : 0));
    if (snake > 0) steps.push({ type: 'equal', a: x - snake, b: y - snake, n: snake });
    if (down) steps.push({ type: 'insert', a: prevX, b: prevY, n: 1 });
    else steps.push({ type: 'delete', a: prevX, b: prevY, n: 1 });
    x = prevX;
    y = prevY;
  }
  if (x > 0) steps.push({ type: 'equal', a: 0, b: 0, n: x });
  for (const s of steps.reverse()) push(s.type, a0 + s.a, b0 + s.b, s.n);
}

/** Lines of a text (a trailing newline doesn't make an extra empty line). */
export const splitLines = (text: string) => (text === '' ? [] : text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'));

/**
 * For each line of `before` (0-based), its line in `after` if that line is
 * unchanged, else -1.
 */
export function mapLines(before: readonly string[], after: readonly string[]): Int32Array {
  const map = new Int32Array(before.length).fill(-1);
  for (const r of diff(before, after)) if (r.type === 'equal') for (let i = 0; i < r.n; i++) map[r.a + i] = r.b + i;
  return map;
}
