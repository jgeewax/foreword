import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../lib/markdown';

function inlines(nodes: Inline[]): ReactNode {
  return nodes.map((n, k) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={k}>{n.v}</Fragment>;
      case 'strong':
        return <strong key={k}>{inlines(n.c)}</strong>;
      case 'em':
        return <em key={k}>{inlines(n.c)}</em>;
      case 'code':
        return <code key={k}>{n.v}</code>;
      case 'math':
        return <code key={k} className="md-math">{n.v}</code>;
      case 'link':
        // Never navigate the app's webview; show where it points instead.
        return <span key={k} className="md-link" title={n.href}>{inlines(n.c)}</span>;
      case 'br':
        return <br key={k} />;
    }
  });
}

function block(b: Block, k: number): ReactNode {
  switch (b.t) {
    case 'heading': {
      const H = `h${Math.min(b.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6';
      return <H key={k}>{inlines(b.c)}</H>;
    }
    case 'para':
      return <p key={k}>{inlines(b.c)}</p>;
    case 'list': {
      const items = b.items.map((c, j) => <li key={j}>{inlines(c)}</li>);
      return b.ordered ? <ol key={k} start={b.start}>{items}</ol> : <ul key={k}>{items}</ul>;
    }
    case 'quote':
      return <blockquote key={k}>{inlines(b.c)}</blockquote>;
    case 'code':
      return <pre key={k} className="md-code" data-lang={b.lang || undefined}>{b.v}</pre>;
    case 'hr':
      return <hr key={k} />;
  }
}

/** Renders an assistant reply's Markdown as React elements (no HTML injection). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <>{blocks.map(block)}</>;
});
