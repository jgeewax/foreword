/** Shortens /Users/<name>/… to ~/… for display. */
export const tildePath = (path: string) => path.replace(/^\/Users\/[^/]+/, '~');

export const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path;

export const dirName = (path: string) => path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
