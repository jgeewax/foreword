import { useEffect, useState, type ReactNode } from 'react';
import { renderTypst, svgHeightPt, type RenderedSnippet } from '../lib/typst-render';

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
