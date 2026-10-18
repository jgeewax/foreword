// The settings file (~/.typst-studio/settings.json): every app preference as
// JSON the author can edit by hand. Keys this version doesn't know are kept.
import { DEFAULT_SETTINGS, sanitize, type AppSettings } from './settings';

export type ParsedConfig = {
  settings: AppSettings;
  /** UI zoom (1 = 100%), if the file sets one. */
  zoom: number | null;
  /** The whole object, unknown keys included (kept when writing). */
  raw: Record<string, unknown>;
  /** Why the file can't be used (it's left alone until fixed). */
  error: string | null;
};

/** Where in the text a JSON error is, as "line 3". */
function where(text: string, message: string): string {
  const pos = /position (\d+)/.exec(message);
  if (pos) return ` (line ${text.slice(0, Number(pos[1])).split('\n').length})`;
  const line = /line (\d+)/.exec(message);
  return line ? ` (line ${line[1]})` : '';
}

export function parseConfig(text: string): ParsedConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { settings: { ...DEFAULT_SETTINGS }, zoom: null, raw: {}, error: `It isn't valid JSON${where(text, String((e as Error).message))}.` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings: { ...DEFAULT_SETTINGS }, zoom: null, raw: {}, error: 'It must be a JSON object ({ … }).' };
  const r = raw as Record<string, unknown>;
  const zoom = typeof r.zoom === 'number' && r.zoom >= 0.5 && r.zoom <= 2 ? r.zoom : null;
  return { settings: { ...DEFAULT_SETTINGS, ...sanitize(r) }, zoom, raw: r, error: null };
}

/** The file's text: the settings (and zoom) over what was there, in a stable order, 2-space JSON. */
export function serializeConfig(raw: Record<string, unknown>, settings: AppSettings, zoom: number): string {
  const ours = {
    sendKey: settings.sendKey,
    historyPlacement: settings.historyPlacement,
    markAiEdits: settings.markAiEdits,
    markAiReads: settings.markAiReads,
    formatOnSave: settings.formatOnSave,
    editorFontSize: settings.editorFontSize,
    zoom: Math.round(zoom * 100) / 100,
    permissions: settings.permissions,
    allowCommands: settings.allowCommands,
  };
  const rest = Object.fromEntries(Object.entries(raw).filter(([k]) => !(k in ours)));
  return `${JSON.stringify({ ...ours, ...rest }, null, 2)}\n`;
}
