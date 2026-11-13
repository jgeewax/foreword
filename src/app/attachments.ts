// Files attached to a chat message, on the page's side: what a drop or a paste
// brings, the pictures the chat shows, and the bytes that go in the message
// itself (a picture made small enough for the model).

import { ipc } from '../lib/ipc';
import { mimeOf } from '../services/agent/attached-files';
import type { AttachedFile, InlineFile } from '../services/agent/types';

/** A drag from the book's file tree: its paths (book-relative), as JSON. */
export const BOOK_PATHS = 'application/x-foreword-paths';

/** Whether a drag carries files: from Finder (or another app), or from the file tree. */
export const carriesFiles = (dt: DataTransfer | null) => !!dt && [...dt.types].some((t) => t === 'Files' || t === BOOK_PATHS);

/**
 * Files dragged anywhere but the chat do nothing: WebKit would otherwise open
 * a dropped file in place of the app, and the editor would take a drop as
 * text. (Tauri's own drop handler is off, so drags reach the page.)
 */
export function installDropGuard(chat = '.agent-pane') {
  const elsewhere = (e: DragEvent) => carriesFiles(e.dataTransfer) && !(e.target instanceof Element && e.target.closest(chat));
  const refuse = (e: DragEvent) => {
    if (!elsewhere(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  // Capturing, so the editor never sees them.
  for (const type of ['dragenter', 'dragover', 'drop'] as const) window.addEventListener(type, refuse, true);
}

/** What a drop brings: files (from Finder, or another app), book paths (the file tree), and how many folders it left out. */
export function droppedItems(dt: DataTransfer): { files: File[]; book: string[]; folders: number } {
  let book: string[] = [];
  try {
    const raw = dt.getData(BOOK_PATHS);
    if (raw) book = (JSON.parse(raw) as unknown[]).filter((p): p is string => typeof p === 'string');
  } catch {}
  const files: File[] = [];
  let folders = 0;
  // Through the items: a folder from Finder comes as a File too, and only its entry says it's a folder.
  const items = [...(dt.items ?? [])].filter((it) => it.kind === 'file');
  if (items.length) {
    for (const it of items) {
      if (it.webkitGetAsEntry?.()?.isDirectory) folders++;
      else {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
  } else files.push(...dt.files);
  return { files, book, folders };
}

/**
 * Of a paste, the files to attach instead of its text: a screenshot, a
 * picture copied from a page or Preview, a file copied in Finder (whose name
 * comes as the text), or a picture with a link. Word, Pages and Numbers put a
 * picture of what was copied beside its text: that's text, pasted as usual.
 */
export function pastedFiles<F extends { name: string }>(files: readonly F[], text: string): F[] {
  if (!files.length) return [];
  const t = text.trim();
  if (!t || /^https?:\/\/\S+$/.test(t)) return [...files];
  const lines = t.split(/\r?\n/).map((l) => l.trim());
  return files.some((f) => lines.some((l) => l === f.name || l.endsWith(`/${f.name}`))) ? [...files] : [];
}

/** A name for a pasted picture, as macOS names a screenshot: "Pasted image 2026-11-13 at 14.32.05.png". */
export function pastedName(file: { name: string; type: string }, now = new Date()): string {
  // WebKit names a pasted picture "image.png" (or "image.tiff"): every one the same.
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name;
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? 'png';
  const p = (n: number) => String(n).padStart(2, '0');
  return `Pasted image ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} at ${p(now.getHours())}.${p(now.getMinutes())}.${p(now.getSeconds())}.${ext}`;
}

// ---- pictures the chat shows ------------------------------------------------------

const urls = new Map<string, Promise<string | null>>();

/** A picture in the book, for an <img> (null: it's gone, or too big to read). */
export function pictureUrl(path: string): Promise<string | null> {
  let url = urls.get(path);
  if (!url) {
    url = ipc.fsReadBytes(path).then(
      (bytes) => URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) })),
      () => {
        // Read again next time: it may be back.
        urls.delete(path);
        return null;
      },
    );
    urls.set(path, url);
  }
  return url;
}

// ---- what goes in the message itself ------------------------------------------------

/** Pictures every model takes as they are (Claude's, OpenAI's and Gemini's types in common). */
const SENDABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** A picture's longest side and most bytes, sent to a model: Claude takes at most 8000 px and 5 MB of base64, and scales anything past ~1600 px down itself. */
const MAX_SIDE = 2000;
const MAX_BYTES = 3_700_000;

/** Files whose bytes go in the message for an agent that takes them: PDFs and text (Gemini reads both), up to 15 MB. */
const INLINE_FILE = /^(application\/pdf|text\/|application\/(json|xml|yaml|toml))/;
const MAX_INLINE_FILE = 15e6;

/** `w` × `h` scaled down (never up) to fit `max` on its longest side. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * A picture as a model takes it: as it is if it's a type every model takes
 * and small enough, else drawn again (HEIC, TIFF and the like, or too big) as
 * a PNG (a screenshot) or a JPEG (a photo, or a PNG that's still too big).
 * Null if WebKit can't draw it.
 */
export async function pictureForModel(bytes: ArrayBuffer, mime: string): Promise<{ mime: string; data: string } | null> {
  const blob = new Blob([bytes], { type: mime });
  const asIs = SENDABLE.has(mime) && bytes.byteLength <= MAX_BYTES;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return asIs ? { mime, data: await base64(blob) } : null;
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE);
  if (asIs && width === bitmap.width && height === bitmap.height) {
    bitmap.close();
    return { mime, data: await base64(blob) };
  }
  const draw = async (type: 'image/png' | 'image/jpeg', quality?: number) => {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    // A JPEG has no transparency: what was clear is white, as on a page.
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type, quality });
  };
  try {
    let out = mime === 'image/png' || mime === 'image/gif' ? await draw('image/png') : null;
    if (!out || out.size > MAX_BYTES) out = await draw('image/jpeg', 0.88);
    if (out.size > MAX_BYTES) out = await draw('image/jpeg', 0.7);
    return { mime: out.type, data: await base64(out) };
  } finally {
    bitmap.close();
  }
}

/** The bytes of a message's files that go in the message itself, as the agent takes them; a file that can't be read just goes by its path. */
export async function inlineFiles(files: readonly AttachedFile[], takes: { pictures: boolean; files: boolean }, read: (path: string) => Promise<ArrayBuffer> = ipc.fsReadBytes): Promise<InlineFile[]> {
  const out: InlineFile[] = [];
  for (const f of files) {
    if (f.dir) continue;
    const mime = mimeOf(f.name);
    try {
      if (takes.pictures && mime.startsWith('image/') && mime !== 'image/svg+xml') {
        const picture = await pictureForModel(await read(f.path), mime);
        if (picture) out.push({ path: f.path, ...picture, picture: true });
      } else if (takes.files && INLINE_FILE.test(mime) && f.size <= MAX_INLINE_FILE) {
        out.push({ path: f.path, mime, data: await base64(new Blob([await read(f.path)])), picture: false });
      }
    } catch (e) {
      console.warn(`attachments: couldn't put ${f.path} in the message`, e);
    }
  }
  return out;
}
