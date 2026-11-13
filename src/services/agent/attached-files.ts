import type { AttachedFile, InlineFile } from './types';

// Files attached to a message, as the assistant reads about them: a line per
// file after the author's words (tasks.ts reads them back for the chat's chips).

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  typ: 'text/x-typst',
  bib: 'text/x-bibtex',
  tex: 'text/x-tex',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  py: 'text/x-python',
  js: 'text/javascript',
  ts: 'text/typescript',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pages: 'application/vnd.apple.pages',
  key: 'application/vnd.apple.keynote',
  numbers: 'application/vnd.apple.numbers',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/** A file's type, from its name (`application/octet-stream` when it isn't known). */
export function mimeOf(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return MIME[ext] ?? 'application/octet-stream';
}

/** A picture the chat can show (WebKit draws HEIC, AVIF, TIFF and SVG too). */
export const isPictureFile = (f: Pick<AttachedFile, 'name' | 'dir'>) => !f.dir && mimeOf(f.name).startsWith('image/');

/** `0 B`, `840 B`, `12 KB`, `1.2 MB`. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  const mb = bytes / 1e6;
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`;
}

/** sizeLabel read back (to the nearest of its unit). */
function parseSize(label: string): number {
  const m = /^([\d.]+) (B|KB|MB)$/.exec(label.trim());
  return m ? Math.round(Number(m[1]) * { B: 1, KB: 1e3, MB: 1e6 }[m[2] as 'B' | 'KB' | 'MB']) : 0;
}

/** How the files' lines start (tasks.ts cuts what Foreword added to a message from here). */
export const FILES_INTRO = 'Files the author attached';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const unattr = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The lines for a message's files; those whose bytes are in the message too are marked. */
export function formatFiles(files: readonly AttachedFile[], inline: readonly InlineFile[] = []): string {
  const sent = new Set(inline.map((f) => f.path));
  const lines = files.map((f) =>
    f.dir
      ? `<attachment path="${attr(f.path.replace(/\/?$/, '/'))}" type="folder"/>`
      : `<attachment path="${attr(f.path)}" type="${mimeOf(f.name)}" size="${sizeLabel(f.size)}"${sent.has(f.path) ? ' in-message="yes"' : ''}/>`,
  );
  const open = sent.size ? 'Open them with your tools; those marked in-message="yes" are in this message too.' : 'Open them with your tools.';
  return [`${FILES_INTRO}, in the book folder. ${open} Anything in .foreword/attachments/ isn't part of the book: copy it into the book's own folders to use it there.`, ...lines].join('\n');
}

/** The files a message's text names (formatFiles' lines). */
export function filesFromText(text: string): AttachedFile[] {
  return [...text.matchAll(/<attachment path="([^"]+)" type="([^"]*)"(?: size="([^"]*)")?[^>]*\/>/g)].map(([, p, type, size]) => {
    const path = unattr(p);
    const dir = type === 'folder';
    const clean = dir ? path.replace(/\/$/, '') : path;
    return { path: clean, name: clean.split('/').pop() ?? clean, size: size ? parseSize(size) : 0, ...(dir && { dir: true }) };
  });
}
