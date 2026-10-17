# Typst Studio — plan

Source of truth: [SPEC.md](SPEC.md). Decisions, measurements and open questions: [docs/decisions.md](docs/decisions.md).

## Repo layout

```text
src-tauri/            Rust backend (Tauri 2)
  src/workspace.rs    files: path containment, .gitignore-aware listing, atomic conflict-checked writes, watcher
  src/lsp.rs          Tinymist process + LSP stdio framing (protocol lives in the frontend)
  src/preview.rs      preview = separate child webview over the preview pane; WebKit fixes; perf hook
  src/agent.rs        `opencode serve` lifecycle + HTTP/SSE bridge (password never reaches the webview)
  src/children.rs     helper-process registry (reaps leftovers after a crash/force-quit)
  src/discover.rs     executable discovery (Finder-launched apps get a minimal PATH)
  capabilities/       main webview: app commands; preview webview: perf_report only
src/                  React + TypeScript UI
  app/studio.ts       controller + store (workspace, docs, Typst, preview, agent, perf)
  editor/             Monaco setup, Typst TextMate grammar, documents, LSP conversions, selection capture
  services/typst.ts   TypstService (Tinymist LSP client)
  services/agent/     AgentAdapter interface, OpenCode 2.x adapter, event mapping
  components/         Explorer, EditorPane, PreviewPane, AgentPane, toolbar/status bar
  selftest.ts         scripted end-to-end check inside the real app
fixtures/sample-book/ 2-chapter book: equation, figure, bibliography, cross-refs
scripts/gen-stress-book.mjs   491-page stress book for the §6 budgets (generated, not committed)
prototypes/live-preview/      throwaway spike that de-risked live preview (kept for its benchmarks)
```

## Prerequisites (dev)

`brew install rust tinymist opencode` (plus Node 22+). Tinymist is also found inside the VS Code extension; override with `TINYMIST_PATH` / `OPENCODE_PATH`.

## Commands

| What | Command |
|---|---|
| Run the app | `npm run app` (= `tauri dev`) |
| Open a folder at launch | `TYPST_STUDIO_WORKSPACE=/path/to/book npm run app` |
| Typecheck / unit tests / build | `npm run typecheck` · `npm test` · `npm run build` |
| Rust tests / lint / format | `cd src-tauri && cargo test && cargo clippy --all-targets && cargo fmt --check` |
| Stress book | `npm run stress-book` → `fixtures/stress-book/` |
| In-app self-test | `TYPST_STUDIO_WORKSPACE=… TYPST_STUDIO_SELFTEST=/tmp/out.json [TYPST_STUDIO_SELFTEST_AGENT=1] npm run app` |
| Self-test options | `TYPST_STUDIO_SELFTEST_EDITS=1` lets the agent edit (scratch copies only) · `TYPST_STUDIO_SELFTEST_ONLY=preview,geometry,zoom,settings,models,typing,agent,markdown,project,style,history,options,plan,edits` runs only those groups |

## Phases

- **Phase 0 — feasibility (in progress).** Four-pane window; Monaco + selection capture (⌘I chip); Tinymist live preview from unsaved buffers in its own webview; OpenCode 2.x session streamed through a LiteLLM model with tool calls and permission prompts; in-app latency HUD and self-test. Remaining: real-WKWebView numbers on the stress book, cold-start measurement, Monaco bundle trimming decision.
- **Phase 1 — four-pane editor.** Autosave with debounce, external-change UI polish, persistence of layout/tabs per workspace (partly done), Git status/diff/stage/commit via a Rust Git service, Quick Open (⌘P), lazy/virtualized explorer, fixture as a real Git repo (created by script, not nested in this repo).
- **Phase 2 — Typst.** Diagnostics panel, entry-point setting UI, PDF export, restart/recovery UX. (Preview ↔ source navigation was pulled forward and works; see decisions.)
- **Phase 3 — agent.** Session history/restore, richer tool activity, permission UX ("always" rules), model metadata, cancel semantics.
- **Phase 4 — safe edits.** Pre-run snapshots, per-turn diff review, Undo agent changes with conflict detection.
- **Phase 5 — packaging.** Sidecar binaries, signing/notarization, universal build (needs rustup), first-run setup.

## Open unknowns

See "Open questions" in docs/decisions.md. The big ones: WKWebView numbers at book scale inside the app; whether hiding Tinymist's canvas page previews has a visible cost on fast scrolling; OpenCode 2.x permission action names beyond read/edit; subagent ("task") permissions.
