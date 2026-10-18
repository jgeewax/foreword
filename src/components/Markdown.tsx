import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../lib/markdown';
import { mathSource } from '../lib/typst-render';
import { TypstSnippet } from './TypstSnippet';

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
        // Typst math, drawn; as written if it doesn't compile (LaTeX, say).
        return <TypstSnippet key={k} source={mathSource(n.v)} inline fallback={<code className="md-math">{n.v}</code>} />;
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
      // Typst blocks keep their source (it may be markup to copy) and show what it makes.
      if (/^(typst|typ)$/i.test(b.lang ?? '')) {
        return (
          <div key={k} className="md-typst">
            <pre className="md-code" data-lang={b.lang}>{b.v}</pre>
            <TypstSnippet source={b.v} inline={false} caption="Renders as" />
          </div>
        );
      }
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

/** A line of the assistant's (an option of its question): emphasis, code and Typst math, with no paragraphs. */
export const MarkdownLine = memo(function MarkdownLine({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const lines = blocks.flatMap((b) => (b.t === 'para' || b.t === 'heading' ? [b.c] : []));
  // Anything bigger (a list, a code block) as it was written.
  if (lines.length !== blocks.length) return <>{text}</>;
  return (
    <>
      {lines.map((c, k) => (
        <Fragment key={k}>
          {k > 0 && ' '}
          {inlines(c)}
        </Fragment>
      ))}
    </>
  );
});
