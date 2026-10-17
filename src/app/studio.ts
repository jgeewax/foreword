// App controller: owns the workspace, documents, Typst service, preview
// webview and agent adapter, and exposes UI state through a Store.
import { listen } from '@tauri-apps/api/event';
import { ask, open as openDialog } from '@tauri-apps/plugin-dialog';
import { Documents } from '../editor/documents';
import { uriToRelative, type LspDiagnostic } from '../editor/lsp-convert';
import { monaco } from '../editor/monaco';
import { jumpCandidates } from '../editor/preview-sync';
import type { SourceJump } from '../services/typst';
import { captureSelection, selectionLabel, type SourceSelection } from '../editor/selection';
import { Channel, errorMessage, ipc, isCmdError, type Bounds, type LaunchOptions, type ToolsStatus, type WorkspaceInfo } from '../lib/ipc';
import { clock, PerfTracker } from '../lib/perf';
import { Emitter, Store } from '../lib/store';
import {
  absoluteFontPaths,
  outputPathPattern,
  parseProjectSettings,
  PROJECT_FILE,
  serializeProjectSettings,
  validateProjectSettings,
  type ProjectSettings,
} from './project-settings';
import { loadSettings, saveSettings, type AppSettings } from './settings';
import { nextZoom, type ZoomAction } from '../lib/zoom';
import { History, initialHistory, type HistoryState } from './history';
import { bookFolderName, PAPER_TEMPLATES, paperExtras, paperSetupMessage, TEMPLATES, templateFiles } from '../templates';
import { snippetInsertion } from '../help/guide';
import { CodeRunner, initialCode, type CodeState } from '../code/runner';
import { OUTPUTS_FILE } from '../code/cells';
import { message } from '@tauri-apps/plugin-dialog';
import { copyText, showContextMenu } from '../lib/context-menu';
import { chapterImports, chapterText, includePath, nextChapterPath, withInclude } from './chapters';
import { referencesTo, removeIncludes, updateReferences } from './references';
import { findInSource, findPartial } from '../editor/find-text';
import { minimalEdit } from '../editor/text-edit';
import { OpenCodeAdapter } from '../services/agent/opencode';
import { buildInstructions, INSTRUCTIONS_KEY } from '../services/agent/instructions';
import { MODE_INSTRUCTIONS_KEY, modeConfig, type AgentMode } from '../services/agent/modes';
import { parseOptions } from '../services/agent/options-mode';
import { WRITE_FROM_PLAN_PROMPT } from '../services/agent/plan-mode';
import { draftStyleGuidePrompt, STYLE_GUIDE_FILE, STYLE_INSTRUCTIONS_KEY, styleGuideTemplate, styleInstructions } from '../services/agent/style-guide';
import { pushRecent } from '../services/agent/model-search';
import { chooseModel, PREFERRED_PROVIDERS } from '../services/agent/models';
import { describePermissions } from '../services/agent/permissions';
import type { AgentAdapter, AgentEvent, FilePatch, ModelInfo, ModelRef, PermissionDecision } from '../services/agent/types';
import { TypstService } from '../services/typst';

export type ChatItem =
  | { kind: 'user'; id: string; text: string; attachments: string[] }
  | { kind: 'assistant'; id: string; text: string; done: boolean; options?: OptionsState }
  | { kind: 'tool'; id: string; name: string; summary: string; status: 'running' | 'done' | 'failed'; detail: string }
  | {
      kind: 'permission';
      id: string;
      action: string;
      resources: string[];
      patches: FilePatch[];
      state: 'pending' | 'sending' | 'once' | 'always' | 'reject';
    }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error'; action?: { label: string; prompt: string } };

export type Attachment = { id: string; label: string; selection: SourceSelection };

/** Identifies a selection for "leave it out" (same place and same text). */
const selectionKey = (s: SourceSelection) => `${selectionLabel(s)}|${s.start.column}:${s.end.column}|${s.selectedText.length}`;

export type PromptRequest = { title: string; label: string; value: string; placeholder?: string; okLabel: string; help?: string };

/** Where a picked option goes: the passage as it stands in the buffer (1-based positions). */
export type OptionTarget = { path: string; start: { line: number; column: number }; end: { line: number; column: number }; text: string };
/**
 * An Options-mode reply: where a picked option goes (null: nothing to replace,
 * copy only), the passage as originally selected, and the option in use.
 */
export type OptionsState = { target: OptionTarget | null; original: OptionTarget | null; applied: number | null };

export type Stat = { p50: number | null; p95: number | null; n: number };

export type StudioState = {
  launch: LaunchOptions | null;
  tools: ToolsStatus | null;
  workspace: WorkspaceInfo | null;
  opening: string | null;
  openError: string | null;
  tabs: string[];
  active: string | null;
  dirty: Record<string, boolean>;
  conflicts: Record<string, string>;
  cursor: { line: number; column: number } | null;
  problems: { errors: number; warnings: number };
  compile: { status: 'idle' | 'compiling' | 'ok' | 'error'; pages?: number; words?: number };
  preview: { status: 'off' | 'starting' | 'ready' | 'error'; url?: string; error?: string };
  agent: {
    status: 'off' | 'starting' | 'ready' | 'error';
    error?: string;
    connection: 'open' | 'lost' | 'unknown';
    models: ModelInfo[];
    model: ModelRef | null;
    recentModels: ModelRef[];
    sessionId: string | null;
    title: string | null;
    running: boolean;
    items: ChatItem[];
    attachments: Attachment[];
    /** The current selection (editor, or mapped from the preview): sent with each message unless dismissed. */
    selection: { attachment: Attachment; from: 'editor' | 'preview' } | null;
    /** A selection the author dismissed for now (key: label + text; until it changes). */
    selectionDismissed: string | null;
    /** Write (default), Plan (discuss and outline) or Options (three versions to pick from). */
    mode: AgentMode;
  };
  perf: { input: Stat; preview: Stat };
  toast: { text: string; tone: 'info' | 'error' } | null;
  /** UI zoom factor (1 = 100%). */
  zoom: number;
  settings: AppSettings;
  settingsOpen: boolean;
  newBookOpen: boolean;
  /** "Typst basics": in the right-hand pane (or a dialog on the welcome screen). */
  guideOpen: boolean;
  /** Recently opened books, newest first. */
  recent: string[];
  /** A one-line text question (our own dialog: WKWebView has no window.prompt). */
  prompt: PromptRequest | null;
  /** `.typst-studio.json` of the open workspace. */
  project: { settings: ProjectSettings; raw: Record<string, unknown>; hash: string | null; error: string | null };
  exporting: boolean;
  /** WRITING_STYLE.md: whether it exists, and whether the user dismissed the setup prompt. */
  styleGuide: { exists: boolean; chars: number; dismissed: boolean };
  history: HistoryState;
  /** Runnable code examples in the book. */
  code: CodeState;
  /** Left pane: the file tree, the book's history, or its code examples. */
  sidebar: 'files' | 'history' | 'code';
};

const initialState: StudioState = {
  launch: null,
  tools: null,
  workspace: null,
  opening: null,
  openError: null,
  tabs: [],
  active: null,
  dirty: {},
  conflicts: {},
  cursor: null,
  problems: { errors: 0, warnings: 0 },
  compile: { status: 'idle' },
  preview: { status: 'off' },
  agent: {
    status: 'off',
    connection: 'unknown',
    models: [],
    model: null,
    recentModels: readJson<ModelRef[]>('studio.recentModels') ?? [],
    sessionId: null,
    title: null,
    running: false,
    items: [],
    attachments: [],
    selection: null,
    selectionDismissed: null,
    mode: 'write',
  },
  perf: { input: { p50: null, p95: null, n: 0 }, preview: { p50: null, p95: null, n: 0 } },
  toast: null,
  zoom: 1,
  settings: loadSettings(),
  settingsOpen: false,
  newBookOpen: false,
  guideOpen: false,
  prompt: null,
  recent: readJson<string[]>('studio.recentWorkspaces') ?? [],
  project: { settings: {}, raw: {}, hash: null, error: null },
  exporting: false,
  styleGuide: { exists: false, chars: 0, dismissed: false },
  history: initialHistory,
  code: initialCode,
  sidebar: 'files',
};

const LAST_WORKSPACE = 'studio.lastWorkspace';
const MODEL_KEY = 'studio.model';
const ZOOM_KEY = 'studio.zoom';
const RECENT_KEY = 'studio.recentWorkspaces';
export const NEW_BOOK_PARENT = 'studio.newBookParent';
export const AUTHOR_KEY = 'studio.author';
const tabsKey = (root: string) => `studio.tabs:${root}`;
let seq = 0;
const uid = (p: string) => `${p}${++seq}`;

