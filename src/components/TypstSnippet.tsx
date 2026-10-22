import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { passageSource, renderReason, renderTypst, svgHeightPt, type RenderedSnippet } from '../lib/typst-render';

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

/**
 * A Typst snippet drawn as it would print: inline (a formula in a sentence)
 * or as a block. As an image (a data: URL), so nothing in it can run. Until
 * it's ready, or if it doesn't compile, `fallback` shows instead.
 */
export function TypstSnippet({ source, inline, fallback = null, caption }: { source: string; inline: boolean; fallback?: ReactNode; caption?: string }) {
  const ink = useInk();
  const [result, setResult] = useState<RenderedSnippet | null>(null);
  useEffect(() => {
    let live = true;
    setResult(null);
    void renderTypst(source, ink, SIZE_PT).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [source, ink]);
  const pages = (result?.pages ?? []).filter((svg) => (svgHeightPt(svg) ?? 0) > 6); // more than the margins
  if (!pages.length) return <>{fallback}</>;
  const imgs = pages.map((svg, i) => (
    <img key={i} className={inline ? 'typst-inline' : 'typst-page'} src={svgUrl(svg)} alt={source} title={inline ? source : undefined} style={{ height: `${((svgHeightPt(svg) ?? SIZE_PT) / SIZE_PT) * SCALE}em` }} />
  ));
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
 * A passage for the book (an option to pick) as it would print: set as wide
 * as the box it's in, about the size of the text around it, so it wraps like a
 * paragraph. `failed` shows when it can't be set on its own (it uses
 * something only the book defines), with Typst's reason.
 */
export function TypstPassage({ source, failed }: { source: string; failed: (reason: string) => ReactNode }) {
  const ink = useInk();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // In steps, rounded down, so it fits and a small resize doesn't set it again.
    const measure = () => el.clientWidth && setWidth(Math.max(120, Math.floor((el.clientWidth * ptPerPx(parseFloat(getComputedStyle(el).fontSize))) / 20) * 20));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const [result, setResult] = useState<RenderedSnippet | null>(null);
  useEffect(() => {
    if (!width) return;
    let live = true;
    void renderTypst(passageSource(source, width), ink, SIZE_PT).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [source, ink, width]);
  const pages = (result?.pages ?? []).filter((svg) => (svgHeightPt(svg) ?? 0) > 6);
  return (
    <div ref={box} className="typst-passage">
      {!result ? (
        <span className="typst-passage-wait">Setting it…</span>
      ) : pages.length ? (
        pages.map((svg, i) => <img key={i} className="typst-page" src={svgUrl(svg)} alt={source} style={{ height: `${((svgHeightPt(svg) ?? SIZE_PT) / SIZE_PT) * PASSAGE_SCALE}em` }} />)
      ) : (
        failed(renderReason(result.error))
      )}
    </div>
  );
}
