/** Smallest single edit turning `a` into `b` (keeps cursor/scroll stable on reload). */
export function minimalEdit(a: string, b: string): { start: number; end: number; text: string } | null {
  if (a === b) return null;
  let prefix = 0;
  const max = Math.min(a.length, b.length);
  while (prefix < max && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)) suffix++;
  return { start: prefix, end: a.length - suffix, text: b.slice(prefix, b.length - suffix) };
}
