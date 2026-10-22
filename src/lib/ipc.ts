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
export type ToolInfo = {
  /** The program in use, if any. */
  path: string | null;
  version: string | null;
  /** The path chosen in Settings ▸ Tools, if any, whether or not it can run. */
  configured?: string | null;
  /** `path` is the chosen one, not one found automatically. */
  fromSettings?: boolean;
  /** What would be used without a choice. */
  automatic?: string | null;
  /** Every copy found on this Mac, the automatic one first. */
  copies?: ToolCopy[];
};
/** One copy of a tool; `source` says where it was found ("Homebrew", "VS Code's Typst extension"). */
export type ToolCopy = { path: string; version: string | null; source: string };
/** What a typed or pasted path for a tool holds: its version, or why it can't be used. */
export type ToolProbe = { path: string; version: string | null; problem: string | null };
export type ToolsStatus = { tinymist: ToolInfo; opencode: ToolInfo; git: ToolInfo };
/** How an assistant would run on this Mac (Settings ▸ Assistant). */
export type AssistantSetup = {
  /** Its own program, if it's installed (for OpenCode, the copy in use). */
  program: string | null;
  /** Otherwise the npm package npx runs, downloaded the first time; null without Node.js. */
  package: string | null;
  /** What signs in to it, typed in Terminal; null: nothing can run it. */
  signIn: string | null;
  /** Signed in, where that can be told without starting it (null: unknown). */
  signedIn: boolean | null;
  /** The account in words: "Claude Max", "ChatGPT", "an API key". */
  account: string | null;
  /** What Settings downloads to run it: Antigravity's connector, from Google. */
  download: { url: string; bytes: number; version: string } | null;
};
export type AssistantsSetup = { node: boolean; opencode: AssistantSetup; claude: AssistantSetup; gemini: AssistantSetup; codex: AssistantSetup; antigravity: AssistantSetup };
/** Foreword's own update, the same in every window (updater.rs). */
export type UpdateState = {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'restarting' | 'error';
  /** The version running, and the one offered with its notes and date. */
  current: string;
  version: string | null;
  notes: string | null;
  date: string | null;
  /** Bytes downloaded, of `total`. */
  received: number;
  total: number | null;
  /** While installing: verifying, installing, restarting. */
  phase: 'verifying' | 'installing' | 'restarting' | null;
  /** It installs when the app quits. */
  onQuit: boolean;
  error: string | null;
  /** This copy runs from a .app, so it can be replaced (not `npm run app`). */
  installable: boolean;
  /** When the last check finished (ms). */
  checkedAt: number | null;
};
/** A download's progress, in bytes; `unpacking` once it's all here. */
export type DownloadProgress = { received: number; total: number | null; unpacking?: boolean };
export type LaunchOptions = {
  workspace: string | null;
  sampleBook: string | null;
  selftestOut: string | null;
  selftestAgent: boolean;
  selftestEdits: boolean;
  /** Comma-separated self-test groups to run (all when null). */
  selftestOnly: string | null;
  /** A window from New Window: it starts without a book (not the last one). */
  fresh: boolean;
};
/** A book file in Git: M modified, A added, D deleted, R renamed, ? new (not yet in Git), U conflict. */
export type GitFile = { path: string; status: 'M' | 'A' | 'D' | 'R' | '?' | 'U' };
/** `staged`: Staged Changes; `files`: changed and not staged (a file staged and changed again is in both). */
export type GitStatus = { root: string; prefix: string; branch: string | null; upstream: string | null; ahead: number; behind: number; staged: GitFile[]; files: GitFile[] };
export type GitRef = { name: string; kind: 'head' | 'branch' | 'remote' | 'tag' };
/** `parents`: the commits before it that touched the book (none for the first). */
export type GitCommit = { hash: string; short: string; subject: string; author: string; time: number; parents: string[]; head: boolean; refs: GitRef[] };
export type Bounds = { x: number; y: number; width: number; height: number };
export type AgentInfo = { baseUrl: string; bin: string };
export type AgentResponse = { status: number; body: any };

