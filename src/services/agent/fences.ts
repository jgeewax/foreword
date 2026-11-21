// Fenced blocks in a reply, where the chat reads one (an option, a change).
// What they hold is Typst, which can have raw blocks of its own (```python …
// ``` in a callout), and an assistant rarely makes the outer fence longer for
// them as Markdown would have it. So inside a block, a fence line with a
// language opens a raw block, and a bare one closes the innermost still open;
// only a bare fence with nothing open inside closes the block.

const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^`\n]*?)[ \t]*$/;

/** A line's fence, when it's one: the run of backticks or tildes, and what follows it (the language). */
export function fenceOf(line: string): { fence: string; info: string } | null {
  const m = FENCE.exec(line);
  return m ? { fence: m[1], info: m[2] } : null;
}

/**
 * The line that closes the block `lines[open]` opens: a bare fence of the same
 * kind, at least as long, that doesn't close a raw block opened inside it. -1
 * while it's still open (or `lines[open]` isn't a fence).
 */
export function closingFence(lines: readonly string[], open: number): number {
  const outer = fenceOf(lines[open] ?? '');
  if (!outer) return -1;
  // The raw blocks open inside it, innermost last: how long each one's fence is.
  const inner: number[] = [];
  for (let i = open + 1; i < lines.length; i++) {
    const f = fenceOf(lines[i]);
    if (!f || f.fence[0] !== outer.fence[0]) continue;
    if (f.info) inner.push(f.fence.length);
    else if (inner.length) {
      if (f.fence.length >= inner[inner.length - 1]) inner.pop();
    } else if (f.fence.length >= outer.fence.length) return i;
  }
  return -1;
}
