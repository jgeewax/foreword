/** Shortens /Users/<name>/… to ~/… for display. */
export const tildePath = (path: string) => path.replace(/^\/Users\/[^/]+/, '~');

/** A folder for a message: ~/… and, when long, only its first and last two parts (~/…/Books/Drafts). */
export function shortPath(path: string, max = 48): string {
  const p = tildePath(path);
  if (p.length <= max) return p;
  const parts = p.split('/');
  return parts.length > 3 ? `${parts[0] || '/'}/…/${parts.slice(-2).join('/')}` : p;
}

export const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path;

export const dirName = (path: string) => path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
