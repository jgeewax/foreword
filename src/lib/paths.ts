/** Shortens /Users/<name>/… to ~/… for display. */
export const tildePath = (path: string) => path.replace(/^\/Users\/[^/]+/, '~');

export const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path;

export const dirName = (path: string) => path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';

/** An absolute path as the book at `root` has it ("chapters/one.typ"; '' for the book's folder itself), or null outside it. */
export function inBook(path: string, root: string | null | undefined): string | null {
  const r = root?.replace(/\/+$/, '');
  if (!r) return null;
  if (path === r) return '';
  return path.startsWith(`${r}/`) ? path.slice(r.length + 1) : null;
}

/** A picture the editor can't show as text (PNG, JPEG…), so it opens in Preview, as a PDF does. An SVG is text. */
export const isPicture = (path: string) => /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif)$/i.test(path);

/** A path as pasted: its first line, trimmed, without quotes around it or Terminal's `\ ` escapes; a file:// URL as its path. */
export function pastedPath(text: string): string {
  let t = text.trim().split('\n')[0].trim();
  if (/^(['"]).+\1$/.test(t)) t = t.slice(1, -1);
  if (t.startsWith('file://')) {
    try {
      t = decodeURIComponent(new URL(t).pathname);
    } catch {}
  }
  return t.replace(/\\ /g, ' ');
}
