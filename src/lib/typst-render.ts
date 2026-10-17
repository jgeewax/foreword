// Typst snippets rendered to SVG for showing outside the book (chat replies,
// review comments). Requests in the same moment go to the app in one call;
// results are kept, so a reply re-rendering doesn't compile again.
import { ipc } from './ipc';

export type RenderedSnippet = { pages: string[]; error: string | null };

const cache = new Map<string, Promise<RenderedSnippet>>();
const MAX_CACHED = 400;
let queue: { source: string; fill: string; sizePt: number; resolve: (r: RenderedSnippet) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  timer = undefined;
  const jobs = queue;
  queue = [];
  // One call per colour and size, at most 40 snippets each.
  const groups = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const key = `${j.fill}|${j.sizePt}`;
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += 40) {
      const chunk = group.slice(i, i + 40);
      ipc
        .typstRender(
          chunk.map((j) => j.source),
          chunk[0].fill,
          chunk[0].sizePt,
        )
        .then((results) => chunk.forEach((j, k) => j.resolve(results[k] ?? { pages: [], error: 'not rendered' })))
        .catch((e) => chunk.forEach((j) => j.resolve({ pages: [], error: String(e?.message ?? e) })));
    }
  }
}

/** A snippet's SVG pages in `fill` (#rrggbb) at `sizePt`; never rejects. */
export function renderTypst(source: string, fill: string, sizePt = 11): Promise<RenderedSnippet> {
  const key = `${fill}|${sizePt}|${source}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = new Promise<RenderedSnippet>((resolve) => {
    queue.push({ source, fill, sizePt, resolve });
    timer ??= setTimeout(flush, 15);
  });
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(key, p);
  return p;
}

/** A Markdown math span (`$x$`, `$ x $`, `$$x$$`) as a Typst snippet: `$$…$$` is display math. */
export function mathSource(span: string): string {
  const display = /^\$\$([\s\S]*)\$\$$/.exec(span);
  return display ? `$ ${display[1].trim()} $` : span;
}

/** An SVG's height in points (Typst writes `height="17.952pt"`). */
export function svgHeightPt(svg: string): number | null {
  const m = /<svg[^>]*\sheight="([\d.]+)pt"/.exec(svg);
  return m ? Number(m[1]) : null;
}
