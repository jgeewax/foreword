# Typst Studio — Product & Engineering Specification

**Status:** Draft v0.1  
**Target:** macOS (Apple Silicon first), local-first  
**Audience:** Claude Code implementing the application incrementally

## 1. Product goal

Build a focused desktop IDE for writing and maintaining **Typst books and technical documents**. The experience should combine the best of VS Code's explorer/editor, Tinymist's live Typst preview, and Claude Code's integrated agent chat—but let the user choose models through a custom endpoint (initially LiteLLM).

This is **not** a WYSIWYG editor, a web document platform, or an AI chat app. The source files on disk remain ordinary `.typ` files in an ordinary Git repository.

**One-sentence success criterion:** Open an existing Typst book repository, select a passage of `.typ` source, press `Cmd+I`, ask an AI agent to revise it, review the actual file changes, and see the updated rendered pages without leaving the app or typing line numbers.

## 2. Desktop layout and interaction design

Four simultaneously visible, horizontally arranged, resizable panes:

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Typst Studio  |  Book project  |  main  |  Build status  |  Settings                                 │
├────────────────┬────────────────────────────┬──────────────────────────┬──────────────────────────┤
│ EXPLORER + GIT │ SOURCE EDITOR              │ LIVE TYPST PREVIEW       │ AI AGENT                 │
│                │                            │                          │                          │
│ files/         │ eigenvalues.typ            │ Rendered book/page       │ Session history          │
│  chapter1.typ  │ = Eigenvalues              │                          │ Model picker             │
│  chapter2.typ  │ ...selected lines...       │      Av = λv             │ Streaming responses      │
│  main.typ      │                            │                          │ Tool activity            │
│                │                            │                          │ Change review            │
│ git changes    │                            │                          │ [selection chip]         │
│ branches       │                            │                          │ [message input]          │
├────────────────┴────────────────────────────┴──────────────────────────┴──────────────────────────┤
│ status: current file • line:column • Typst diagnostics • preview state • agent state               │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Default approximate pane widths: **15% / 32% / 28% / 25%**. Every splitter is draggable. Explorer, preview, and chat can be collapsed independently; widths and visibility persist per workspace. The source editor must always remain usable. Minimum window width should accommodate all four panes; when narrow, allow hiding panels instead of crushing them.

UI preferences: compact, keyboard-centric, macOS-native-feeling chrome, light/dark theme, no visual gimmicks. The editor and preview should dominate rather than a marketing-style AI interface.

### Key workflows

1. **Write:** Choose a `.typ` file in Explorer, edit it in Monaco, and see the *project's main document* update in the preview **as you type, without saving** — the same live feel as Tinymist's preview in VS Code. Errors appear inline and in the status bar.
2. **Ask about selection:** Highlight one or more lines, press `Cmd+I` (configurable), and focus the chat with a visible attachment such as `chapters/eigen.typ:32–39`, including the exact selected text and file revision. Ask a question or request an edit. No manual line references.
3. **Agent edit:** The agent can inspect other project files, read selected context, and use tools. Its edits are reflected in the editor and preview. Show changed files and a Monaco diff; offer **Keep changes** / **Undo agent changes** with a safe restore mechanism.
4. **Review via Git:** See modified/untracked files and diffs, stage/unstage, commit, and switch branches with an unsaved-changes safeguard.
5. **Preview navigation:** Click rendered content to navigate to the corresponding `.typ` source location; optionally navigate from source cursor to the relevant rendered region.
6. **Switch models:** Pick a model in the chat pane, using a custom provider/LiteLLM configuration. Existing project files and editor state are unaffected.

### Default shortcuts

- `Cmd+O`: Open folder/project (when app focused).
- `Cmd+P`: Quick-open project file.
- `Cmd+S`: Explicit save/flush pending edits.
- `Cmd+I`: Attach current source selection to chat and focus input; when no selection, attach current file and cursor context.
- `Cmd+Enter`: Send AI message while chat input is focused.
- `Cmd+B`: Toggle Explorer.
- `Cmd+Shift+P`: Command palette (later phase).
- Escape in chat input: return focus to the last editor (unless a modal is open).

Keyboard bindings must be configurable eventually; avoid stepping on Monaco's ordinary selection/navigation commands.

## 3. Scope and priorities

### P0 — Required for the first useful release

