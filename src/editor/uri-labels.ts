// The paths Monaco's own views show (the peek of Find All References: each
// file's folder, and its title): a book's file by its place in the book
// ("chapters"), as VS Code shows a workspace's, not its whole path on the Mac
// (/Users/…/book/chapters). Monaco's standalone label service only has the
// whole path, so its one instance is given this.
import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices.js';
import { ILabelService } from 'monaco-editor/platform/label/common/label.js';
import { inBook, tildePath } from '../lib/paths';

type UriLike = { scheme: string; fsPath: string };
type LabelService = { getUriLabel(uri: UriLike, options?: unknown): string };

/** Monaco's views name the book's files from the book (`root`, read each time), any other file from ~. Returns the undo. */
export function labelUrisInBook(root: () => string | null | undefined): () => void {
  const labels = StandaloneServices.get(ILabelService) as LabelService;
  const own = labels.getUriLabel;
  labels.getUriLabel = function (uri, options) {
    if (uri.scheme !== 'file') return own.call(this, uri, options);
    return inBook(uri.fsPath, root()) ?? tildePath(uri.fsPath);
  };
  return () => {
    labels.getUriLabel = own;
  };
}