export const ipc = {
  toolsStatus: () => invoke<ToolsStatus>('tools_status'),
  toolProbe: (tool: string, path: string) => invoke<ToolProbe>('tool_probe', { tool, path }),
  launchOptions: () => invoke<LaunchOptions>('launch_options'),
  /** A new window, without a book. */
  windowNew: () => invoke<string>('window_new'),
  /** Self-test only: the windows, their titles and books; run a script in one; close one. */
  selftestWindows: () => invoke<{ label: string; title: string; root: string | null }[]>('selftest_windows'),
  selftestEval: (label: string, js: string) => invoke<void>('selftest_eval', { label, js }),
  selftestCloseWindow: (label: string) => invoke<void>('selftest_close_window', { label }),
  /** The menu bar as [title, items ("id=Label", or a predefined item's label, "---")] (self-test only). */
  menuOutline: () => invoke<[string, string[]][]>('menu_outline'),
  uiLog: (line: string) => invoke<void>('ui_log', { line }).catch(() => {}),
  selftestFinish: (result: unknown) => invoke<void>('selftest_finish', { result }),
  logs: (source?: string) => invoke<{ source: string; line: string }[]>('app_logs', { source }),

  /** The author's own Git repository (src-tauri/src/git.rs); null when the book isn't in one. */
  gitStatus: () => invoke<GitStatus | null>('git_status'),
  gitFile: (rev: string, path: string) => invoke<string | null>('git_file', { rev, path }),
  gitLog: (limit: number) => invoke<GitCommit[]>('git_log', { limit }),
  gitCommitFiles: (hash: string) => invoke<GitFile[]>('git_commit_files', { hash }),
  gitCommit: (message: string) => invoke<string>('git_commit', { message }),
  /** Stage or unstage book files (`.`: all of them). */
  gitStage: (paths: string[]) => invoke<void>('git_stage', { paths }),
  gitUnstage: (paths: string[]) => invoke<void>('git_unstage', { paths }),
  gitPull: () => invoke<string>('git_pull'),
  gitPush: () => invoke<string>('git_push'),
  /** Whether another window has this book open (it comes to the front if so). */
  workspaceElsewhere: (path: string) => invoke<boolean>('workspace_elsewhere', { path }),
  workspaceOpen: (path: string, onChange: Channel<string[]>) => invoke<WorkspaceInfo>('workspace_open', { path, onChange }),
  workspaceList: () => invoke<string[]>('workspace_list'),
  fsRead: (path: string) => invoke<FileContent>('fs_read', { path }),
  fsHash: (path: string) => invoke<string | null>('fs_hash', { path }),
  /** New book: create `parent/name` with these files (never into an existing folder). Returns its path. */
  /** A sample book's copy in `parent/name`: made the first time, then the same one. */
  sampleCreate: (id: string, parent: string, name: string) => invoke<string>('sample_create', { id, parent, name }),
  projectCreate: (parent: string, name: string, files: { path: string; text: string }[]) =>
    invoke<string>('project_create', { parent, name, files }),
  /** Run one code example in the book folder (only for trusted books). */
  /** Typst snippets (formulas, small blocks) to SVG, each on its own, with the book's imports if given; see src-tauri/src/render.rs. */
  typstRender: (sources: string[], fill: string, sizePt: number, book: { root: string; prelude: string } | null) =>
    invoke<{ pages: string[]; error: string | null }[]>('typst_render', { sources, fill, sizePt, book }),
  codeRun: (lang: string, code: string, timeoutMs?: number) =>
    invoke<{ stdout: string; stderr: string; exit: number | null; timedOut: boolean; truncated: boolean; durationMs: number; interpreter: string }>('code_run', {
      lang,
      code,
      timeoutMs: timeoutMs ?? null,
    }),
  clipboardWrite: (text: string) => invoke<void>('clipboard_write', { text }),
  /** The clipboard's text, or a file's path if one was copied in Finder. */
  clipboardRead: () => invoke<string | null>('clipboard_read'),
  /** Page count and page boxes of a PDF in the workspace (for the print checks). */
  pdfInfo: (path: string) => invoke<PdfInfo>('pdf_info', { path }),
  /** The settings file (~/.foreword/settings.json): its text, or null when there's none yet. */
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
  /** The chapter preview's file on disk (a stub; Tinymist gets its text from the app), kept out of git. */
  previewChapterFile: (path: string) => invoke<void>('preview_chapter_file', { path }),

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
  /** An assistant over ACP (Claude Code, Gemini CLI, Codex, Antigravity): its JSON-RPC lines arrive on `onMessage`. */
  acpStart: (kind: string, onMessage: Channel<any>) => invoke<{ program: string; args: string[] }>('acp_start', { kind, onMessage }),
  acpSend: (line: string) => invoke<void>('acp_send', { line }),
  /** Foreword's own tools for the assistant (mcp.rs): this window's address; each request comes to `page`, answered with mcpReply. */
  mcpServe: (page: Channel<{ id: number; body: string }>) => invoke<string>('mcp_serve', { page }),
  mcpReply: (id: number, body: string | null) => invoke<void>('mcp_reply', { id, body }),
  /** EPUB export (epub.rs): the main file (`source` in its place) as HTML; every page as SVG with the outline; the zip. */
  epubHtml: (entry: string, source: string, root: string, fontPaths: string[]) =>
    invoke<{ html: string | null; warnings: string[]; errors: string[] }>('epub_html', { entry, source, root, fontPaths }),
  epubPages: (entry: string, root: string, fontPaths: string[]) =>
    invoke<{ dir: string; pages: { file: string; width: number; height: number }[]; toc: { level: number; title: string; page: number }[]; errors: string[] }>('epub_pages', { entry, root, fontPaths }),
  epubWrite: (path: string, files: { name: string; text?: string; base64?: string; temp?: string }[]) => invoke<string>('epub_write', { path, files }),
  epubDone: (dir: string) => invoke<void>('epub_done', { dir }),
  epubReveal: (path: string, open = false) => invoke<void>('epub_reveal', { path, open }),
  acpStop: () => invoke<void>('acp_stop'),
  /** Each assistant's program, sign-in and account on this Mac. */
  assistantsStatus: () => invoke<AssistantsSetup>('assistants_status'),
  /** Open Terminal on the assistant's sign-in command. */
  assistantSignIn: (kind: string) => invoke<void>('assistant_sign_in', { kind }),
  /** An assistant's own rule files outside the book (~/.claude settings, Codex's rules), read only; and one shown in Finder. */
  assistantRuleFiles: (kind: string) => invoke<{ path: string; text: string }[]>('assistant_rule_files', { kind }),
  assistantRuleReveal: (kind: string, path: string) => invoke<void>('assistant_rule_reveal', { kind, path }),
  /** Foreword's update: what's known, a check, install now (then it restarts), or at quit. Changes arrive as `update` events. */
  updateState: () => invoke<UpdateState>('update_state'),
  updateCheck: () => invoke<UpdateState>('update_check'),
  updateInstall: () => invoke<void>('update_install'),
  updateInstallOnQuit: () => invoke<UpdateState>('update_install_on_quit'),
  updateCancelOnQuit: () => invoke<UpdateState>('update_cancel_on_quit'),
  /** Download an assistant's connector (Antigravity's, from Google): progress on `onProgress`; the program's path. */
  assistantDownload: (kind: string, onProgress: Channel<DownloadProgress>) => invoke<string>('assistant_download', { kind, onProgress }),

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