**Workspace / explorer**
- Open an existing local folder without importing/converting anything.
- Read file tree; respect `.gitignore` where reasonable; refresh after filesystem changes.
- Open/edit multiple files through tabs; primary support for `.typ`, with plain text editing for `.bib`, `.md`, `.json`, etc.
- Detect external file changes and merge them into open buffers (three-way, word by word within a paragraph): unsaved edits are never overwritten, and where both sides changed the same words the buffer keeps the author's and shows the other version to take or leave. A save made while an agent works survives the agent writing from an older copy.
- Remember recently opened workspace, open tabs, active file, and layout.

**Editor**
- Monaco editor with Typst syntax highlighting, line numbers, find/replace, undo/redo, standard editing shortcuts. Highlighting uses Tinymist's TextMate grammar plus LSP semantic tokens, as VS Code does — not a hand-written grammar.
- Tinymist diagnostics and, after the LSP bridge is working, completion and hover.
- Accurate UTF-8 file reading/writing. Preserve file contents and line endings; use atomic writes when possible.
- An explicit save command and a predictable autosave mode (default on, every 5 minutes, unformatted); pending saves must flush before agent work or Git operations. Autosave exists for durability, the agent, and Git — the preview never waits for it.

**Preview**
- Embed Tinymist's live SVG/web preview in the preview pane, not an external browser tab.
- Configure a **project entry point**, e.g. `main.typ`, independent of whichever chapter is open in the editor.
- **Live update on every keystroke** from unsaved editor buffers, including edits in included chapter files (equivalent to Tinymist's `onType` refresh). Saving must not be required to see a change. Maintain the visible page/scroll position as much as possible, and keep the last good render on screen while an in-progress edit fails to compile.
- **Partial rendering stays on** (only pages near the viewport are in the DOM). Without it a ~500-page book puts ~1M nodes in the preview and stalls typing (measured; see `docs/decisions.md`).
- **The preview must never block the editor.** Host it in its own webview (a separate WKWebView, hence a separate web content process), not an iframe in the editor's page, so preview rendering cannot delay keystrokes.
- Display compilation/preview errors without freezing the editor.
- Export finished PDF through Typst; do not use PDF export as the per-keystroke live-preview mechanism.

**AI chat / agent**
- Chat docked in the right-hand pane: session history, streaming replies, model picker, message composer, current context attachments, tool calls, permission prompts, cancel-running action.
- `Cmd+I` reliably passes selected text plus `{relativePath, start/end line and column, file version}`. Show the attachment as a removable chip before sending.
- Agent can read/search project files, edit files, and run project-scoped commands subject to permissions.
- Multi-turn project-scoped sessions survive app restart where the agent runtime supports it.
- Initial model backend: an OpenCode **headless server** controlled via its SDK/API; expose an `AgentAdapter` abstraction so the UI is not tied to OpenCode forever.
- Initial custom provider route: user's existing LiteLLM proxy. Show models configured/available to the agent runtime, not a hard-coded catalog. Clearly report unsupported model/tool-capability errors.
- Never claim a model change, tool action, or edit succeeded before the backend confirms it.

**Review and Git**
- Basic Git status, current branch, changes list, diff viewer, stage/unstage, commit.
- Each AI turn that changes files produces a visible change summary and a diff review.
- **Keep** leaves edits in place; **Undo agent changes** restores only edits attributable to that turn, without deleting pre-existing user modifications or clobbering subsequent manual edits. If safe automatic undo is impossible, show a conflict and require user resolution.
- Never implement Undo by indiscriminately running `git reset --hard`, `git checkout --`, or resetting the whole repo.

### P1 — Important once P0 is stable

- Bidirectional editor/preview navigation, including included chapter files and line mapping.
- Richer Tinymist LSP features: references, rename, formatting, outline/navigation.
- Review/accept/reject at the individual file or hunk level when safe.
- Git branch creation/switching, history view, better conflict messages.
- Search across files, project symbols, optional outline pane inside Explorer.
- Model/provider setup UI, connection tests, model metadata, per-session model preferences.
- Optional split chat sessions and named prompts for editing/explaining/criticizing prose.

### P2 — Explicitly later

- Visual comments attached directly to rendered preview regions, cross-chapter style consistency checks, citations/fact-checking workflows, book-specific editorial agents, multi-window/multi-project operation, plugin marketplace, cloud sync, collaboration, Windows/Linux builds.

## 4. Implementation architecture

### Recommended stack

| Layer | Initial choice | Responsibility |
|---|---|---|
| Desktop shell | **Tauri 2 + Rust** | Windowing, secure local filesystem access, process management, keychain integration |
| UI | **React + TypeScript + Vite** | Pane layout, state, settings, tab management |
| Source editor | **Monaco Editor** | Source editing, selections, diagnostics rendering, diff viewer |
| Typst language support | **Tinymist LSP** | Typst intelligence and diagnostics |
| Preview | **Tinymist preview, started through the same Tinymist LSP process** | Live rendering from unsaved buffers, source mapping |
| Agent | **OpenCode headless server + `@opencode-ai/sdk`** | Sessions, models, tools, streaming events, permission requests |
| Model routing | **LiteLLM**, via OpenCode custom provider | User-selectable model endpoints |
| Git | **Local Git CLI**, invoked by an app-owned backend | Status, diff, stage, commit, branches |
| Settings | Workspace JSON + macOS application storage | Entry point, pane sizes, recent projects; secrets in Keychain/env only |

Do not embed an entire VS Code build or implement custom Typst parsing, compilation, or a new LLM tool engine. Prefer stable integrations and clearly isolated adapters.

### Process boundaries

```text
Tauri app (React UI)
  ├── File/Workspace service → Rust filesystem operations and watcher
  ├── Git service            → Rust invoking git with argument arrays
  ├── Typst service          → one Tinymist process: LSP over stdio; preview started
  │                            via LSP command, served on 127.0.0.1
  └── AgentAdapter           → locally managed OpenCode server/API/events
                                      └── configured providers / LiteLLM
```

For development, it is acceptable to require `tinymist`, `typst`, `git`, and `opencode` installed locally. **Production packaging is a later milestone**: include compatible sidecar binaries and handle macOS signing/notarization. Tauri supports external binary sidecars; verify subprocess lifecycle and architecture-specific builds.

The preview and agent server must bind to `127.0.0.1` on managed ports; avoid insecure unauthenticated network exposure. Check CORS/localhost WebView origin behavior early. Prefer an app-managed local bridge if direct WebView calls are unreliable.

### File, preview, and agent synchronization (critical)

- **Authoritative project data:** Files on disk. Monaco buffers are transient working copies, not a separate document database.
- **Typing:** Update Monaco immediately and send LSP `didChange` on every edit (no debounce on this path). One Tinymist process owns diagnostics *and* preview: the preview is started through that LSP server with the project entry point pinned as the main file, so it re-renders from the in-memory buffers as you type, including edits to included chapters. Autosave to disk is debounced separately and the preview never depends on it. Do not run a second compile pipeline (e.g., a standalone `tinymist preview` process watching disk); it would only see saved files. Confirm the exact Tinymist commands (start preview, pin main) against the installed version in Phase 0.
- **Before an AI run:** Flush pending editor writes. Capture a pre-run manifest and byte snapshots of editable project files (including tracked and untracked text files, excluding `.git`, build outputs, and large binaries), along with revisions/hashes for open buffers. Record the selected source text and range, then submit the message. Clearly mark stale selection context if it changes before submission.
- **During an AI run:** Watch filesystem events from the agent, deduplicate notifications, and reconcile with open Monaco models. Preserve cursor and scroll position where feasible. Never silently overwrite dirty buffers.
- **After an AI run:** Build changed-file summaries and reviewable diffs against the pre-run snapshots, including already-dirty Git files. A Git diff against `HEAD` alone is insufficient to attribute AI edits.
- **Undo:** Use per-turn snapshots/revisions or validated patches, including files that were not open in Monaco. Check current hashes before restoring; if the user has edited a file since the agent's change, require a merge/conflict review. For files excluded from snapshot coverage, explain up front that full automatic undo is unavailable.
- **Errors:** If Tinymist cannot compile, keep last valid preview visibly marked stale and surface the diagnostics. If AI fails, editing and preview continue to work.

Treat these as design invariants, not optional polish.

### Suggested internal interfaces

```ts
type SourceSelection = {
  relativePath: string;
  selectedText: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
  documentVersion: number;
  contentHash: string;
};

type AgentRun = {
  id: string;
  sessionId: string;
  modelId: string;
  attachments: SourceSelection[];
  status: 'queued' | 'running' | 'review' | 'completed' | 'failed' | 'cancelled';
};

interface AgentAdapter {
  listModels(): Promise<Array<{ id: string; label: string }>>;
  createSession(projectPath: string): Promise<string>;
  send(sessionId: string, message: string, context: SourceSelection[]): Promise<string>;
  cancel(runId: string): Promise<void>;
  subscribe(sessionId: string, onEvent: (event: unknown) => void): () => void;
}
```

Types above express app behavior rather than literal upstream SDK signatures. Adapt from the actual installed SDK version; do not fabricate upstream methods.

### Workspace settings

A small optional `.typst-studio.json` in the project root, for nonsecret project settings:

```json
{
  "entryPoint": "main.typ",
  "outputDir": "dist",
  "fontPaths": []
}
```

Machine-level UI preferences and secrets belong outside the repository. Respect existing `typst.toml`/Tinymist conventions where supported, rather than overriding them blindly.

## 5. Security and data integrity

- Local-first: no project upload except the content intentionally sent through the chosen model/provider API; make this visible in provider settings.
- Store API keys in macOS Keychain or read them from environment; never commit credentials or print them in logs.
- Restrict file service operations to the open workspace; detect symlink/path traversal and require consent for out-of-workspace access.
- Explicit user permission for sensitive agent commands, network requests, external directory access, and destructive Git actions. Never launch OpenCode in blanket auto-approve mode by default.
- Changes need to be observable, reversible where possible, and clearly attributed to user vs. agent.
- Do not trigger agent work automatically on file-open or passive selection.

## 6. Performance and reliability

The bar is VS Code with the Tinymist extension: typing never stutters, and the preview follows keystrokes the way Tinymist's preview does.

### Responsiveness budgets

Measured on an Apple Silicon Mac against `fixtures/stress-book/` (§8), in the production WebView (WKWebView).

| Interaction | Target | Must hold while |
|---|---|---|
| Keystroke → character painted in Monaco | p95 ≤ 16 ms; no main-thread task > 50 ms during typing | Tinymist compiling, agent streaming, Git refreshing |
| Keystroke → preview shows the change (edit in an included chapter) | p50 ≤ 150 ms, p95 ≤ 400 ms (calibrate in Phase 0) | Typing continuously, unsaved |
| Cold launch → last workspace restored and editable | ≤ 1.5 s (preview may still be compiling) | |
| Open file from Explorer/Quick Open, or switch tab | ≤ 50 ms | |
| Quick Open filtering on a 5,000-file repo | ≤ 30 ms per keystroke | |
| Press Send → message shown in chat | ≤ 100 ms (pre-run snapshot runs in background; submission to the agent waits for it) | |
| Idle CPU with nothing changing | ~0% | |

These are gates, not aspirations: Phase 0 measures them, later phases must not regress them, and any miss is recorded in `docs/decisions.md`.

### Keeping the UI thread free

- Nothing synchronous on the keystroke path: no blocking IPC, disk I/O, hashing, or diffing between a keystroke and the next paint. LSP `didChange` goes out asynchronously; the compiler is never restarted per keystroke.
- One Monaco editor instance with one model per open tab (as VS Code does); keep view state per model; dispose models for closed tabs; never hold every project file in Monaco.
- Hashing, pre-run snapshots, large diffs, file watching, and Git run in Rust (or a Web Worker), never on the UI thread. Cache file hashes by size/mtime so snapshots are incremental.
- Agent stream events are coalesced and rendered at most once per animation frame; Markdown rendering of a streaming message is incremental.
- File tree, chat history, change lists, and diff lists are virtualized; directories load lazily.
- Filesystem and Git refreshes are debounced and deduplicated; the app's own writes are not echoed back as external changes.

### Reliability

- Gracefully recover from preview/agent subprocess crashes; show a restart button and logs, not a blank pane.
- Persist user settings and sessions; recover open tabs and layout after restarting the app.
- Never silently discard unsaved work or pre-existing uncommitted Git changes.

## 7. Build plan with acceptance gates

**Phase 0 — Integration feasibility spikes.** Scaffold a Tauri 2/React/TypeScript app. Independently prove: (A) Monaco rendering and selection capture; (B) Tinymist preview embedded inside the application using a real multi-file Typst book, **updating live from unsaved Monaco edits** — typing in an included chapter re-renders the book without saving; (C) OpenCode headless API with streamed messages and one working tool call, routed through a custom compatible model/provider; (D) a first measurement of the §6 budgets in WKWebView on the stress book, at minimum keystroke-to-paint and keystroke-to-preview latency. Test WebView origin/CORS, executable discovery and port/lifecycle behavior. Record limitations and measured numbers in `docs/decisions.md`; if WKWebView misses the budgets, stop for review before Phase 1. **Gate:** a runnable proof, not screenshots or fake data.

**Phase 1 — Four-pane editor.** Implement layout, splitters, explorer, tabs, file load/save, persistence, Git status, diff, stage/unstage, and commit. **Gate:** edit an existing book folder without any AI configured; saved edits survive restart; staged and unstaged Git changes are accurate.

**Phase 2 — Typst integration.** Connect live Tinymist diagnostics, reliable preview, project entry point settings, build failures, PDF export. Add preview → source jump after confirming Tinymist's integration protocol. **Gate:** edits in an included chapter re-render the complete book as you type, without saving, within the §6 budget; a Typst error is displayed and recoverable; preview stays in pane.

**Phase 3 — Agent experience.** Build the right-hand chat, streaming sessions, model picker, selected-text context chip, permission dialogs, tool activity, stop/cancel, project-scoped tool use. **Gate:** select two lines in a chapter, press `Cmd+I`, request a revision using a configured non-Claude model, and see the changed file and updated preview; no manual line references.

**Phase 4 — Safe edits and review.** Implement baseline snapshots, external-change reconciliation, reviewable diffs, safe per-run Undo, conflicts, and Git changes that predate the agent's turn. **Gate:** a user with existing uncommitted changes can reject AI edits without losing their work; conflicting edits are never silently overwritten.

**Phase 5 — Polish and packaging.** Model setup UI, reliable restart/recovery, fonts/paths checks, keyboard ergonomics, macOS `.app` packaging, optional embedded sidecars, signing/notarization guidance, tests and docs. **Gate:** a new Mac can install and use the app with documented setup and no unexplained terminal steps.

Do **not** begin Phase N+1 merely because Phase N looks aesthetically complete. Each phase needs a working demo and documented test results.

## 8. Tests and demo fixture

Create `fixtures/sample-book/` with `main.typ`, two included chapters, an equation, image, bibliography, and a small Git repository. This fixture should exercise actual project compilation rather than a single standalone `.typ` file.

Also add a generator script for `fixtures/stress-book/`: roughly 60 chapters (~400 pages) with equations, figures, cross-references, and a bibliography, padded with non-Typst files to a ~5,000-file tree. It is the reference workload for the §6 budgets. Generate it on demand rather than committing the output.

Automated tests should cover path normalization, file save/reload, stale buffer detection, selection payload line/column accuracy, agent event mapping, file change attribution, patch rollback conflicts, and Git status parsing. Add an automated latency check on the stress book (keystroke-to-paint, keystroke-to-preview) so regressions are visible. Add at least a smoke-test checklist for macOS UI and preview integration.

**End-to-end demo:**

1. Open `fixtures/sample-book`.
2. Pick chapter 2 from Explorer; modify a paragraph and watch its rendered location update as you type, before any save.
3. Select only two lines, press `Cmd+I`, and ask the agent to rewrite them while preserving an equation.
4. Switch to a model exposed by LiteLLM; verify agent response and tool events stream.
5. See a real diff and modified Git status; choose Undo agent changes; verify user's earlier manual change remains.
6. Deliberately break a Typst expression, observe useful diagnostics, and fix it.
7. Export a PDF, restart the app, and recover project/tabs/layout/chat.

## 9. Explicit non-goals for v0.1

No WYSIWYG editing; no custom Typst compiler; no general-purpose IDE languages; no cloud database or account; no collaborative editing; no mobile app; no auto-publishing to a store; no custom language-model agent framework; no rich visual annotations on the rendered page yet.

## 10. Guidance for Claude Code

1. Read this entire spec and inspect the repository before making architectural decisions.
2. Create a short `PLAN.md` with the proposed repo structure, dependencies, commands, phase-by-phase tasks, and the specific unknowns requiring spikes.
3. Implement **Phase 0 only** first. Prioritize proving **embedded Tinymist preview** and **OpenCode agent streaming** over styling.
4. Use real integrations—no simulated preview, canned AI replies, fake Git status, or mock file changes outside tests.
5. Keep separate interfaces for filesystem, Typst preview/LSP, Git, and agent runtime, so individual integrations can be replaced.
6. Run build/typecheck/tests for each phase; document precise steps for running locally.
7. After each phase, report completed features, tested outcomes, limitations, and the next phase's planned changes. Do not silently change the spec or launch into the next phase.
8. When upstream APIs differ from this proposal, prefer official current documentation, explain the difference, and record the decision in `docs/decisions.md`.

### Official implementation references

- Tauri sidecars: https://v2.tauri.app/develop/sidecar/
- Tinymist preview: https://myriad-dreamin.github.io/tinymist/feature/preview.html
- OpenCode SDK: https://docs.opencode.ai/docs/sdk/
- OpenCode server: https://docs.opencode.ai/docs/server/
- OpenCode providers: https://docs.opencode.ai/docs/providers/
- OpenCode permissions: https://docs.opencode.ai/docs/permissions/
