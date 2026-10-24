import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { studio } from '../app/studio';
import { parseMarkdown, type Block, type Inline } from '../lib/markdown';
import { bookFiles, linkBlocks, refTitle, type BookFiles, type SourceRef } from '../lib/source-links';
import { useStore } from '../lib/store';
import { mathSource } from '../lib/typst-render';
import { ChartBlock } from './Chart';
import { TypstPassage, TypstSnippet } from './TypstSnippet';

let shared: { files: string[]; root: string; book: BookFiles } | null = null;

/** The open book's files, to find the places a reply points to: one table for every reply. */
export function useBookFiles(): BookFiles | null {
  const ws = useStore(studio.store, (s) => s.workspace);
  if (!ws) return null;
  if (shared?.files !== ws.files || shared.root !== ws.root) shared = { files: ws.files, root: ws.root, book: bookFiles(ws.files, ws.root) };
  return shared.book;
}

/** Parsed, with the places in the book it points to as links. */
function useBlocks(text: string): Block[] {
  const book = useBookFiles();
  return useMemo(() => (book ? linkBlocks(parseMarkdown(text), book) : parseMarkdown(text)), [text, book]);
}

/** Whether a link's words are being selected (a drag across them), not clicked. The editor's selection doesn't count. */
function selectingIn(el: Element) {
  const s = window.getSelection();
  return !!s && !s.isCollapsed && !!s.anchorNode && el.contains(s.anchorNode);
}

/** A place in the book a reply points to (`one.typ:42`): a click opens it in the editor, unless it was to select the words. */
function SourceLink({ to, children }: { to: SourceRef; children: ReactNode }) {
  const go = () => void studio.openRef(to);
  return (
    <span className="md-ref" role="link" tabIndex={0} title={refTitle(to)} onClick={(e) => !selectingIn(e.currentTarget) && go()} onKeyDown={(e) => e.key === 'Enter' && go()}>
      {children}
    </span>
  );
}

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
      case 'ref':
        return (
          <SourceLink key={k} to={n.to}>
            {inlines(n.c)}
          </SourceLink>
        );
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
      // Typst blocks keep their source (it may be markup to copy) and show what it makes, wrapped as the pane is wide, once it's all there.
      if (/^(typst|typ)$/i.test(b.lang ?? '')) {
        return (
          <div key={k} className="md-typst">
            <pre className="md-code" data-lang={b.lang}>{b.v}</pre>
            {!b.open && <TypstPassage source={b.v} caption="Renders as" className="typst-block" waiting={null} failed={() => null} />}
          </div>
        );
      }
      // A chart the reply asks for, drawn.
      if (/^chart$/i.test(b.lang ?? '')) return <ChartBlock key={k} source={b.v} open={!!b.open} />;
      return <pre key={k} className="md-code" data-lang={b.lang || undefined}>{b.v}</pre>;
    case 'math': {
      // An equation on lines of its own, set as the book sets it; as written until it's all there, or if it can't be set.
      const written = <pre className="md-code" data-lang="typst">{b.v}</pre>;
      return (
        <div key={k} className="md-equation">
          {b.open ? written : <TypstSnippet source={b.v} inline fallback={written} />}
        </div>
      );
    }
    case 'table':
      // Wide tables scroll sideways in their own box.
      return (
        <div key={k} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>
                    {inlines(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>
                      {inlines(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'hr':
      return <hr key={k} />;
  }
}

/** Renders an assistant reply's Markdown as React elements (no HTML injection). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useBlocks(text);
  return <>{blocks.map(block)}</>;
});

/** A line of the assistant's (an option of its question): emphasis, code and Typst math, with no paragraphs. */
export const MarkdownLine = memo(function MarkdownLine({ text }: { text: string }) {
  const blocks = useBlocks(text);
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
