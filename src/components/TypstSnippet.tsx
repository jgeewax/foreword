import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { passageSource, renderReason, renderTypst, svgHeightPt, svgWidthPt, type RenderedSnippet } from '../lib/typst-render';

/** Size the snippet is set in; shown in em, so it scales with the text around it. */
const SIZE_PT = 11;
/** Typst's math font reads lighter and smaller than the UI font at the same size. */
const SCALE = 1.2;

/** The page's text colour as #rrggbb (what the snippet is drawn in), following light and dark mode. */
function useInk(): string {
  const read = () => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--fg)';
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    probe.remove();
    return `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  };
  const [ink, setInk] = useState(read);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setInk(read());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return ink;
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The book's imports, which snippets are set with, so `$#vect("v")$` uses the book's own `vect` (null: no book, or it imports nothing). */
const useBook = () => useStore(studio.store, (s) => s.snippetBook);

/** An SVG's size, `scale` em per SIZE_PT: by its width, so a box too narrow for it shrinks it whole instead of squeezing it. */
function sized(svg: string, scale: number): CSSProperties {
  const w = svgWidthPt(svg);
  return w != null ? { width: `${(w / SIZE_PT) * scale}em` } : { height: `${((svgHeightPt(svg) ?? SIZE_PT) / SIZE_PT) * scale}em` };
}

/**
 * A Typst snippet drawn as it would print, with the book's definitions:
 * inline (a formula in a sentence) or as a block. As an image (a data: URL),
 * so nothing in it can run. Until it's ready, or if it doesn't compile,
 * `fallback` shows instead.
 */
export function TypstSnippet({ source, inline, fallback = null, caption }: { source: string; inline: boolean; fallback?: ReactNode; caption?: string }) {
  const ink = useInk();
  const book = useBook();
  const [result, setResult] = useState<RenderedSnippet | null>(null);
  useEffect(() => {
    let live = true;
    // What's shown stays until the new one is ready (the book's imports arriving, a theme change).
    void renderTypst(source, ink, SIZE_PT, book).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [source, ink, book]);
  const pages = (result?.pages ?? []).filter((svg) => (svgHeightPt(svg) ?? 0) > 6); // more than the margins
  if (!pages.length) return <>{fallback}</>;
  const imgs = pages.map((svg, i) => <img key={i} className={inline ? 'typst-inline' : 'typst-page'} src={svgUrl(svg)} alt={source} title={inline ? source : undefined} style={sized(svg, SCALE)} />);
  if (inline) return <>{imgs}</>;
  return (
    <div className="typst-block">
      {caption && <div className="typst-caption">{caption}</div>}
      {imgs}
    </div>
  );
}

/** A passage is prose, not maths: about the size of the text around it. */
const PASSAGE_SCALE = 1.05;
/** Points of a passage per CSS px of the text it sits in. */
const ptPerPx = (fontPx: number) => SIZE_PT / (PASSAGE_SCALE * fontPx);

/**
 * A passage (an option to pick, a Typst block in the chat) as it would print,
 * with the book's definitions: set as wide as the box it's in, about the size
 * of the text around it, so it wraps like a paragraph. `failed` shows when it
 * can't be set (it uses something only one chapter defines), with Typst's
 * reason; `waiting` until it's set. `caption` heads what it makes, and
 * `className` is the box's (padding included: the passage fits inside it).
 */
export function TypstPassage({
  source,
  failed,
  waiting = <span className="typst-passage-wait">Setting it…</span>,
  caption,
  className,
}: {
  source: string;
  failed: (reason: string) => ReactNode;
  waiting?: ReactNode;
  caption?: string;
  className?: string;
}) {
  const ink = useInk();
  const book = useBook();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // In steps, rounded down, so it fits and a small resize doesn't set it again.
      if (inner > 0) setWidth(Math.max(120, Math.floor((inner * ptPerPx(parseFloat(style.fontSize))) / 20) * 20));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const [result, setResult] = useState<RenderedSnippet | null>(null);
  useEffect(() => {
    if (!width) return;
    let live = true;
    void renderTypst(passageSource(source, width), ink, SIZE_PT, book).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [source, ink, width, book]);
  const pages = (result?.pages ?? []).filter((svg) => (svgHeightPt(svg) ?? 0) > 6);
  return (
    <div ref={box} className={className ? `typst-passage ${className}` : 'typst-passage'}>
      {!result ? (
        waiting
      ) : pages.length ? (
        <>
          {caption && <div className="typst-caption">{caption}</div>}
          {pages.map((svg, i) => (
            <img key={i} className="typst-page" src={svgUrl(svg)} alt={source} style={sized(svg, PASSAGE_SCALE)} />
          ))}
        </>
      ) : (
        failed(renderReason(result.error))
      )}
    </div>
  );
}
