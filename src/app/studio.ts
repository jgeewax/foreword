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
import { Channel, errorMessage, ipc, type Bounds, type LaunchOptions, type ToolsStatus, type WorkspaceInfo } from '../lib/ipc';
import { clock, PerfTracker } from '../lib/perf';
import { Emitter, Store } from '../lib/store';
import { nextZoom, type ZoomAction } from '../lib/zoom';
import { OpenCodeAdapter } from '../services/agent/opencode';
import { buildInstructions, INSTRUCTIONS_KEY } from '../services/agent/instructions';
import { chooseModel, PREFERRED_PROVIDERS } from '../services/agent/models';
import type { AgentAdapter, AgentEvent, FilePatch, ModelInfo, ModelRef, PermissionDecision } from '../services/agent/types';
import { TypstService } from '../services/typst';

export type ChatItem =
  | { kind: 'user'; id: string; text: string; attachments: string[] }
  | { kind: 'assistant'; id: string; text: string; done: boolean }
  | { kind: 'tool'; id: string; name: string; summary: string; status: 'running' | 'done' | 'failed'; detail: string }
  | {
      kind: 'permission';
      id: string;
      action: string;
      resources: string[];
      patches: FilePatch[];
      state: 'pending' | 'sending' | 'once' | 'always' | 'reject';
    }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error' };

export type Attachment = { id: string; label: string; selection: SourceSelection };

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
    sessionId: string | null;
    title: string | null;
    running: boolean;
    items: ChatItem[];
    attachments: Attachment[];
  };
  perf: { input: Stat; preview: Stat };
  toast: { text: string; tone: 'info' | 'error' } | null;
  /** UI zoom factor (1 = 100%). */
  zoom: number;
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
    sessionId: null,
    title: null,
    running: false,
    items: [],
    attachments: [],
  },
  perf: { input: { p50: null, p95: null, n: 0 }, preview: { p50: null, p95: null, n: 0 } },
  toast: null,
  zoom: 1,
};

const LAST_WORKSPACE = 'studio.lastWorkspace';
const MODEL_KEY = 'studio.model';
const ZOOM_KEY = 'studio.zoom';
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
  readonly events = new Emitter<{ 'focus-composer': []; 'focus-editor': [] }>();
  readonly perf = new PerfTracker();
  readonly typst = new TypstService();
  docs: Documents | null = null;
  agent: AgentAdapter | null = null;
  editor: monaco.editor.IStandaloneCodeEditor | null = null;

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
    this.typst.on('scrollSource', (jump) => void this.revealSource(jump));
    this.typst.on('closed', () => {
      if (this.store.get().workspace) {
        this.store.set({ preview: { status: 'error', error: 'Tinymist stopped. Editing still works; restart the preview to continue.' } });
        this.syncPreviewVisibility();
      }
    });
    void listen<string>('menu', (e) => {
      const action = ({ 'zoom-in': 'in', 'zoom-out': 'out', 'zoom-reset': 'reset' } as const)[e.payload as 'zoom-in'];
      if (action) void this.zoom(action, 'menu');
    });
    void listen<{ tag?: string }>('preview:report', (e) => {
      if (e.payload?.tag === 'jump') for (const w of [...this.jumpWaiters]) w();
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
    localStorage.setItem(LAST_WORKSPACE, info.root);
    this.docs = new Documents(info.root, this.typst, {
      onEdit: () => this.perf.edit(() => this.publishPerf()),
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

    void this.startTypst();
    void this.startAgent();

    const saved = readJson<{ tabs: string[]; active: string | null }>(tabsKey(info.root));
    const tabs = (saved?.tabs ?? []).filter((t) => info.files.includes(t));
    const fallback = info.entry ? [info.entry] : info.files.filter((f) => f.endsWith('.typ')).slice(0, 1);
    for (const t of tabs.length ? tabs : fallback) await this.openFile(t, { activate: false });
    const active = saved?.active && this.state.tabs.includes(saved.active) ? saved.active : this.state.tabs[0];
    if (active) await this.openFile(active);
  }

  private async closeWorkspace() {
    if (!this.state.workspace) return;
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
    });
  }

  async refreshFiles() {
    const ws = this.state.workspace;
    if (!ws) return;
    const files = await ipc.workspaceList();
    this.store.set({ workspace: { ...ws, files } });
  }

  private onDiskChange(paths: string[]) {
    for (const p of paths) this.pendingDisk.add(p);
    clearTimeout(this.diskTimer);
    this.diskTimer = window.setTimeout(() => {
      const batch = [...this.pendingDisk];
      this.pendingDisk.clear();
      void this.docs?.diskChanged(batch);
      void this.refreshFiles();
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
      const { previewUrl } = await this.typst.start(ws.root, ws.entry);
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
    void ipc.previewSetVisible(this.previewVisible && ok);
  }

  private async showPreview() {
    const url = this.state.preview.url;
    if (!url || !this.previewBounds || this.previewOpened || !this.previewVisible) return;
    this.previewOpened = true;
    try {
      await ipc.previewOpen(url, this.previewBounds);
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
    this.store.set((s) => ({ agent: { ...s.agent, ...(typeof patch === 'function' ? patch(s.agent) : patch) } }));
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
      this.setAgent({ model });
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Model not changed: ${errorMessage(e)}` });
    }
  }

  newSession() {
    if (this.state.agent.running) return;
    this.setAgent({ sessionId: null, title: null, items: [] });
  }

  /** ⌘I: attach the selection (or cursor position) to the chat and focus it. */
  async attachSelection() {
    const path = this.state.active;
    const editor = this.editor;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!path || !model || !selection) {
      this.events.emit('focus-composer');
      return;
    }
    const captured = await captureSelection(path, model, selection);
    const label = selectionLabel(captured);
    this.setAgent((a) => ({
      attachments: [...a.attachments.filter((x) => x.label !== label), { id: uid('a'), label, selection: captured }],
    }));
    this.events.emit('focus-composer');
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
    this.turnErrors.clear();
    const attachments = state.attachments;
    const context = attachments.map((a) => ({
      selection: a.selection,
      stale: docs?.get(a.selection.relativePath)?.model.getVersionId() !== a.selection.documentVersion,
    }));
    this.setAgent((a) => ({
      running: true,
      attachments: [],
      items: [...a.items, { kind: 'user', id: uid('u'), text, attachments: attachments.map((x) => x.label) }],
    }));
    try {
      let sessionId = this.state.agent.sessionId;
      if (!sessionId) {
        sessionId = await agent.createSession(this.state.agent.model);
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
    });
    try {
      await this.agent.setInstructions(sessionId, INSTRUCTIONS_KEY, text);
    } catch (e) {
      // Still usable without them, but the agent will behave like a coding assistant: say so.
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't set the writing-assistant instructions: ${errorMessage(e)}` });
    }
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
          if (idx < 0) return { items: [...a.items, { kind: 'assistant', id, text: e.delta, done: false }] };
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
            : { items: [...a.items, { kind: 'assistant', id, text: e.text, done: true }] },
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

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const v = o.path ?? o.filePath ?? o.file ?? o.pattern ?? o.command ?? o.query ?? o.url;
  return typeof v === 'string' ? v : JSON.stringify(input).slice(0, 120);
}

export const studio = new Studio();
