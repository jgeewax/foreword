// Typed wrappers for the Rust commands (src-tauri/src/*.rs).
import { Channel, invoke } from '@tauri-apps/api/core';
import type { PdfInfo } from '../print';

export type CmdErrorKind = 'conflict' | 'notFound' | 'invalid' | 'unavailable' | 'io';
export type CmdError = { kind: CmdErrorKind; message: string };

export function isCmdError(e: unknown): e is CmdError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e;
}

export function errorMessage(e: unknown): string {
  if (isCmdError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export type WorkspaceInfo = { root: string; name: string; entry: string | null; files: string[] };
export type FileContent = { text: string; hash: string };
/** A snapshot in the book's history (app-owned Git repo, see history.rs). */
export type Version = { id: string; parent: string | null; time: number; label: string; kind: string; files: number; added: number; deleted: number };
export type FileChange = { path: string; status: 'A' | 'M' | 'D'; added: number | null; deleted: number | null };
export type ToolInfo = { path: string | null; version: string | null };
export type ToolsStatus = { tinymist: ToolInfo; opencode: ToolInfo };
export type LaunchOptions = {
  workspace: string | null;
  sampleBook: string | null;
  selftestOut: string | null;
  selftestAgent: boolean;
  selftestEdits: boolean;
  /** Comma-separated self-test groups to run (all when null). */
  selftestOnly: string | null;
};
export type Bounds = { x: number; y: number; width: number; height: number };
export type AgentInfo = { baseUrl: string; bin: string };
export type AgentResponse = { status: number; body: any };

export const ipc = {
  toolsStatus: () => invoke<ToolsStatus>('tools_status'),
  launchOptions: () => invoke<LaunchOptions>('launch_options'),
  /** The menu bar as [title, items ("id=Label", or a predefined item's label, "---")] (self-test only). */
  menuOutline: () => invoke<[string, string[]][]>('menu_outline'),
  uiLog: (line: string) => invoke<void>('ui_log', { line }).catch(() => {}),
  selftestFinish: (result: unknown) => invoke<void>('selftest_finish', { result }),
  logs: (source?: string) => invoke<{ source: string; line: string }[]>('app_logs', { source }),

  workspaceOpen: (path: string, onChange: Channel<string[]>) => invoke<WorkspaceInfo>('workspace_open', { path, onChange }),
  workspaceList: () => invoke<string[]>('workspace_list'),
  fsRead: (path: string) => invoke<FileContent>('fs_read', { path }),
  fsHash: (path: string) => invoke<string | null>('fs_hash', { path }),
  /** New book: create `parent/name` with these files (never into an existing folder). Returns its path. */
  projectCreate: (parent: string, name: string, files: { path: string; text: string }[]) =>
    invoke<string>('project_create', { parent, name, files }),
  /** Run one code example in the book folder (only for trusted books). */
  /** Typst snippets (formulas, small blocks) to SVG, each on its own; see src-tauri/src/render.rs. */
  typstRender: (sources: string[], fill: string, sizePt: number) => invoke<{ pages: string[]; error: string | null }[]>('typst_render', { sources, fill, sizePt }),
  codeRun: (lang: string, code: string, timeoutMs?: number) =>
    invoke<{ stdout: string; stderr: string; exit: number | null; timedOut: boolean; truncated: boolean; durationMs: number; interpreter: string }>('code_run', {
      lang,
      code,
      timeoutMs: timeoutMs ?? null,
    }),
  clipboardWrite: (text: string) => invoke<void>('clipboard_write', { text }),
  /** Page count and page boxes of a PDF in the workspace (for the print checks). */
  pdfInfo: (path: string) => invoke<PdfInfo>('pdf_info', { path }),
  /** The settings file (~/.typst-studio/settings.json): its text, or null when there's none yet. */
  configRead: () => invoke<{ path: string; text: string | null }>('config_read'),
  configWrite: (text: string) => invoke<void>('config_write', { text }),
  /** Open it in the default text editor. */
  configOpen: () => invoke<void>('config_open'),
  /** Copy an exported PDF (in the book) to where the author chose to save it (an absolute .pdf path). */
  exportCopy: (from: string, to: string) => invoke<string>('export_copy', { from, to }),
  /** Open a PDF (book-relative or absolute) in the default viewer, or show it in Finder. */
  openPdf: (path: string) => invoke<void>('open_pdf', { path }),
  revealPdf: (path: string) => invoke<void>('reveal_pdf', { path }),
  /** Open a printer's web page in the browser (https, known printers only). */
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  /** New project from a Typst Universe template package (downloaded from packages.typst.org). */
  projectCreateFromPackage: (parent: string, name: string, pkg: { name: string; version: string }, extra: { path: string; text: string }[]) =>
    invoke<{ root: string; entry: string }>('project_create_from_package', { parent, name, package: pkg, extra }),
  fsMkdir: (path: string) => invoke<void>('fs_mkdir', { path }),
  /** Rename or move; refuses if the destination exists. */
  fsRename: (from: string, to: string) => invoke<void>('fs_rename', { from, to }),
  fsCopy: (from: string, to: string) => invoke<void>('fs_copy', { from, to }),
  /** Move to the macOS Trash (recoverable). */
  fsTrash: (path: string) => invoke<void>('fs_trash', { path }),
  revealInFinder: (path: string) => invoke<void>('reveal_in_finder', { path }),
  fsWrite: (path: string, text: string, expectedHash: string | null) =>
    invoke<string>('fs_write', { path, text, expectedHash }),

  typstStart: (onMessage: Channel<any>) => invoke<{ bin: string; pid: number | null }>('typst_start', { onMessage }),
  typstSend: (message: string) => invoke<void>('typst_send', { message }),
  typstStop: () => invoke<void>('typst_stop'),

  previewOpen: (url: string, bounds: Bounds) => invoke<void>('preview_open', { url, bounds }),
  previewSetBounds: (bounds: Bounds) => invoke<void>('preview_set_bounds', { bounds }),
  previewSetVisible: (visible: boolean) => invoke<void>('preview_set_visible', { visible }),
  previewClose: () => invoke<void>('preview_close'),
  previewEval: (js: string) => invoke<void>('preview_eval', { js }),
  previewSnapshot: (name: string, target?: 'main' | 'preview') => invoke<string>('preview_snapshot', { name, target }),
  setUiZoom: (factor: number) => invoke<number>('set_ui_zoom', { factor }),
  webviewFrames: () => invoke<Record<string, Bounds>>('webview_frames'),
  nativeGeometry: (label: 'main' | 'preview') => invoke<Record<string, unknown>>('native_geometry', { label }),
  focusMain: () => invoke<void>('focus_main'),

  agentStart: () => invoke<AgentInfo>('agent_start'),
  agentRequest: (method: string, path: string, body?: unknown) =>
    invoke<AgentResponse>('agent_request', { method, path, body: body ?? null }),
  agentSubscribe: (onEvent: Channel<any>) => invoke<void>('agent_subscribe', { onEvent }),
  agentStop: () => invoke<void>('agent_stop'),

  historyInit: (exclude: string[]) => invoke<{ gitDir: string; git: string }>('history_init', { exclude }),
  historyReveal: () => invoke<void>('history_reveal'),
  /** `{files}` in the label becomes the names of the changed files. Null: nothing changed. */
  historySnapshot: (kind: string, label: string, allowEmpty = false) => invoke<Version | null>('history_snapshot', { kind, label, allowEmpty }),
  /** Versions, newest first; with `path`, only those that changed that file. */
  historyList: (limit: number, path: string | null = null) => invoke<Version[]>('history_list', { limit, path }),
  /** Files that differ between two versions; `from` null = the version's parent. */
  historyChanges: (from: string | null, to: string) => invoke<FileChange[]>('history_changes', { from, to }),
  /** A file's text at a version, or null if it didn't exist then. */
  historyFile: (id: string, path: string) => invoke<string | null>('history_file', { id, path }),
};

export { Channel };
