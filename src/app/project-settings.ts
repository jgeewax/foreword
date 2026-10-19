// Project settings: `.typst-studio.json` in the project root (SPEC §4). Only
// non-secret, per-book settings. Unknown keys are preserved when saving.
import { normalizeHex } from './book-color';
import { sanitizeCommands } from './settings';

export const PROJECT_FILE = '.typst-studio.json';


export type ProjectSettings = {
  /** Main file the preview and export compile, e.g. "main.typ" (relative to the folder opened). */
  entryPoint?: string;
  /**
   * The Typst root: where paths starting with "/" begin, and the folder Typst
   * may read from. Relative to the folder opened, e.g. "src" for a book kept
   * in src/ of a larger folder. Default: the main file's folder, as `typst
   * compile` does.
   */
  root?: string;
  /** Folder for exported PDFs, relative to the project root. Empty = next to the entry file. */
  outputDir?: string;
  /** Extra font folders (relative to the project root, or absolute). */
  fontPaths?: string[];
  /** Commands the assistant may run in this book without asking (e.g. "python3"). */
  allowCommands?: string[];
  /**
   * The window's colour for this book ("#00ad9f"), on its title, activity and
   * status bars; "none" for none, even where VS Code's Peacock gives it one.
   */
  color?: string;
};

export type ParsedProjectSettings = {
  settings: ProjectSettings;
  /** The whole JSON object, including keys this version doesn't know. */
  raw: Record<string, unknown>;
  error: string | null;
};

export function parseProjectSettings(text: string | null): ParsedProjectSettings {
  if (text === null || !text.trim()) return { settings: {}, raw: {}, error: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { settings: {}, raw: {}, error: `${PROJECT_FILE} is not valid JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { settings: {}, raw: {}, error: `${PROJECT_FILE} must contain a JSON object` };
  }
  const r = raw as Record<string, unknown>;
  const settings: ProjectSettings = {};
  if (typeof r.entryPoint === 'string') settings.entryPoint = r.entryPoint;
  if (typeof r.root === 'string') settings.root = r.root;
  if (typeof r.outputDir === 'string') settings.outputDir = r.outputDir;
  if (Array.isArray(r.fontPaths)) settings.fontPaths = r.fontPaths.filter((p): p is string => typeof p === 'string');
  if (Array.isArray(r.allowCommands)) settings.allowCommands = sanitizeCommands(r.allowCommands);
  const color = r.color === 'none' ? 'none' : normalizeHex(r.color);
  if (color) settings.color = color;
  return { settings, raw: r, error: null };
}

const isRelativeInside = (p: string) => !p.startsWith('/') && !p.split('/').includes('..');

/** Problems that would stop the setting from working; empty when valid. */
export function validateProjectSettings(s: ProjectSettings, typFiles: string[]): string[] {
  const errors: string[] = [];
  if (s.entryPoint !== undefined && !typFiles.includes(s.entryPoint)) errors.push(`Entry point "${s.entryPoint}" isn't a .typ file in this project.`);
  if (s.outputDir && !isRelativeInside(s.outputDir)) errors.push('The output folder must be inside the project (a relative path without "..").');
  const root = typstRootOf(s, s.entryPoint ?? null);
  if (s.root && !isRelativeInside(s.root.trim())) errors.push('The book’s root folder must be inside the project (a relative path without "..").');
  else if (s.entryPoint && root && !s.entryPoint.startsWith(`${root}/`)) errors.push(`The main file must be inside the root folder (${root}).`);
  for (const p of s.fontPaths ?? []) if (!p.trim()) errors.push('Font folders can’t be empty.');
  return errors;
}

/** JSON text for the file: `patch` merged over the existing object, empty values removed. */
export function serializeProjectSettings(raw: Record<string, unknown>, patch: ProjectSettings): string {
  const next: Record<string, unknown> = { ...raw, ...patch };
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[k];
  }
  return JSON.stringify(next, null, 2) + '\n';
}

/** The Typst root, relative to the folder opened ('' for the folder itself): the setting, else the main file's folder. */
export function typstRootOf(s: ProjectSettings, entry: string | null): string {
  const configured = s.root?.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (configured === '.') return ''; // the folder opened itself
  if (configured) return configured;
  return entry?.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
}

/**
 * Tinymist `outputPath` pattern for exports. The export folder is relative to
 * the folder opened (`folder`), whatever the Typst root; without one, the PDF
 * goes next to the main file.
 */
export function outputPathPattern(s: ProjectSettings, folder: string): string {
  const dir = s.outputDir?.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
  return dir ? `${folder}/${dir}/$name` : '$root/$dir/$name';
}

/** Where an export of `file` goes (relative to the folder opened, '' for it): the export folder if set, else the file's own folder, as outputPathPattern says. */
export function exportFolderOf(s: ProjectSettings, file: string): string {
  const dir = s.outputDir?.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
  return dir || (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
}

/** Font folders as absolute paths (Tinymist resolves them from its own working directory otherwise). */
export function absoluteFontPaths(s: ProjectSettings, root: string): string[] {
  return (s.fontPaths ?? []).filter((p) => p.trim()).map((p) => (p.startsWith('/') ? p : `${root}/${p.replace(/^\.\/+/, '')}`));
}