function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export class Studio {
  readonly store = new Store<StudioState>(initialState);
  readonly events = new Emitter<{ 'focus-composer': []; 'focus-editor': []; 'fill-composer': [text: string]; 'show-agent-pane': [] }>();
  readonly perf = new PerfTracker();
  readonly typst = new TypstService();
  docs: Documents | null = null;
  agent: AgentAdapter | null = null;
  editor: monaco.editor.IStandaloneCodeEditor | null = null;
  readonly history = new History({
    get: () => this.state.history,
    set: (patch) => {
      this.store.set((s) => ({ history: { ...s.history, ...patch } }));
      if ('diff' in patch) this.syncPreviewVisibility(); // the diff dialog must not be drawn under the preview
    },
    docs: () => this.docs,
    agentRunning: () => this.state.agent.running,
    report: (text, tone) => this.toast(text, tone),
  });
  /**
   * The message box's text, kept here so it survives the composer remounting
   * (collapsing the pane, opening a book) and can be filled before it mounts.
   */
  composerDraft = '';
  readonly code = new CodeRunner({
    get: () => this.state.code,
    set: (patch) => this.store.set((s) => ({ code: { ...s.code, ...patch } })),
    root: () => this.state.workspace?.root ?? null,
    files: () => this.state.workspace?.files ?? [],
    docs: () => this.docs,
    editFile: async (path, transform) => {
      if (!(this.state.workspace?.files ?? []).includes(path) && !this.docs?.get(path)) {
        await ipc.fsWrite(path, transform(''), await ipc.fsHash(path));
        return true;
      }
      return this.editFile(path, transform);
    },
    confirm: (m, t, ok) => this.confirmAction(m, t, ok),
    toast: (text, tone) => this.toast(text, tone),
    notice: (text, tone, action) => this.pushItem({ kind: 'notice', id: uid('n'), tone, text, action }),
    refreshFiles: () => this.refreshFiles(),
  });
  private codeScanTimer: number | undefined;
  /** The message of the agent turn in progress (names its history version). */
  private turnMessage = '';

  private viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private previewBounds: Bounds | null = null;
  private previewVisible = true;
  private previewOpened = false;
  private pendingDisk = new Set<string>();
  private diskTimer: number | undefined;
  private unsubscribeAgent: (() => void) | null = null;
  /** Errors already shown for the current turn (OpenCode reports a failure more than once). */
  private turnErrors = new Set<string>();
  private styleGuideText: string | null = null;
  /** Options mode: the passage the current turn's options replace. */
  private optionsTurn: { target: OptionTarget | null } | null = null;
  private syncTimer: number | undefined;
  /** Cursor moves caused by a preview click must not bounce back to the preview. */
  private suppressSyncUntil = 0;
  private syncRun = 0;
  /** Zoom used to convert CSS pixels to window points for the preview webview. */
  zoomFactor = 1;
  /**
   * Where the page's viewport starts inside the window, in points. On macOS 26
   * the window has a full-size content view: the main webview spans the title
   * bar and WebKit insets the page by the title bar height (32 pt). The preview
   * webview is placed in window coordinates, so it must add this inset.
   */
  viewportInset = { top: 0, left: 0 };
  private insetTimer: number | undefined;
  private lastZoom = { action: '', at: 0 };
  private jumpWaiters = new Set<() => void>();

  constructor() {
    this.typst.on('diagnostics', (uri, list) => this.onDiagnostics(uri, list));
    this.typst.on('compile', (s) => {
      const status = s.status === 'compiling' ? 'compiling' : s.status === 'compileSuccess' ? 'ok' : 'error';
      this.store.set((st) => ({
        compile: {
          status,
          pages: s.pageCount || st.compile.pages,
          words: s.wordsCount?.words ?? st.compile.words,
        },
      }));
    });
    this.typst.on('scrollSource', (jump) => {
      // While mapping a preview selection, jumps are caught, not shown.
      if (this.jumpCatcher) return this.jumpCatcher(jump);
      void this.revealSource(jump);
    });
    this.typst.on('closed', () => {
      if (this.store.get().workspace) {
        this.store.set({ preview: { status: 'error', error: 'Tinymist stopped. Editing still works; restart the preview to continue.' } });
        this.syncPreviewVisibility();
      }
    });
    void listen<string>('menu', (e) => {
      if (e.payload === 'settings') return this.openSettings();
      if (e.payload === 'export-pdf') return void this.exportPdf();
      if (e.payload === 'new-book') return this.openNewBook();
      if (e.payload === 'new-chapter') return void this.newChapter();
      if (e.payload === 'new-file') return void this.newFile();
      if (e.payload === 'typst-guide') return this.openGuide();
      const action = ({ 'zoom-in': 'in', 'zoom-out': 'out', 'zoom-reset': 'reset' } as const)[e.payload as 'zoom-in'];
      if (action) void this.zoom(action, 'menu');
    });
    void listen<{ tag?: string; x?: number; y?: number; selection?: string }>('preview:report', (e) => {
      if (e.payload?.tag === 'jump') for (const w of [...this.jumpWaiters]) w();
      if (e.payload?.tag === 'contextmenu') void this.previewContextMenu(e.payload.x ?? 0, e.payload.y ?? 0, e.payload.selection ?? '');
      if (e.payload?.tag === 'selection') void this.previewSelection(e.payload as { text: string; end?: boolean });
    });
    void listen<number[]>('perf:preview-paint', (e) => {
      this.perf.previewPainted(e.payload);
      this.publishPerf();
      if (this.store.get().preview.status === 'starting') this.store.set((s) => ({ preview: { ...s.preview, status: 'ready' } }));
    });
  }

  get state() {
    return this.store.get();
  }

  // ---- startup / workspace ----------------------------------------------------

  async init() {
    const launch = await ipc.launchOptions();
    this.store.set({ launch });
    const zoom = readJson<number>(ZOOM_KEY);
    if (zoom && zoom !== 1) await this.setZoom(zoom, { persist: false }).catch(() => {});
    await this.refreshViewportInset();
    // The inset changes with the title bar (e.g. full screen hides it).
    window.addEventListener('resize', () => {
      clearTimeout(this.insetTimer);
      this.insetTimer = window.setTimeout(() => void this.refreshViewportInset(), 100);
    });
    ipc.toolsStatus().then((tools) => this.store.set({ tools }));
    const initial = launch.workspace ?? localStorage.getItem(LAST_WORKSPACE);
    if (initial) await this.openWorkspace(initial);
  }

  async chooseWorkspace() {
    const picked = await openDialog({ directory: true, multiple: false, title: 'Open Typst project folder' });
    if (typeof picked === 'string') await this.openWorkspace(picked);
  }

  async openWorkspace(path: string) {
    await this.closeWorkspace();
    this.store.set({ opening: path, openError: null });
    const changes = new Channel<string[]>();
    changes.onmessage = (paths) => this.onDiskChange(paths);
    let info: WorkspaceInfo;
    try {
      info = await ipc.workspaceOpen(path, changes);
    } catch (e) {
      this.store.set({ opening: null, openError: `Couldn't open ${path}: ${errorMessage(e)}` });
      return;
    }
    // Self-tests run against scratch folders: keep them out of the author's recent books.
    if (!this.state.launch?.selftestOut) {
      localStorage.setItem(LAST_WORKSPACE, info.root);
      const recent = [info.root, ...this.state.recent.filter((r) => r !== info.root)].slice(0, 8);
      writeJson(RECENT_KEY, recent);
      this.store.set({ recent });
    }
    this.docs = new Documents(info.root, this.typst, {
      onEdit: (p) => {
        this.perf.edit(() => this.publishPerf());
        if (p.endsWith('.typ')) {
          clearTimeout(this.codeScanTimer);
          this.codeScanTimer = window.setTimeout(() => {
            const doc = this.docs?.get(p);
            if (doc) this.code.updateFile(p, doc.model.getValue());
          }, 400);
        }
      },
      onDirtyChange: (p, dirty) => this.store.set((s) => ({ dirty: { ...s.dirty, [p]: dirty } })),
      onConflict: (p, message) =>
        this.store.set((s) => {
          const conflicts = { ...s.conflicts };
          if (message) conflicts[p] = message;
          else delete conflicts[p];
          return { conflicts };
        }),
    });
    this.store.set({ workspace: info, opening: null, tabs: [], active: null });

    await this.loadProjectSettings();
    await this.loadStyleGuide();
    void this.history.start(this.historyExcludes());
    void this.code.scan();
    void this.startTypst();
    void this.startAgent();

    const saved = readJson<{ tabs: string[]; active: string | null }>(tabsKey(info.root));
    const tabs = (saved?.tabs ?? []).filter((t) => info.files.includes(t));
    const fallback = info.entry ? [info.entry] : info.files.filter((f) => f.endsWith('.typ')).slice(0, 1);
    for (const t of tabs.length ? tabs : fallback) await this.openFile(t, { activate: false });
    const active = saved?.active && this.state.tabs.includes(saved.active) ? saved.active : this.state.tabs[0];
    if (active) await this.openFile(active);
  }

  /** Put text in the message box (without sending). */
  fillComposer(text: string) {
    this.composerDraft = text;
    this.events.emit('fill-composer', text);
  }

  // ---- small dialogs ------------------------------------------------------------------

  private promptResolve: ((value: string | null) => void) | null = null;

  /** Ask for one line of text. Resolves null if cancelled. */
  prompt(request: Omit<PromptRequest, 'value'> & { value?: string }): Promise<string | null> {
    this.promptResolve?.(null);
    this.store.set({ prompt: { value: '', ...request } });
    this.syncPreviewVisibility();
    return new Promise((resolve) => (this.promptResolve = resolve));
  }

  answerPrompt(value: string | null) {
    const resolve = this.promptResolve;
    this.promptResolve = null;
    this.store.set({ prompt: null });
    this.syncPreviewVisibility();
    resolve?.(value);
  }

  // ---- files: new, rename, duplicate, trash ---------------------------------------------

  /** The folder new files go in by default: the active file's folder. */
  private defaultFolder() {
    const a = this.state.active;
    return a?.includes('/') ? a.slice(0, a.lastIndexOf('/')) : '';
  }

  private static validName(name: string): string | null {
    const n = name.trim().replace(/^\/+|\/+$/g, '');
    if (!n || n.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.'))) return null;
    return n;
  }

  /** Apply a text transform to a file: in its buffer if open (saved unless it had unsaved edits), else on disk. */
  private async editFile(path: string, transform: (text: string) => string): Promise<boolean> {
    const doc = this.docs?.get(path);
    if (doc && this.docs) {
      const before = doc.model.getValue();
      const after = transform(before);
      if (after === before) return false;
      const wasDirty = this.docs.isDirty(doc);
      const edit = minimalEdit(before, after);
      if (edit) {
        const start = doc.model.getPositionAt(edit.start);
        const end = doc.model.getPositionAt(edit.end);
        doc.model.pushEditOperations([], [{ range: monaco.Range.fromPositions(start, end), text: edit.text }], () => null);
      }
      if (!wasDirty) await this.docs.save(path);
      return true;
    }
    const { text, hash } = await ipc.fsRead(path);
    const after = transform(text);
    if (after === text) return false;
    await ipc.fsWrite(path, after, hash);
    return true;
  }

  private typFiles() {
    return (this.state.workspace?.files ?? []).filter((f) => f.endsWith('.typ'));
  }

  async newFile(folder = this.defaultFolder()) {
    const answer = await this.prompt({
      title: 'New file',
      label: 'Name',
      value: folder ? `${folder}/` : '',
      placeholder: 'e.g. notes.typ or chapters/epilogue.typ',
      okLabel: 'Create',
      help: 'Folders in the name are created as needed.',
    });
    const path = answer && Studio.validName(answer);
    if (answer && !path) return this.toast(`“${answer}” isn't a usable file name`, 'error');
    if (!path) return;
    try {
      if (path.includes('/')) await ipc.fsMkdir(path.slice(0, path.lastIndexOf('/'))).catch(() => {});
      await ipc.fsWrite(path, '', null);
      await this.refreshFiles();
      await this.openFile(path);
    } catch (e) {
      this.toast(`Couldn't create ${path}: ${errorMessage(e)}`, 'error');
    }
  }

  async newFolder(folder = this.defaultFolder()) {
    const answer = await this.prompt({ title: 'New folder', label: 'Name', value: folder ? `${folder}/` : '', placeholder: 'e.g. figures', okLabel: 'Create' });
    const path = answer && Studio.validName(answer);
    if (answer && !path) return this.toast(`“${answer}” isn't a usable folder name`, 'error');
    if (!path) return;
    try {
      await ipc.fsMkdir(path);
      await this.refreshFiles();
      this.toast(`Created ${path}/ (it shows in the file list once it has a file in it)`);
    } catch (e) {
      this.toast(`Couldn't create ${path}: ${errorMessage(e)}`, 'error');
    }
  }

  /** Open tabs inside `path` (a file or a folder). */
  private tabsUnder(path: string) {
    return this.state.tabs.filter((t) => t === path || t.startsWith(`${path}/`));
  }

  /**
   * Rename a file or folder (in place), then point every reference in the
   * book's .typ files at the new name, and move open tabs along. Refuses while
   * an affected file has unsaved edits.
   */
  async renamePath(path: string) {
    const ws = this.state.workspace;
    if (!ws) return;
    const name = path.split('/').pop()!;
    const dir = path.slice(0, path.length - name.length).replace(/\/$/, '');
    const answer = await this.prompt({ title: `Rename ${name}`, label: 'New name', value: name, okLabel: 'Rename', help: 'References to it in the book (#include, images…) are updated too.' });
    if (!answer || answer.trim() === name) return;
    const newName = answer.trim();
    if (newName.includes('/') || !Studio.validName(newName)) return this.toast(`“${newName}” isn't a usable name`, 'error');
    const to = dir ? `${dir}/${newName}` : newName;
    const open = this.tabsUnder(path);
    const dirty = open.filter((t) => this.state.dirty[t]);
    if (dirty.length) return this.toast(`Save or close ${dirty.join(', ')} first: it has unsaved changes.`, 'error');
    const active = this.state.active;
    for (const t of open) await this.closeTab(t);
    try {
      await ipc.fsRename(path, to);
    } catch (e) {
      for (const t of open) await this.openFile(t, { activate: false }).catch(() => {});
      return this.toast(`Couldn't rename: ${errorMessage(e)}`, 'error');
    }
    // References: every .typ file, at its new location if it moved too.
    let updated = 0;
    const files: string[] = [];
    const moved = (f: string) => (f === path || f.startsWith(`${path}/`) ? to + f.slice(path.length) : f);
    for (const was of this.typFiles()) {
      const now = moved(was);
      try {
        let count = 0;
        const changed = await this.editFile(now, (text) => {
          const r = updateReferences(text, now, path, to, was);
          count = r.count;
          return r.text;
        });
        if (changed) {
          updated += count;
          files.push(now);
        }
      } catch (e) {
        this.toast(`Renamed, but couldn't update references in ${now}: ${errorMessage(e)}`, 'error');
      }
    }
    // The file list must know the new name before the main file can point at it.
    await this.refreshFiles();
    if (ws.entry && (ws.entry === path || ws.entry.startsWith(`${path}/`))) await this.setEntryPoint(moved(ws.entry));
    for (const t of open) await this.openFile(moved(t), { activate: false }).catch(() => {});
    if (active && open.includes(active)) await this.openFile(moved(active)).catch(() => {});
    this.toast(`Renamed to ${newName}${updated ? `; updated ${updated} reference${updated > 1 ? 's' : ''} in ${files.join(', ')}` : ''}`);
  }

  async duplicate(path: string) {
    const name = path.split('/').pop()!;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [path.slice(0, path.length - name.length + dot), name.slice(dot)] : [path, ''];
    const files = new Set(this.state.workspace?.files ?? []);
    let copy = `${stem} copy${ext}`;
    for (let i = 2; files.has(copy); i++) copy = `${stem} copy ${i}${ext}`;
    try {
      if (this.state.dirty[path]) await this.save(path);
      await ipc.fsCopy(path, copy);
      await this.refreshFiles();
      await this.openFile(copy);
    } catch (e) {
      this.toast(`Couldn't duplicate ${path}: ${errorMessage(e)}`, 'error');
    }
  }

  /**
   * Move a file or folder to the Trash, after confirming. Whole-line
   * #include lines for it are removed too (otherwise the book stops
   * compiling); other references are named in the confirmation.
   */
  async trashPath(path: string) {
    const ws = this.state.workspace;
    if (!ws) return;
    const refs: { file: string; include: boolean }[] = [];
    for (const f of this.typFiles()) {
      if (f === path || f.startsWith(`${path}/`)) continue;
      const doc = this.docs?.get(f);
      const text = doc ? doc.model.getValue() : await ipc.fsRead(f).then((r) => r.text, () => '');
      for (const ref of referencesTo(text, f, path)) refs.push({ file: f, include: ref.wholeInclude });
    }
    const includeFiles = [...new Set(refs.filter((r) => r.include).map((r) => r.file))];
    const otherFiles = [...new Set(refs.filter((r) => !r.include).map((r) => r.file))];
    const dirty = this.tabsUnder(path).filter((t) => this.state.dirty[t]);
    const lines = [
      `Move “${path}” to the Trash? You can put it back from the Trash in Finder, and History keeps a copy.`,
      includeFiles.length ? `Its #include line in ${includeFiles.join(', ')} will be removed too.` : '',
      otherFiles.length ? `${otherFiles.join(', ')} also refer${otherFiles.length === 1 ? 's' : ''} to it, and won't compile until you change that.` : '',
      dirty.length ? `Unsaved changes in ${dirty.join(', ')} will be lost.` : '',
    ].filter(Boolean);
    if (!(await this.confirmAction(lines.join('\n\n'), 'Move to Trash', 'Move to Trash'))) return;
    for (const t of this.tabsUnder(path)) {
      this.store.set((st) => ({ dirty: { ...st.dirty, [t]: false } }));
      await this.closeTab(t);
    }
    try {
      await ipc.fsTrash(path);
    } catch (e) {
      return this.toast(`Couldn't move it to the Trash: ${errorMessage(e)}`, 'error');
    }
    let removed = 0;
    for (const f of includeFiles) {
      await this.editFile(f, (text) => {
        const r = removeIncludes(text, f, path);
        removed += r.count;
        return r.text;
      }).catch((e) => this.toast(`Couldn't update ${f}: ${errorMessage(e)}`, 'error'));
    }
    await this.refreshFiles();
    this.toast(`Moved ${path} to the Trash${removed ? ` and removed its #include from ${includeFiles.join(', ')}` : ''}`);
  }

  /** A yes/no question (native dialog; the self-test overrides it). */
  confirmAction: (message: string, title: string, okLabel: string) => Promise<boolean> = (message, title, okLabel) =>
    ask(message, { title, kind: 'warning', okLabel, cancelLabel: 'Cancel' });

  // ---- chapters -----------------------------------------------------------------------

  /** File → New Chapter: ask for a title, then add the chapter. */
  async newChapter() {
    const ws = this.state.workspace;
    if (!ws) return;
    const title = await this.prompt({
      title: 'New chapter',
      label: 'Chapter title',
      placeholder: 'e.g. The Island',
      okLabel: 'Add chapter',
      help: ws.entry
        ? `Creates a numbered file in the chapters folder and adds it to ${ws.entry} after the last chapter.`
        : 'Creates a numbered file in the chapters folder.',
    });
    if (title?.trim()) await this.addChapter(title.trim());
  }

  /**
   * Create chapters/NN-title.typ (numbered after the last one, with the same
   * #import lines) and add its #include to the main file, then open it. The
   * main file is changed in its buffer (undoable) and saved unless it already
   * had unsaved edits.
   */
  async addChapter(title: string): Promise<string | null> {
    const ws = this.state.workspace;
    if (!ws || !this.docs) return null;
    // Chapters live next to the main file, in "chapters".
    const folder = `${ws.entry?.includes('/') ? ws.entry.slice(0, ws.entry.lastIndexOf('/') + 1) : ''}chapters`;
    const path = nextChapterPath(ws.files, title, folder);
    const sample = ws.files.filter((f) => f.startsWith(`${folder}/`) && f.endsWith('.typ')).sort()[0];
    const imports = sample ? chapterImports((await ipc.fsRead(sample).catch(() => ({ text: '' }))).text) : [];
    try {
      await ipc.fsWrite(path, chapterText(title, imports), null);
    } catch (e) {
      this.toast(`Couldn't create ${path}: ${errorMessage(e)}`, 'error');
      return null;
    }
    if (ws.entry) {
      try {
        const doc = await this.docs.open(ws.entry);
        const wasDirty = this.docs.isDirty(doc);
        const before = doc.model.getValue();
        const edit = minimalEdit(before, withInclude(before, includePath(ws.entry, path)));
        if (edit) {
          const start = doc.model.getPositionAt(edit.start);
          const end = doc.model.getPositionAt(edit.end);
          doc.model.pushEditOperations([], [{ range: monaco.Range.fromPositions(start, end), text: edit.text }], () => null);
        }
        if (!wasDirty) await this.docs.save(ws.entry);
      } catch (e) {
        this.toast(`Created ${path}, but couldn't add it to ${ws.entry}: ${errorMessage(e)}`, 'error');
      }
    }
    await this.refreshFiles();
    await this.openFile(path);
    const model = this.editor?.getModel();
    if (model) {
      const last = model.getLineCount();
      this.editor!.setPosition({ lineNumber: last, column: model.getLineMaxColumn(last) });
      this.editor!.focus();
    }
    this.toast(ws.entry ? `Added ${path} to ${ws.entry}` : `Created ${path}`);
    return path;
  }

  // ---- help for writers new to Typst ------------------------------------------------

  openGuide() {
    this.store.set({ guideOpen: true });
    this.events.emit('show-agent-pane');
  }

  closeGuide() {
    this.store.set({ guideOpen: false });
  }

  /** Put a guide example at the cursor (block examples get their own paragraph). Undoable. */
  insertSnippet(code: string) {
    const editor = this.editor;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection || !this.state.active) {
      this.toast('Open a chapter first, then put the cursor where the example should go.');
      return;
    }
    const line = model.getLineContent(selection.startLineNumber);
    const before = line.slice(0, selection.startColumn - 1);
    const after = model.getLineContent(selection.endLineNumber).slice(selection.endColumn - 1);
    editor.pushUndoStop();
    editor.executeEdits('typst-guide', [{ range: selection, text: snippetInsertion(code, before, after), forceMoveMarkers: true }]);
    editor.pushUndoStop();
    editor.focus();
  }

  /** Errors across the book, in file and line order. */
  private errorList() {
    return [...this.diagnostics.entries()]
      .flatMap(([path, list]) => list.filter((d) => d.severity === 1).map((d) => ({ path, d })))
      .sort((a, b) => a.path.localeCompare(b.path) || a.d.range.start.line - b.d.range.start.line);
  }

  /** Select the next error after the cursor (wrapping around), opening its file. */
  async nextProblem() {
    const errors = this.errorList();
    if (!errors.length) return null;
    const cursor = this.state.cursor;
    const active = this.state.active;
    const next =
      errors.find(({ path, d }) => {
        if (!active || !cursor) return true;
        const c = path.localeCompare(active);
        return c > 0 || (c === 0 && d.range.start.line + 1 > cursor.line);
      }) ?? errors[0];
    await this.openFile(next.path);
    const { start, end } = next.d.range;
    const range = new monaco.Range(start.line + 1, start.character + 1, end.line + 1, end.character + 1);
    this.editor?.setSelection(range);
    this.editor?.revealRangeInCenterIfOutsideViewport(range);
    this.editor?.focus();
    return next;
  }

  /** Ask the assistant to explain and fix the next error, with its line attached. */
  async fixProblem(problem?: { path: string; d: LspDiagnostic }) {
    problem ??= (await this.nextProblem()) ?? undefined;
    if (!problem || !this.editor) return;
    if (this.state.active !== problem.path) await this.openFile(problem.path);
    const model = this.editor.getModel()!;
    const { start, end } = problem.d.range;
    this.editor.setSelection(new monaco.Range(start.line + 1, 1, end.line + 1, model.getLineMaxColumn(end.line + 1)));
    this.setAgent({ attachments: [] });
    await this.attachSelection({ focus: false });
    this.events.emit('show-agent-pane');
    this.closeGuide();
    await this.send(`Typst reports an error here: “${problem.d.message}”. Explain in a sentence or two, in plain words, what's wrong, then fix it.`);
  }

  /** The Typst error under a position in the active file (1-based), if any. */
  errorAt(line: number, column: number) {
    const path = this.state.active;
    const d = path
      ? (this.diagnostics.get(path) ?? []).find((x) => {
          if (x.severity !== 1) return false;
          const { start, end } = x.range;
          const after = line - 1 > start.line || (line - 1 === start.line && column - 1 >= start.character);
          const before = line - 1 < end.line || (line - 1 === end.line && column - 1 <= end.character);
          return after && before;
        })
      : undefined;
    return path && d ? { path, d } : null;
  }

  // ---- selection actions (context menus) -------------------------------------------

  /** Options mode on the current selection: attach it and wait for the author's request. */
  async optionsForSelection() {
    await this.setMode('options');
    this.setAgent({ attachments: [] });
    await this.attachSelection();
    this.events.emit('show-agent-pane');
  }

  /** Ask for a plain-words explanation of the selection (no changes). */
  async explainSelection() {
    this.setAgent({ attachments: [] });
    await this.attachSelection({ focus: false });
    this.events.emit('show-agent-pane');
    await this.send("Explain this passage in plain words, including what any Typst markup in it does. Don't change anything.");
  }

  async closeTabs(paths: string[]) {
    for (const p of paths) await this.closeTab(p);
  }

  /** Make a .typ file the book's main file (saved in .typst-studio.json). */
  async setEntryPoint(path: string) {
    const errors = await this.updateProjectSettings({ entryPoint: path });
    if (errors.length) this.toast(errors.join(' '), 'error');
    else this.toast(`${path} is now the main file`);
  }

  absolutePath(path: string) {
    return `${this.state.workspace?.root ?? ''}/${path}`.replace(/\/$/, '');
  }

  async reveal(path: string) {
    try {
      await ipc.revealInFinder(path);
    } catch (e) {
      this.toast(`Couldn't show it in Finder: ${errorMessage(e)}`, 'error');
    }
  }

  copy(text: string, what = 'Copied') {
    copyText(text).then(
      () => this.toast(what),
      (e) => this.toast(`Couldn't copy: ${errorMessage(e)}`, 'error'),
    );
  }

  private jumpCatcher: ((jump: SourceJump) => void) | null = null;

  /** Click a marked text run in the preview and catch where Tinymist says it comes from. */
  private async sourceOf(which: 'start' | 'end'): Promise<SourceJump | null> {
    const jump = new Promise<SourceJump | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 1500);
      this.jumpCatcher = (j) => {
        clearTimeout(timer);
        resolve(j);
      };
    });
    await ipc.previewEval(
      `(() => { const el = document.querySelector('[data-studio-sel="${which}"]'); if (el) { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 1, clientY: r.top + r.height / 2 })); } })()`,
    );
    const result = await jump;
    this.jumpCatcher = null;
    return result;
  }

  /**
   * Text selected in the preview: find it in the source (where the preview's
   * click-to-source mapping points, then the exact text nearby) and select it
   * in the editor, so it goes with the next chat message.
   */
  private async previewSelection(report: { text: string; end?: boolean }) {
    if (!report.text.trim() || this.jumpCatcher) return;
    const start = await this.sourceOf('start');
    const end = report.end ? await this.sourceOf('end') : null;
    const root = this.state.workspace?.root;
    if (!start?.start || !root || !start.filepath.startsWith(root + '/')) return;
    const path = start.filepath.slice(root.length + 1);
    this.suppressSyncUntil = performance.now() + 800;
    await this.openFile(path);
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model || this.state.active !== path) return;
    const a = model.getOffsetAt({ lineNumber: start.start[0] + 1, column: start.start[1] + 1 });
    const sameFile = end?.start && end.filepath === start.filepath;
    const b = sameFile ? model.getOffsetAt({ lineNumber: end!.end![0] + 1, column: end!.end![1] + 1 }) : a;
    // Look for the text around where the preview says it starts.
    const from = model.getOffsetAt({ lineNumber: Math.max(1, start.start[0] - 2), column: 1 });
    const toLine = Math.min(model.getLineCount(), (sameFile ? end!.start![0] : start.start[0]) + 4);
    const to = model.getOffsetAt({ lineNumber: toLine, column: model.getLineMaxColumn(toLine) });
    const windowText = model.getValue().slice(from, to);
    const found = findInSource(windowText, report.text, a - from) ?? findPartial(windowText, report.text, a - from);
    const [s0, s1] = found ? [from + found[0], from + found[1]] : [Math.min(a, b), Math.max(a, b, model.getOffsetAt({ lineNumber: start.start[0] + 1, column: model.getLineMaxColumn(start.start[0] + 1) }))];
    const range = monaco.Range.fromPositions(model.getPositionAt(s0), model.getPositionAt(s1));
    this.selectionFrom = 'preview';
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
    this.onEditorSelection();
  }

  /** Right-click in the preview (reported by the preview webview). */
  private async previewContextMenu(x: number, y: number, selection: string) {
    // Tinymist handles clicks on its text elements; the topmost element at the point
    // can be a canvas layer, so find the text under (or nearest to) the point.
    const click = () =>
      ipc.previewEval(`(() => {
        const x = ${x}, y = ${y};
        let best = null, bestD = Infinity;
        for (const t of document.querySelectorAll('.typst-text')) {
          const r = t.getBoundingClientRect();
          const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
          const d = dx * dx + dy * dy;
          if (d < bestD) { best = t; bestD = d; }
        }
        if (best) best.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      })()`);
    await showContextMenu([
      !!selection.trim() && { label: 'Copy', action: () => this.copy(selection) },
      'separator',
      { label: 'Show the Text Here', action: () => void click() },
      { label: 'Export PDF', accelerator: 'CmdOrCtrl+Shift+E', action: () => void this.exportPdf(), enabled: !this.state.exporting },
      { label: 'Restart Preview', action: () => void this.restartTypst() },
    ]);
  }

  // ---- new book from a template ------------------------------------------------------

  openNewBook() {
    this.store.set({ newBookOpen: true });
    this.syncPreviewVisibility();
  }

  closeNewBook() {
    this.store.set({ newBookOpen: false });
    this.syncPreviewVisibility();
  }

  /** Create `parent/<title>` from a template and open it. Throws (for the dialog) if that fails. */
  async createBook(templateId: string, info: { title: string; author: string; size?: { width: string; height: string } }, parent: string) {
    const paper = PAPER_TEMPLATES.find((t) => t.id === templateId);
    if (paper) return this.createPaper(paper, info, parent);
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error(`Unknown template ${templateId}`);
    const files = templateFiles(template, { ...info, year: String(new Date().getFullYear()) });
    const root = await ipc.projectCreate(parent, bookFolderName(info.title), files);
    // Remembered for next time, except by self-tests (they share the author's storage).
    if (!this.state.launch?.selftestOut) {
      localStorage.setItem(NEW_BOOK_PARENT, parent);
      if (info.author.trim()) localStorage.setItem(AUTHOR_KEY, info.author.trim());
    }
    this.closeNewBook();
    await this.openWorkspace(root);
    await this.openFile(template.firstFile).catch(() => {});
    this.toast(`Created “${root.split('/').pop()}” from the ${template.name} template`);
  }

  /**
   * A paper from an official template package (downloaded from Typst
   * Universe). Its title and authors live in the template's own markup, so the
   * assistant is offered the job of filling them in (the message waits in
   * the composer).
   */
  private async createPaper(paper: (typeof PAPER_TEMPLATES)[number], info: { title: string; author: string }, parent: string) {
    const created = await ipc.projectCreateFromPackage(parent, bookFolderName(info.title), paper.package, paperExtras(info));
    if (!this.state.launch?.selftestOut) {
      localStorage.setItem(NEW_BOOK_PARENT, parent);
      if (info.author.trim()) localStorage.setItem(AUTHOR_KEY, info.author.trim());
    }
    this.closeNewBook();
    await this.openWorkspace(created.root);
    await this.openFile(created.entry).catch(() => {});
    const fonts = paper.fonts ?? [];
    if (fonts.length) {
      this.pushItem({
        kind: 'notice',
        id: uid('n'),
        tone: 'info',
        text: `The ${paper.name} template looks best with ${fonts.map((f) => f.name).join(' and ')} (free). Without them Typst uses similar fonts and shows a warning. To install: brew install --cask ${fonts.map((f) => f.cask).join(' ')}`,
      });
    }
    this.events.emit('show-agent-pane');
    this.fillComposer(paperSetupMessage(info));
    this.toast(`Created “${created.root.split('/').pop()}” from the ${paper.name} template (${paper.package.name} ${paper.package.version})`);
  }

  /** Open a file with the cursor on a line (1-based). */
  async openAt(path: string, line: number) {
    await this.openFile(path);
    this.editor?.setPosition({ lineNumber: line, column: 1 });
    this.editor?.revealLineInCenter(line);
    this.editor?.focus();
  }

  showSidebar(view: StudioState['sidebar']) {
    this.store.set({ sidebar: view });
    if (view === 'history') void this.history.refresh().catch(() => {});
  }

  /** Exported PDFs aren't part of the book's history. */
  private historyExcludes(): string[] {
    const dir = this.state.project.settings.outputDir?.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
    const entry = this.state.workspace?.entry;
    return [...(dir ? [`/${dir}/`] : []), ...(entry ? [`/${entry.replace(/\.typ$/, '')}.pdf`] : [])];
  }

  private async closeWorkspace() {
    if (!this.state.workspace) return;
    this.composerDraft = '';
    this.code.reset();
    await this.history.stop();
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = null;
    await Promise.allSettled([this.typst.stop(), this.agent?.stop(), ipc.previewClose()]);
    this.previewOpened = false;
    this.docs?.dispose();
    this.docs = null;
    this.agent = null;
    this.diagnostics.clear();
    this.viewStates.clear();
    this.store.set({
      workspace: null,
      tabs: [],
      active: null,
      dirty: {},
      conflicts: {},
      problems: { errors: 0, warnings: 0 },
      compile: { status: 'idle' },
      preview: { status: 'off' },
      agent: initialState.agent,
      project: initialState.project,
      styleGuide: initialState.styleGuide,
    });
    this.styleGuideText = null;
  }

  async refreshFiles() {
    const root = this.state.workspace?.root;
    if (!root) return;
    const files = await ipc.workspaceList();
    // Update only the file list, against the current workspace: other fields (the
    // entry point) may have changed while the listing was in flight.
    this.store.set((s) => (s.workspace?.root === root ? { workspace: { ...s.workspace, files } } : {}));
  }

  private onDiskChange(paths: string[]) {
    for (const p of paths) this.pendingDisk.add(p);
    clearTimeout(this.diskTimer);
    this.diskTimer = window.setTimeout(() => {
      const batch = [...this.pendingDisk];
      this.pendingDisk.clear();
      void this.docs?.diskChanged(batch);
      void this.refreshFiles().then(() => this.code.scan());
      this.history.scheduleSave();
      if (batch.includes(PROJECT_FILE)) void this.loadProjectSettings({ restartIfNeeded: true });
      if (batch.includes(STYLE_GUIDE_FILE)) void this.loadStyleGuide({ updateSession: true });
    }, 120);
  }

  // ---- tabs / editor ------------------------------------------------------------

  attachEditor(editor: monaco.editor.IStandaloneCodeEditor) {
    this.editor = editor;
    const active = this.state.active && this.docs?.get(this.state.active);
    if (active) editor.setModel(active.model);
  }

  async openFile(path: string, { activate = true } = {}) {
    if (!this.docs) return;
    try {
      await this.docs.open(path);
    } catch (e) {
      this.toast(`Can't open ${path}: ${errorMessage(e)}`, 'error');
      return;
    }
    this.store.set((s) => ({ tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path] }));
    if (activate) this.activate(path);
    this.persistTabs();
  }

  activate(path: string) {
    const doc = this.docs?.get(path);
    if (!doc) return;
    const current = this.state.active;
    if (this.editor && current && current !== path) this.viewStates.set(current, this.editor.saveViewState());
    this.store.set({ active: path });
    if (this.editor) {
      this.editor.setModel(doc.model);
      const view = this.viewStates.get(path);
      if (view) this.editor.restoreViewState(view);
      this.editor.focus();
    }
    this.persistTabs();
  }

  async closeTab(path: string) {
    if (this.state.dirty[path]) {
      const discard = await ask(`${path} has unsaved changes. Close it and discard them?`, {
        title: 'Unsaved changes',
        kind: 'warning',
        okLabel: 'Discard changes',
        cancelLabel: 'Cancel',
      });
      if (!discard) return;
    }
    const tabs = this.state.tabs.filter((t) => t !== path);
    this.docs?.close(path);
    this.viewStates.delete(path);
    this.store.set((s) => {
      const dirty = { ...s.dirty };
      delete dirty[path];
      return { tabs, dirty };
    });
    if (this.state.active === path) {
      const next = tabs[tabs.length - 1];
      if (next) this.activate(next);
      else {
        this.store.set({ active: null });
        this.editor?.setModel(null);
      }
    }
    this.persistTabs();
  }

  private persistTabs() {
    const root = this.state.workspace?.root;
    if (root) writeJson(tabsKey(root), { tabs: this.state.tabs, active: this.state.active });
  }

  setCursor(line: number, column: number) {
    this.store.set({ cursor: { line, column } });
    this.schedulePreviewSync();
  }

  // ---- source ↔ preview sync ----------------------------------------------------

  /** Source → preview: once the cursor settles, scroll the preview to it. */
  private schedulePreviewSync() {
    if (performance.now() < this.suppressSyncUntil) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => void this.syncPreviewToCursor(), 150);
  }

  async syncPreviewToCursor() {
    const root = this.state.workspace?.root;
    const path = this.state.active;
    const model = this.editor?.getModel();
    const pos = this.editor?.getPosition();
    if (!root || !path?.endsWith('.typ') || !model || !pos || !this.previewOpened || !this.typst.running) return;
    const lineAt = (n: number) => (n >= 0 && n < model.getLineCount() ? model.getLineContent(n + 1) : null);
    const run = ++this.syncRun;
    // Best candidate first; stop at the first the preview actually jumps to
    // (one smooth scroll, one ripple). Unmapped positions are silently ignored.
    for (const c of jumpCandidates(lineAt, pos.lineNumber - 1, pos.column - 1).slice(0, 16)) {
      if (run !== this.syncRun) return; // the cursor moved again
      const jumped = this.nextPreviewJump(80);
      await this.typst.scrollPreviewTo(`${root}/${path}`, c.line, c.character).catch(() => {});
      if (await jumped) return;
    }
  }

  private nextPreviewJump(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (v: boolean) => {
        this.jumpWaiters.delete(onJump);
        clearTimeout(timer);
        resolve(v);
      };
      const onJump = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.jumpWaiters.add(onJump);
    });
  }

  /** Preview → source: a click on rendered content selects the source that produced it. */
  private async revealSource(jump: SourceJump) {
    const root = this.state.workspace?.root;
    if (!root || !jump.start || !jump.end || !jump.filepath.startsWith(root + '/')) return;
    const path = jump.filepath.slice(root.length + 1);
    this.suppressSyncUntil = performance.now() + 600;
    clearTimeout(this.syncTimer);
    await this.openFile(path);
    const editor = this.editor;
    if (!editor || this.state.active !== path) return;
    const range = new monaco.Range(jump.start[0] + 1, jump.start[1] + 1, jump.end[0] + 1, jump.end[1] + 1);
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
    // The click gave the preview webview keyboard focus; hand it back to the editor.
    await ipc.focusMain().catch(() => {});
    editor.focus();
  }

  async save(path = this.state.active, opts?: { overwrite?: boolean }) {
    if (!path || !this.docs) return;
    try {
      await this.docs.save(path, opts);
      this.history.scheduleSave();
    } catch (e) {
      this.toast(`Not saved: ${errorMessage(e)}`, 'error');
    }
  }

  async reloadFromDisk(path: string) {
    try {
      await this.docs?.reload(path);
    } catch (e) {
      this.toast(`Reload failed: ${errorMessage(e)}`, 'error');
    }
  }

  private onDiagnostics(uri: string, list: LspDiagnostic[]) {
    const root = this.state.workspace?.root;
    const path = root ? uriToRelative(uri, root) : null;
    if (!path) return;
    if (list.length) this.diagnostics.set(path, list);
    else this.diagnostics.delete(path);
    this.docs?.setDiagnostics(path, list);
    let errors = 0;
    let warnings = 0;
    for (const ds of this.diagnostics.values()) {
      for (const d of ds) {
        if (d.severity === 1) errors++;
        else if (d.severity === 2) warnings++;
      }
    }
    this.store.set({ problems: { errors, warnings } });
  }

  // ---- Typst / preview -------------------------------------------------------------

  async startTypst() {
    const ws = this.state.workspace;
    if (!ws) return;
    if (!ws.entry) {
      this.store.set({ preview: { status: 'error', error: 'No .typ entry point found in this folder.' } });
      return;
    }
    this.store.set({ preview: { status: 'starting' } });
    try {
      const project = this.state.project.settings;
      const { previewUrl } = await this.typst.start(ws.root, ws.entry, {
        outputPath: outputPathPattern(project),
        fontPaths: absoluteFontPaths(project, ws.root),
      });
      this.docs?.syncLsp();
      this.store.set({ preview: { status: 'starting', url: previewUrl } });
      await this.showPreview();
    } catch (e) {
      this.store.set({ preview: { status: 'error', error: errorMessage(e) } });
    }
  }

  /** Called by PreviewPane whenever its on-screen rectangle changes. */
  setPreviewBounds(bounds: Bounds | null) {
    this.previewBounds = bounds;
    this.previewVisible = !!bounds && bounds.width > 4 && bounds.height > 4;
    if (this.previewOpened && bounds && this.previewVisible) void ipc.previewSetBounds(bounds);
    if (!this.previewOpened) void this.showPreview();
    this.syncPreviewVisibility();
  }

  private syncPreviewVisibility() {
    if (!this.previewOpened) return;
    const ok = this.state.preview.status !== 'error';
    // The preview is a native view above the page; hide it while a dialog is open
    // so the dialog isn't drawn underneath it.
    const dialog = this.state.settingsOpen || this.state.newBookOpen || !!this.state.history.diff || !!this.state.prompt;
    void ipc.previewSetVisible(this.previewVisible && ok && !dialog);
  }

  private async showPreview() {
    const url = this.state.preview.url;
    if (!url || !this.previewBounds || this.previewOpened || !this.previewVisible) return;
    this.previewOpened = true;
    try {
      await ipc.previewOpen(url, this.previewBounds);
      this.syncPreviewVisibility(); // opening shows the webview; respect an open dialog
      setTimeout(() => {
        if (this.state.preview.status === 'starting') this.store.set((s) => ({ preview: { ...s.preview, status: 'ready' } }));
      }, 3000);
    } catch (e) {
      this.previewOpened = false;
      this.store.set({ preview: { status: 'error', error: errorMessage(e) } });
    }
  }

  async restartTypst() {
    await this.typst.stop().catch(() => {});
    await ipc.previewClose().catch(() => {});
    this.previewOpened = false;
    await this.startTypst();
  }

  private publishPerf() {
    const stat = (s: { percentile(p: number): number | null; count: number }): Stat => ({
      p50: s.percentile(50),
      p95: s.percentile(95),
      n: s.count,
    });
    this.store.set({ perf: { input: stat(this.perf.inputToPaint), preview: stat(this.perf.editToPreview) } });
  }

  // ---- agent -----------------------------------------------------------------------

  private setAgent(patch: Partial<StudioState['agent']> | ((a: StudioState['agent']) => Partial<StudioState['agent']>)) {
    const wasRunning = this.state.agent.running;
    this.store.set((s) => ({ agent: { ...s.agent, ...(typeof patch === 'function' ? patch(s.agent) : patch) } }));
    // What the agent changed in this turn becomes one history version.
    if (wasRunning && !this.state.agent.running) {
      void this.history.afterAgent(this.turnMessage);
      void this.code.afterAgentTurn();
    }
  }

  async startAgent() {
    const ws = this.state.workspace;
    if (!ws) return;
    const agent = new OpenCodeAdapter(ws.root);
    this.agent = agent;
    this.setAgent({ status: 'starting', error: undefined });
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = agent.subscribe((e) => this.onAgentEvent(e));
    try {
      await agent.start();
      this.setAgent({ status: 'ready' });
      await this.loadModels();
    } catch (e) {
      this.setAgent({ status: 'error', error: errorMessage(e) });
    }
  }

  /**
   * OpenCode fills its model list in lazily after startup (the first response
   * may list only one provider), so keep refreshing until the saved model and
   * a preferred provider show up.
   */
  async loadModels(attempt = 0) {
    if (!this.agent) return;
    try {
      const [models, serverDefault] = await Promise.all([this.agent.listModels(), this.agent.defaultModel()]);
      const saved = readJson<ModelRef>(MODEL_KEY);
      // Only an active session pins the model; otherwise re-choose as the list fills in.
      const current = this.state.agent.sessionId ? this.state.agent.model : null;
      const chosen = chooseModel(models, { current, saved, serverDefault });
      this.setAgent({ models, model: chosen ? { providerID: chosen.providerID, id: chosen.id } : null });
      const missingSaved = !!saved && !models.some((m) => m.providerID === saved.providerID && m.id === saved.id);
      const missingPreferred = !models.some((m) => PREFERRED_PROVIDERS.includes(m.providerID));
      if ((missingSaved || missingPreferred) && attempt < 8) setTimeout(() => void this.loadModels(attempt + 1), 1500);
    } catch (e) {
      this.setAgent({ error: `Couldn't list models: ${errorMessage(e)}` });
    }
  }

  async selectModel(model: ModelRef) {
    const { sessionId, models } = this.state.agent;
    const info = models.find((m) => m.providerID === model.providerID && m.id === model.id);
    if (info && !info.supportsTools) {
      this.pushItem({
        kind: 'notice',
        id: uid('n'),
        tone: 'error',
        text: `${info.name} doesn't support tool calls, so the agent couldn't read or edit files with it. Pick another model.`,
      });
      return;
    }
    try {
      if (sessionId && this.agent) await this.agent.switchModel(sessionId, model);
      writeJson(MODEL_KEY, model);
      const recentModels = pushRecent(this.state.agent.recentModels, model);
      writeJson('studio.recentModels', recentModels);
      this.setAgent({ model: { providerID: model.providerID, id: model.id }, recentModels });
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Model not changed: ${errorMessage(e)}` });
    }
  }

  /** Switch between Write, Plan and Options (applies to the current conversation). */
  async setMode(mode: AgentMode) {
    const previous = this.state.agent.mode;
    if (mode === previous) return;
    this.setAgent({ mode });
    const { sessionId } = this.state.agent;
    if (!sessionId || !this.agent) return;
    const config = modeConfig(mode);
    try {
      await this.agent.switchAgent(sessionId, config.agent);
      await this.agent.setPermissions(sessionId, this.state.settings.permissions, config.readOnly);
      if (config.instructions) await this.agent.setInstructions(sessionId, MODE_INSTRUCTIONS_KEY, config.instructions);
      else await this.agent.removeInstructions(sessionId, MODE_INSTRUCTIONS_KEY).catch(() => {});
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: config.notice });
    } catch (e) {
      this.setAgent({ mode: previous });
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't switch to ${config.label} mode: ${errorMessage(e)}` });
    }
  }

  /** "Write it": leave plan mode and carry out the agreed plan. */
  async writeFromPlan() {
    await this.setMode('write');
    if (this.state.agent.mode === 'write') await this.send(WRITE_FROM_PLAN_PROMPT);
  }

  newSession() {
    if (this.state.agent.running) return;
    this.setAgent({ sessionId: null, title: null, items: [] });
  }

  /** ⌘I: attach the selection (or cursor position) to the chat and focus it. */
  async attachSelection({ focus = true } = {}) {
    const path = this.state.active;
    const editor = this.editor;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!path || !model || !selection) {
      if (focus) this.events.emit('focus-composer');
      return;
    }
    const captured = await captureSelection(path, model, selection);
    const label = selectionLabel(captured);
    this.setAgent((a) => ({
      attachments: [...a.attachments.filter((x) => x.label !== label), { id: uid('a'), label, selection: captured }],
    }));
    if (focus) this.events.emit('focus-composer');
  }

  private selectionTimer: number | undefined;
  /** Set while a preview selection is being mapped, so it's labelled as coming from the preview. */
  private selectionFrom: 'editor' | 'preview' = 'editor';

  /** The editor's selection changed: keep the chat's live selection in step (debounced). */
  onEditorSelection() {
    clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(() => void this.captureLiveSelection(), 150);
  }

  private async captureLiveSelection() {
    const path = this.state.active;
    const editor = this.editor;
    const model = editor?.getModel();
    const range = editor?.getSelection();
    const from = this.selectionFrom;
    this.selectionFrom = 'editor';
    if (!path || !model || !range || range.isEmpty()) {
      if (this.state.agent.selection) this.setAgent({ selection: null });
      return;
    }
    const captured = await captureSelection(path, model, range);
    if (!captured.selectedText.trim()) return this.setAgent({ selection: null });
    const label = selectionLabel(captured);
    const key = selectionKey(captured);
    this.setAgent((a) => ({
      selection: { attachment: { id: uid('s'), label, selection: captured }, from },
      selectionDismissed: a.selectionDismissed === key ? key : null,
    }));
  }

  /** Whether the live selection goes with the next message (not dismissed). */
  isSelectionIncluded() {
    const { selection, selectionDismissed } = this.state.agent;
    return !!selection && selectionKey(selection.attachment.selection) !== selectionDismissed;
  }

  /** Leave the current selection out of messages until it changes. */
  dismissSelection() {
    const sel = this.state.agent.selection?.attachment.selection;
    this.setAgent({ selectionDismissed: sel ? selectionKey(sel) : null });
  }

  /** What goes with the next message: pinned attachments, plus the live selection. */
  private outgoingAttachments(): Attachment[] {
    const { attachments, selection, selectionDismissed } = this.state.agent;
    const live =
      selection && selectionKey(selection.attachment.selection) !== selectionDismissed && !attachments.some((a) => a.label === selection.attachment.label) ? [selection.attachment] : [];
    return [...attachments, ...live];
  }

  removeAttachment(id: string) {
    this.setAgent((a) => ({ attachments: a.attachments.filter((x) => x.id !== id) }));
  }

  async send(text: string): Promise<boolean> {
    const { agent, docs } = this;
    const state = this.state.agent;
    if (!agent || state.status !== 'ready' || state.running || !text.trim()) return false;
    // SPEC §4: flush pending editor writes so the agent sees what the user sees.
    const failures = (await docs?.saveAll()) ?? [];
    if (failures.length) {
      this.pushItem({
        kind: 'notice',
        id: uid('n'),
        tone: 'error',
        text: `Not sent: couldn't save ${failures.map((f) => `${f.path} (${errorMessage(f.error)})`).join(', ')}`,
      });
      return false;
    }
    // Everything up to now is its own version, so the agent's changes can be undone separately.
    await this.history.beforeAgent();
    this.turnMessage = text;
    this.turnErrors.clear();
    // Options replace a passage: use the editor's cursor when nothing is selected or attached.
    if (state.mode === 'options' && !this.outgoingAttachments().length) await this.attachSelection({ focus: false });
    const attachments = this.outgoingAttachments();
    const context = attachments.map((a) => ({
      selection: a.selection,
      stale: docs?.get(a.selection.relativePath)?.model.getVersionId() !== a.selection.documentVersion,
    }));
    const target = attachments[0]?.selection;
    this.optionsTurn =
      state.mode === 'options'
        ? { target: target ? { path: target.relativePath, start: target.start, end: target.end, text: target.selectedText } : null }
        : null;
    this.setAgent((a) => ({
      running: true,
      attachments: [],
      items: [...a.items, { kind: 'user', id: uid('u'), text, attachments: attachments.map((x) => x.label) }],
    }));
    try {
      let sessionId = this.state.agent.sessionId;
      if (!sessionId) {
        const config = modeConfig(this.state.agent.mode);
        sessionId = await agent.createSession(this.state.agent.model, {
          permissions: this.state.settings.permissions,
          readOnly: config.readOnly,
          agent: config.agent,
        });
        this.setAgent({ sessionId });
        await this.applyInstructions(sessionId);
      }
      await agent.send(sessionId, text, context);
      return true;
    } catch (e) {
      this.setAgent({ running: false });
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Message not sent: ${errorMessage(e)}` });
      return false;
    }
  }

  async cancel() {
    const { sessionId } = this.state.agent;
    if (!sessionId || !this.agent) return;
    try {
      await this.agent.cancel(sessionId);
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Stop failed: ${errorMessage(e)}` });
    }
    void this.checkTurnEnded(800);
  }

  async replyPermission(requestId: string, decision: PermissionDecision) {
    const { sessionId } = this.state.agent;
    if (!sessionId || !this.agent) return;
    this.updateItem(requestId, (it) => (it.kind === 'permission' ? { ...it, state: 'sending' } : it));
    try {
      await this.agent.replyPermission(sessionId, requestId, decision);
    } catch (e) {
      this.updateItem(requestId, (it) => (it.kind === 'permission' ? { ...it, state: 'pending' } : it));
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Permission reply failed: ${errorMessage(e)}` });
    }
  }

  /** Session context: this is a Typst book, not a software project (see instructions.ts). */
  private async applyInstructions(sessionId: string) {
    const ws = this.state.workspace;
    if (!ws || !this.agent) return;
    const text = buildInstructions({
      projectName: ws.name,
      entry: ws.entry,
      typFiles: ws.files.filter((f) => f.endsWith('.typ')),
      codeExamples: ws.files.includes(OUTPUTS_FILE) || this.state.code.cells.length > 0,
    });
    try {
      await this.agent.setInstructions(sessionId, INSTRUCTIONS_KEY, text);
      if (this.styleGuideText?.trim()) await this.agent.setInstructions(sessionId, STYLE_INSTRUCTIONS_KEY, styleInstructions(this.styleGuideText));
      const modeText = modeConfig(this.state.agent.mode).instructions;
      if (modeText) await this.agent.setInstructions(sessionId, MODE_INSTRUCTIONS_KEY, modeText);
    } catch (e) {
      // Still usable without them, but the agent will behave like a coding assistant: say so.
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't set the writing-assistant instructions: ${errorMessage(e)}` });
    }
  }

  private newOptionsState(): { options?: OptionsState } {
    const target = this.optionsTurn?.target ?? null;
    return this.optionsTurn ? { options: { target, original: target, applied: null } } : {};
  }

  /**
   * Put option `index` of an Options reply in place of its passage: an ordinary
   * editor edit (undoable, unsaved until the author saves). Picking another
   * option afterwards replaces the one in use (or the original passage, if the
   * author undid it). If the text moved, it's found again only when that's
   * unambiguous; otherwise nothing changes.
   */
  async applyOption(itemId: string, index: number) {
    const item = this.state.agent.items.find((i) => i.id === itemId);
    if (item?.kind !== 'assistant' || !item.options?.target) return;
    const option = parseOptions(item.text).options[index];
    if (option?.text == null || !option.complete) return;
    const { target, original } = item.options;
    const fail = (why: string) => this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Option ${option.n} not applied: ${why}` });
    try {
      await this.openFile(target.path);
    } catch (e) {
      return fail(errorMessage(e));
    }
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model || this.state.active !== target.path) return fail(`couldn't open ${target.path}.`);
    const locate = (t: OptionTarget | null): monaco.Range | null => {
      if (!t) return null;
      const at = new monaco.Range(t.start.line, t.start.column, t.end.line, t.end.column);
      if (model.validateRange(at).equalsRange(at) && model.getValueInRange(at) === t.text) return at;
      const matches = t.text ? model.findMatches(t.text, false, false, true, null, false, 2) : [];
      return matches.length === 1 ? matches[0].range : null;
    };
    const range = locate(target) ?? locate(original);
    if (!range) return fail('the passage has changed since you asked. Select it and ask again, or copy the option.');
    const start = range.getStartPosition();
    editor.pushUndoStop();
    editor.executeEdits('agent-option', [{ range, text: option.text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    const end = model.getPositionAt(model.getOffsetAt(start) + option.text.length);
    editor.setSelection(monaco.Range.fromPositions(start, end));
    editor.revealRangeInCenterIfOutsideViewport(monaco.Range.fromPositions(start, end));
    const applied: OptionTarget = {
      path: target.path,
      start: { line: start.lineNumber, column: start.column },
      end: { line: end.lineNumber, column: end.column },
      text: model.getValueInRange(monaco.Range.fromPositions(start, end)),
    };
    this.updateItem(itemId, (it) => (it.kind === 'assistant' && it.options ? { ...it, options: { ...it.options, target: applied, applied: index } } : it));
  }

  private agentError(message: string) {
    this.turnErrors.add(message);
    const m = this.state.agent.model;
    this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: m ? `${m.providerID}/${m.id}: ${message}` : message });
  }

  private pushItem(item: ChatItem) {
    this.setAgent((a) => ({ items: [...a.items, item] }));
  }

  private updateItem(id: string, fn: (item: ChatItem) => ChatItem) {
    this.setAgent((a) => ({ items: a.items.map((it) => (it.id === id ? fn(it) : it)) }));
  }

  private async checkTurnEnded(delay: number) {
    await new Promise((r) => setTimeout(r, delay));
    const { sessionId, running } = this.state.agent;
    if (!running || !sessionId || !this.agent) return;
    try {
      if (!(await this.agent.isRunning(sessionId))) this.setAgent({ running: false });
    } catch {}
  }

  private onAgentEvent(e: AgentEvent) {
    if (e.type === 'connection') {
      this.setAgent({ connection: e.status });
      return;
    }
    if (e.sessionId !== this.state.agent.sessionId) return;
    switch (e.type) {
      case 'turn-started':
        this.setAgent({ running: true });
        break;
      case 'turn-finished':
        this.setAgent({ running: false });
        if (e.outcome === 'failed') {
          // The same failure usually arrives first as a session error; show it once.
          if (!e.error || !this.turnErrors.has(e.error)) this.agentError(e.error ?? 'The agent stopped with an error.');
        } else if (e.outcome === 'interrupted') {
          this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: 'Stopped.' });
        }
        break;
      case 'step-finished':
        void this.checkTurnEnded(1500);
        break;
      case 'session-renamed':
        this.setAgent({ title: e.title });
        break;
      case 'text-delta': {
        const id = `${e.messageId}:${e.ordinal}`;
        this.setAgent((a) => {
          const idx = a.items.findIndex((it) => it.id === id);
          if (idx < 0) return { items: [...a.items, { kind: 'assistant', id, text: e.delta, done: false, ...this.newOptionsState() }] };
          const items = a.items.slice();
          const it = items[idx] as Extract<ChatItem, { kind: 'assistant' }>;
          items[idx] = { ...it, text: it.text + e.delta };
          return { items };
        });
        break;
      }
      case 'text-ended': {
        const id = `${e.messageId}:${e.ordinal}`;
        this.setAgent((a) =>
          a.items.some((it) => it.id === id)
            ? { items: a.items.map((it) => (it.id === id ? { ...it, text: e.text, done: true } : it)) }
            : { items: [...a.items, { kind: 'assistant', id, text: e.text, done: true, ...this.newOptionsState() }] },
        );
        break;
      }
      case 'tool-started':
        this.pushItem({ kind: 'tool', id: e.callId, name: e.name, summary: '', status: 'running', detail: '' });
        break;
      case 'tool-called':
        this.updateItem(e.callId, (it) => (it.kind === 'tool' ? { ...it, summary: summarizeToolInput(e.input) } : it));
        break;
      case 'tool-succeeded':
        this.updateItem(e.callId, (it) => (it.kind === 'tool' ? { ...it, status: 'done', detail: e.output.slice(0, 4000) } : it));
        break;
      case 'tool-failed':
        this.updateItem(e.callId, (it) => (it.kind === 'tool' ? { ...it, status: 'failed', detail: e.error } : it));
        break;
      case 'permission-asked':
        this.pushItem({
          kind: 'permission',
          id: e.requestId,
          action: e.action,
          resources: e.resources,
          patches: e.patches,
          state: 'pending',
        });
        break;
      case 'permission-replied':
        this.updateItem(e.requestId, (it) =>
          it.kind === 'permission' ? { ...it, state: (['once', 'always', 'reject'].includes(e.reply) ? e.reply : 'reject') as 'once' } : it,
        );
        break;
      case 'session-error':
        if (!this.turnErrors.has(e.message)) this.agentError(e.message);
        break;
      case 'usage':
        break;
    }
  }

  async refreshViewportInset() {
    try {
      const g = await ipc.nativeGeometry('main');
      const insets = (g?.webviewSafeAreaInsets ?? {}) as { top?: number; left?: number };
      const next = { top: insets.top ?? 0, left: insets.left ?? 0 };
      if (next.top !== this.viewportInset.top || next.left !== this.viewportInset.left) {
        this.viewportInset = next;
        window.dispatchEvent(new Event('studio-layout'));
      }
    } catch {
      // Non-macOS or unavailable: no inset.
    }
  }

  // ---- settings -------------------------------------------------------------------

  openSettings() {
    this.store.set({ settingsOpen: true });
    this.syncPreviewVisibility();
  }

  closeSettings() {
    this.store.set({ settingsOpen: false });
    this.syncPreviewVisibility();
    this.events.emit('focus-editor');
  }

  updateSettings(patch: Partial<AppSettings>) {
    const before = this.state.settings;
    const settings = { ...before, ...patch };
    saveSettings(settings);
    this.store.set({ settings });
    if (JSON.stringify(settings.permissions) !== JSON.stringify(before.permissions)) void this.applyPermissions();
  }

  /** Apply the permission settings to the current conversation, and say so in the chat. */
  private async applyPermissions() {
    const { sessionId } = this.state.agent;
    if (!sessionId || !this.agent) return;
    const permissions = this.state.settings.permissions;
    try {
      await this.agent.setPermissions(sessionId, permissions, modeConfig(this.state.agent.mode).readOnly);
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: describePermissions(permissions) });
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't change permissions for this conversation: ${errorMessage(e)}` });
    }
  }

  // ---- project settings (.typst-studio.json) -----------------------------------------

  /** Read the project file. With `restartIfNeeded`, restart Typst when an entry/font/output setting changed on disk. */
  async loadProjectSettings({ restartIfNeeded = false } = {}) {
    let text: string | null = null;
    let hash: string | null = null;
    try {
      const file = await ipc.fsRead(PROJECT_FILE);
      text = file.text;
      hash = file.hash;
    } catch (e) {
      if (!isCmdError(e) || e.kind !== 'notFound') {
        this.store.set((s) => ({ project: { ...s.project, error: errorMessage(e) } }));
        return;
      }
    }
    if (hash !== null && hash === this.state.project.hash) return; // our own write echoing back
    const before = this.state.project.settings;
    const parsed = parseProjectSettings(text);
    this.store.set({ project: { settings: parsed.settings, raw: parsed.raw, hash, error: parsed.error } });
    if (restartIfNeeded && needsRestart(before, parsed.settings)) await this.applyEntryAndRestart(parsed.settings);
  }

  /** Save project settings; returns validation or write errors (empty on success). */
  async updateProjectSettings(patch: ProjectSettings): Promise<string[]> {
    const ws = this.state.workspace;
    if (!ws) return ['No project is open.'];
    const { project } = this.state;
    if (project.error) return [project.error];
    const next = { ...project.settings, ...patch };
    const errors = validateProjectSettings(next, ws.files.filter((f) => f.endsWith('.typ')));
    if (errors.length) return errors;
    const text = serializeProjectSettings(project.raw, patch);
    try {
      const hash = await ipc.fsWrite(PROJECT_FILE, text, project.hash);
      const parsed = parseProjectSettings(text);
      this.store.set({ project: { settings: parsed.settings, raw: parsed.raw, hash, error: null } });
    } catch (e) {
      if (isCmdError(e) && e.kind === 'conflict') {
        await this.loadProjectSettings();
        return [`${PROJECT_FILE} changed on disk; reloaded it. Try again.`];
      }
      return [`Couldn't save ${PROJECT_FILE}: ${errorMessage(e)}`];
    }
    if (needsRestart(project.settings, next)) await this.applyEntryAndRestart(next);
    return [];
  }

  private async applyEntryAndRestart(settings: ProjectSettings) {
    const ws = this.state.workspace;
    if (!ws) return;
    const entry = settings.entryPoint && ws.files.includes(settings.entryPoint) ? settings.entryPoint : ws.entry;
    if (entry !== ws.entry) this.store.set({ workspace: { ...ws, entry } });
    await this.restartTypst();
  }

  /** Export the entry point to PDF through Tinymist, after saving open edits. */
  async exportPdf() {
    const ws = this.state.workspace;
    if (!ws || this.state.exporting) return;
    if (!this.typst.running) {
      this.toast('Export needs the Typst preview running. Restart the preview and try again.', 'error');
      return;
    }
    // Code examples that aren't up to date would print "not run" / "out of date" notes in the PDF.
    const stale = this.code.problems();
    if (stale.length) {
      const answer = await message(
        `${stale.length} code example${stale.length > 1 ? 's are' : ' is'} not up to date, so the PDF would show that:\n\n${stale.slice(0, 8).join('\n')}${stale.length > 8 ? '\n…' : ''}`,
        { title: 'Code examples', kind: 'warning', buttons: { yes: 'Run them, then export', no: 'Export anyway', cancel: 'Cancel' } },
      );
      if (answer === 'Cancel') return;
      if (answer === 'Yes' || answer === 'Run them, then export') await this.code.runAll({ onlyStale: true });
    }
    this.store.set({ exporting: true });
    try {
      const failures = (await this.docs?.saveAll()) ?? [];
      if (failures.length) throw new Error(`couldn't save ${failures.map((f) => f.path).join(', ')}`);
      const path = await this.typst.exportPdf();
      const rel = path.startsWith(ws.root + '/') ? path.slice(ws.root.length + 1) : path;
      this.toast(`Exported ${rel}`);
      void this.refreshFiles();
    } catch (e) {
      this.toast(`Export failed: ${errorMessage(e)}`, 'error');
    } finally {
      this.store.set({ exporting: false });
    }
  }

  // ---- writing style guide (WRITING_STYLE.md) --------------------------------------

  private styleDismissKey() {
    return `studio.styleGuideDismissed:${this.state.workspace?.root ?? ''}`;
  }

  /** Read WRITING_STYLE.md; with `updateSession`, push the new text to the running conversation. */
  async loadStyleGuide({ updateSession = false } = {}) {
    let text: string | null = null;
    try {
      text = (await ipc.fsRead(STYLE_GUIDE_FILE)).text;
    } catch {}
    const changed = text !== this.styleGuideText;
    this.styleGuideText = text;
    const dismissed = (() => {
      try {
        return localStorage.getItem(this.styleDismissKey()) === '1';
      } catch {
        return false;
      }
    })();
    this.store.set({ styleGuide: { exists: text !== null, chars: text?.length ?? 0, dismissed } });
    const { sessionId } = this.state.agent;
    if (!updateSession || !changed || !sessionId || !this.agent) return;
    try {
      if (text?.trim()) await this.agent.setInstructions(sessionId, STYLE_INSTRUCTIONS_KEY, styleInstructions(text));
      else await this.agent.removeInstructions(sessionId, STYLE_INSTRUCTIONS_KEY);
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: text?.trim() ? `Using the updated ${STYLE_GUIDE_FILE}.` : `${STYLE_GUIDE_FILE} was removed; no style guide in use.` });
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't update the style guide for this conversation: ${errorMessage(e)}` });
    }
  }

  /** Create WRITING_STYLE.md from the template and open it. */
  async createStyleGuideFromTemplate() {
    const ws = this.state.workspace;
    if (!ws) return;
    try {
      await ipc.fsWrite(STYLE_GUIDE_FILE, styleGuideTemplate(ws.name), null);
    } catch (e) {
      if (!(isCmdError(e) && e.kind === 'conflict')) {
        this.toast(`Couldn't create ${STYLE_GUIDE_FILE}: ${errorMessage(e)}`, 'error');
        return;
      }
      // It appeared meanwhile: just open it.
    }
    await this.loadStyleGuide({ updateSession: true });
    await this.refreshFiles();
    await this.openFile(STYLE_GUIDE_FILE);
  }

  /** Ask the agent to read the manuscript, ask a few questions, and write the guide. */
  async draftStyleGuide() {
    return this.send(draftStyleGuidePrompt());
  }

  dismissStyleGuidePrompt() {
    try {
      localStorage.setItem(this.styleDismissKey(), '1');
    } catch {}
    this.store.set((s) => ({ styleGuide: { ...s.styleGuide, dismissed: true } }));
  }

  // ---- zoom -----------------------------------------------------------------------

  /** ⌘= / ⌘− / ⌘0. The same press can arrive as a key event and as a menu event; apply it once. */
  async zoom(action: ZoomAction, source: 'key' | 'menu') {
    const now = performance.now();
    if (source === 'menu' && this.lastZoom.action === action && now - this.lastZoom.at < 300) return;
    this.lastZoom = { action, at: now };
    await this.setZoom(nextZoom(this.state.zoom, action));
  }

  async setZoom(factor: number, { persist = true } = {}) {
    this.zoomFactor = factor;
    const applied = await ipc.setUiZoom(factor);
    this.zoomFactor = applied;
    this.store.set({ zoom: applied });
    if (persist) writeJson(ZOOM_KEY, applied);
    monaco.editor.remeasureFonts();
    window.dispatchEvent(new Event('studio-layout')); // re-place the preview webview
  }

  // ---- misc -----------------------------------------------------------------------

  toast(text: string, tone: 'info' | 'error' = 'info') {
    this.store.set({ toast: { text, tone } });
    setTimeout(() => {
      if (this.state.toast?.text === text) this.store.set({ toast: null });
    }, 6000);
  }

  now() {
    return clock();
  }
}

/** Settings Tinymist reads at start-up: changing them needs a restart. */
function needsRestart(a: ProjectSettings, b: ProjectSettings): boolean {
  return a.entryPoint !== b.entryPoint || (a.outputDir ?? '') !== (b.outputDir ?? '') || JSON.stringify(a.fontPaths ?? []) !== JSON.stringify(b.fontPaths ?? []);
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const v = o.path ?? o.filePath ?? o.file ?? o.pattern ?? o.command ?? o.query ?? o.url;
  return typeof v === 'string' ? v : JSON.stringify(input).slice(0, 120);
}

export const studio = new Studio();
