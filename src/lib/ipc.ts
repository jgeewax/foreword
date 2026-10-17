// Typed wrappers for the Rust commands (src-tauri/src/*.rs).
import { Channel, invoke } from '@tauri-apps/api/core';

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
  uiLog: (line: string) => invoke<void>('ui_log', { line }).catch(() => {}),
  selftestFinish: (result: unknown) => invoke<void>('selftest_finish', { result }),
  logs: (source?: string) => invoke<{ source: string; line: string }[]>('app_logs', { source }),

  workspaceOpen: (path: string, onChange: Channel<string[]>) => invoke<WorkspaceInfo>('workspace_open', { path, onChange }),
  workspaceList: () => invoke<string[]>('workspace_list'),
  fsRead: (path: string) => invoke<FileContent>('fs_read', { path }),
  fsHash: (path: string) => invoke<string | null>('fs_hash', { path }),
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
  /** `{files}` in the label becomes the names of the changed files. Null: nothing changed. */
  historySnapshot: (kind: string, label: string, allowEmpty = false) => invoke<Version | null>('history_snapshot', { kind, label, allowEmpty }),
  historyList: (limit: number) => invoke<Version[]>('history_list', { limit }),
  /** Files that differ between two versions; `from` null = the version's parent. */
  historyChanges: (from: string | null, to: string) => invoke<FileChange[]>('history_changes', { from, to }),
  /** A file's text at a version, or null if it didn't exist then. */
  historyFile: (id: string, path: string) => invoke<string | null>('history_file', { id, path }),
};

export { Channel };
