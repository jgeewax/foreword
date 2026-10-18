import { useLayoutEffect, useRef } from 'react';
import { exportFolderOf } from '../app/project-settings';
import { studio } from '../app/studio';
import { COVER_PREVIEW, COVER_PRINT } from '../cover';
import { tildePath } from '../lib/paths';
import { useStore } from '../lib/store';
import { Icon } from './icons';

/**
 * Placeholder for the preview. The preview itself is a separate native webview
 * (see src-tauri/src/preview.rs) positioned exactly over `.preview-body`.
 */
export function PreviewPane() {
  const preview = useStore(studio.store, (s) => s.preview);
  const compile = useStore(studio.store, (s) => s.compile);
  const target = useStore(studio.store, (s) => s.previewTarget);
  const hasCover = useStore(studio.store, (s) => !!s.workspace?.files.includes(COVER_PREVIEW));
  const exporting = useStore(studio.store, (s) => s.exporting);
  // Where Export cover puts it, exactly: the export folder, else beside the cover's file.
  const coverPdf = useStore(studio.store, (s) => {
    const folder = exportFolderOf(s.project.settings, COVER_PRINT);
    return tildePath(`${s.workspace?.root ?? ''}${folder ? `/${folder}` : ''}/${COVER_PRINT.split('/').pop()!.replace(/\.typ$/, '.pdf')}`);
  });
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current!;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Page CSS pixels → window points: scale by the UI zoom, then offset by
        // where the page's viewport starts in the window (title-bar inset).
        const r = el.getBoundingClientRect();
        const z = studio.zoomFactor;
        const { top, left } = studio.viewportInset;
        studio.setPreviewBounds({ x: left + r.left * z, y: top + r.top * z, width: r.width * z, height: r.height * z });
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('studio-layout', measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('studio-layout', measure);
      studio.setPreviewBounds(null);
    };
  }, []);

  const status =
    preview.status === 'error'
      ? 'error'
      : compile.status === 'error'
        ? 'error in source (showing last good render)'
        : compile.status === 'compiling'
          ? 'compiling…'
          : target === 'cover' && compile.status === 'ok'
            ? 'cover, with guides'
            : compile.pages
              ? `${compile.pages} pages`
              : preview.status;

  return (
    <section className="pane preview-pane">
      <header className="pane-header">
        <span className="pane-title">Preview</span>
        {hasCover && (
          <div className="kind-switch preview-switch" role="tablist" aria-label="Preview">
            <button role="tab" aria-selected={target === 'book'} className={target === 'book' ? 'active' : ''} onClick={() => void studio.setPreviewTarget('book')}>
              Book
            </button>
            <button role="tab" aria-selected={target === 'cover'} className={target === 'cover' ? 'active' : ''} onClick={() => void studio.setPreviewTarget('cover')}>
              Cover
            </button>
          </div>
        )}
        <span className={`pill ${compile.status === 'error' || preview.status === 'error' ? 'bad' : ''}`}>{status}</span>
        <span className="spacer" />
        {target === 'cover' && (
          <>
            <button className="small" title="Match the cover to the book's page size and page count (the spine)" onClick={() => void studio.updateCoverFromBook()}>
              Update from book
            </button>
            <button className="small" disabled={exporting} title={`Export the printable cover (no guides) to ${coverPdf}`} onClick={() => void studio.exportCover()}>
              Export cover
            </button>
          </>
        )}
        {target === 'book' && (
          <>
            <button className="small" title="Export the book to PDF (⇧⌘E)" disabled={exporting} onClick={() => void studio.exportPdf()}>
              {exporting ? (
                <>
                  <span className="btn-spinner" aria-hidden /> Exporting…
                </>
              ) : (
                'Export PDF…'
              )}
            </button>
            <button className="small" title="Open the book’s exported PDF in Preview (⌥⌘E)" onClick={() => void studio.openExportedPdf()}>
              Open PDF
            </button>
          </>
        )}
        {(compile.status === 'compiling' || preview.status === 'starting') && <span className="busy-bar delayed" aria-hidden />}
        <button className="icon pane-action" title="Restart preview" aria-label="Restart preview" onClick={() => void studio.restartTypst()}>
          <Icon name="refresh" size={15} />
        </button>
        {/* Back with the title bar's middle button, or ⌥⌘P. */}
        <button className="icon pane-action preview-close" title="Hide the preview (⌥⌘P)" aria-label="Hide the preview" onClick={() => studio.events.emit('toggle-pane', 'preview')}>
          <Icon name="close" size={15} />
        </button>
      </header>
      <div className="preview-body" ref={bodyRef}>
        {preview.status === 'error' ? (
          <div className="preview-message">
            <p>{preview.error}</p>
            <button onClick={() => void studio.restartTypst()}>Restart preview</button>
          </div>
        ) : (
          <div className="preview-message muted">{preview.status === 'starting' ? 'Starting Tinymist…' : ''}</div>
        )}
      </div>
    </section>
  );
}
