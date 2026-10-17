# Decisions and open questions

## 2026-10-16 — Shell: Tauri 2 (WKWebView)

Decided with the user: stay on Tauri. Responsiveness budgets are in SPEC §6 and
must be measured in WebKit. Electron is not the plan.

## 2026-10-17 — Live preview from unsaved buffers (spike: `prototypes/live-preview/`)

**Question:** can the preview follow keystrokes, like Tinymist's preview in VS
Code, with one Tinymist process and nothing saved to disk, at book scale, in WebKit?

**Answer: yes, with partial rendering on.**

How it works (Tinymist 0.15.8, Typst 0.15.1, same commands VS Code's extension uses):

1. `tinymist lsp` over stdio; config `preview.refresh = "onType"`, `compileStatus = "enable"`.
2. `didOpen` the entry and edited files; `workspace/executeCommand tinymist.pinMain [<abs main.typ>]`.
3. `tinymist.doStartPreview [["--task-id", id, "--data-plane-host", "127.0.0.1:0", <abs main.typ>]]`
   returns `{dataPlanePort, staticServerPort}` (same port; binds 127.0.0.1).
4. Embed `http://127.0.0.1:<staticServerPort>/` in an iframe. The page opens its
   WebSocket on its own origin. No `X-Frame-Options`, so framing works.
5. Every Monaco change is sent as an incremental `didChange`. Monaco's per-event
   change list maps 1:1 to LSP `contentChanges` (1-based → 0-based).

Measured on this Mac (Apple Silicon, macOS 26.5). "Preview paint" = key event →
MutationObserver in the preview frame → next frame. Playwright WebKit 26.6
headless; real WKWebView still has to be measured in the Tauri spike.

| | Sample book (5 pp) | Stress book (491 pp, 137k words) |
|---|---|---|
| didChange → compileSuccess (no browser), p50/p95 | 3.6 / 4.9 ms | 87 / 94 ms |
| didChange → preview diff on WebSocket, p50/p95 | 5.2 / 6.1 ms | 95 / 102 ms |
| WebKit, partial on: key → editor paint p50/p95 | 12 / 27 ms | 5 / 17 ms |
| WebKit, partial on: key → preview paint p50/p95 | 38 / 44 ms | 132 / 140 ms |
| WebKit, partial **off**: key → editor paint p50/p95 | — | **1327 / 6624 ms** |
| Chromium, partial on: key → preview paint p50/p95 | — | 118 / 130 ms |
| Typing at 60 ms/key: last key → preview shows it | 34 ms | ~150 ms (both engines) |
| Syntax error → diagnostic; preview keeps last good render | 1 ms; yes | 64 ms; yes |

All within the SPEC §6 targets (key → preview p50 ≤ 150 ms, p95 ≤ 400 ms), with
partial rendering on.

### Findings that affect the design

1. **Partial rendering is mandatory in WebKit.** With it off, the stress book
   puts ~1M nodes in the preview DOM and **freezes the editor** (key → editor paint
   p50 1.3 s). The preview iframe runs on the same main thread as Monaco.
2. **Isolate the preview from the editor's main thread.** Even with partial
   rendering, any slow preview render competes with typing. Done in the app: the
   preview is a separate Tauri child webview (see 2026-10-17).
3. ~~WebKit bug: partial rendering + `tinymist.scrollPreview`.~~ Misdiagnosed;
   see "WebKit page-order bug" below (2026-10-17). The real cause is width- and
   engine-dependent, not the scroll command.
4. ~~`tinymist.scrollPreview` never sends a `jump`.~~ Wrong: it only jumps for
   positions that map to rendered content, and my test positions didn't. See
   "Source ↔ preview sync" (2026-10-17).
5. Tinymist logs that WebSocket clients without an `Origin` header "will be a hard
   error in the future". The app's preview connection must send one.
6. Tinymist sends `compileSuccess` twice per edit (word count is updated in the
   second). Don't treat the first one as final document stats.
7. WebKit does one extra preview repaint ~1.1 s after typing stops, after the
   content is already correct (Chromium doesn't). Harmless so far; watch for flicker.
8. Typst 0.15 renamed `angle.l/r` to `chevron.l/r` (fixed in the sample book).

## 2026-10-17 — Tauri app (Phase 0)

### Measured in the real app (WKWebView, dev build, Apple Silicon)

In-app self-test (`src/selftest.ts`): Monaco's typing pipeline (`editor.trigger('type')`,
not OS key events), nothing saved, everything undone afterwards. Preview not
scrolled to the edited page, so "edit → preview" is compile + transfer + update
of the visible pages.

| | Sample book (5 pp) | Stress book (491 pp) | Target |
|---|---|---|---|
| Edit → editor paint, isolated p50/p95 | 9 / 19 ms | 8 / 12 ms | p95 ≤ 16 ms |
| Edit → editor paint, typing at 60 ms/key | 5 / 18 ms | 6 / 18 ms | p95 ≤ 16 ms |
| Edit → preview paint, isolated p50/p95 | 25 / 30 ms | 140 / 185 ms | ≤ 150 / 400 ms |
| Preview ready after page load | 0.6 s | 1.0 s | — |
| Unsaved text reaches the compiled book | 238 → 245 words | 137534 → 137541 | — |

Editor p95 is at or slightly over 16 ms in a dev build (unminified React with
StrictMode, full Monaco bundle); re-measure in a release build before tuning.

Agent turn (same self-test): `litellm/gemini-3.8-flash` picked automatically, two
selected lines attached as `chapters/ch2-eigenvalues.typ:3–4`, the agent ran
`read` on the chapter and streamed a correct answer (first text 5.2 s, turn 5.4 s).

### Architecture decisions

- **Preview in a separate child webview** (`Window::add_child`, Tauri `unstable`
  feature), positioned over the preview pane by the frontend. Confirmed: the
  491-page book no longer affects editor latency. Cost: HTML overlays from the
  main webview can't draw over the preview, and keyboard shortcuts don't reach
  the app while the preview has focus (fix later with native menu accelerators).
- **Capabilities:** the main webview gets all app commands; the preview webview
  (remote `http://127.0.0.1:*`) may only call `perf_report`. Each command has its
  own permission (`tauri_build::AppManifest::commands`).
- **`typst_send` is a sync command.** Async commands run concurrently and could
  reorder `didChange` notifications; sync commands run in arrival order. File
  and workspace commands are async so disk I/O stays off the main thread.
- **OpenCode is reached only through Rust** (`agent.rs`): per-launch random
  password via `OPENCODE_SERVER_PASSWORD` (verified honoured), no CORS exposure,
  the password never reaches the webview.
- **Helper processes:** tinymist exits when its stdin closes; `opencode serve`
  doesn't. SIGTERM/SIGINT/SIGHUP now go through the normal exit path, and spawned
  OpenCode PIDs are recorded (`children.rs`) so leftovers from a crash or force
  quit are terminated on the next launch (matched by command line, never by PID
  alone). Verified: SIGTERM stops app, tinymist and opencode together.
- **Rust from Homebrew** (`brew install rust`, 1.99), not rustup: no shell
  changes needed. Universal (Intel) builds in Phase 5 will need rustup.

### OpenCode 2.x (installed: 2.0.20)

- 2.x serves a new API (`/api/...`, 116 routes, `/openapi.json` behind auth);
  the npm `@opencode-ai/sdk` (1.19.3) targets the old one. The adapter calls the
  HTTP API directly, with shapes checked against the server's own OpenAPI file
  and recorded traffic (`src/services/agent/__fixtures__/opencode-events.jsonl`).
- Event stream: `GET /api/event` (SSE, untyped `data`). Turn end is
  `session.execution.succeeded`; a **rejected permission ends the turn with no
  execution event**, so the UI also checks `GET /api/session/active`
  (`{data: {"<sessionID>": {type: "running"}}}` while running, `{}` when idle).
- `permission.asked` carries the proposed diff (`metadata.files[].patch`), which
  the permission card shows before approval.
- **Built-in agents allow everything** (`* → allow`). Sessions are created with
  our own rules: ask by default; allow read/glob/grep/list; ask for `.env` reads
  and external directories; deny `task` (subagents run with allow-all rules).
  Last match wins (verified for read vs edit). The `task` action name is
  unverified.
- **The model list fills in lazily.** The first `/api/model` call after startup
  listed only `openai`; a few seconds later it listed all providers. The server
  default (`opencode/exo-free`) isn't in the list at all.
- **Modes** (`src/services/agent/modes.ts`): Write, Plan (OpenCode's `plan`
  agent) and Options (the `build` agent). Plan and Options are read-only by
  permission rules (edit and shell denied, whatever the edit setting), and each
  sets the `mode` instruction entry.
- **Options mode** asks for exactly three `### Option N: label` sections, each
  with a fenced code block holding the full replacement. The UI turns them into
  cards (`parseOptions`). Picking one is an ordinary Monaco edit
  (`executeEdits`: undoable, unsaved), never a file write by the agent. The
  editor selection is attached automatically. Picking another option replaces
  the one in use, or the original passage if the author undid it. If the text
  moved, it's found again only when exactly one match exists; otherwise nothing
  changes and the chat says why.

### Bugs found by testing the app

- **Wrong default model** (reported by the user): with the default missing, the
  picker fell back to the alphabetically first model, an LM Studio model without
  tool support, which failed with "OpenAI Chat stream ended without
  finish_reason". Fix: `chooseModel` never auto-picks a model without tools;
  order is saved choice → server default → LiteLLM → any tool-capable model;
  tool-less models are disabled in the picker. Errors show once, prefixed with
  the model.
- **WebKit page-order bug** (reported by the user: "title page missing, starts
  with References"). Tinymist's preview draws off-screen pages as canvas
  previews inside `<foreignObject>`, shrunk with `transform: scale()`. WebKit
  paints transformed HTML in a foreignObject without the parent group's
  `translate`, so all off-screen pages land on page 1. Reproduced in Playwright
  WebKit at preview-pane widths (~420 px), with or without partial rendering;
  Chromium is fine. The DOM is correct; only painting is wrong. Fix (injected
  CSS in the preview webview): size the canvas with `width/height: 100%` instead
  of the transform. Same appearance, correct positions, sharp previews while
  scrolling. A first attempt (hiding the previews) made pages go blank after
  scrolling until the 500 ms debounced redraw, or until a click (also
  user-reported), so it was replaced. Worth reporting upstream (typst.ts).
- **Self-test never started:** `LaunchOptions` serialized as snake_case, the
  frontend read camelCase. Tauri converts command *arguments* to camelCase, not
  return values; structs with multi-word fields need `rename_all = "camelCase"`.

### Preview rendering in the real WKWebView (second round, user-reported)

Reported: pages blank after scrolling until a click; References drawn above the
title page. My first fixes passed in Playwright WebKit but not in the app,
because Playwright's WebKit differs in exactly the two ways that matter:

1. **No `requestIdleCallback`** in Playwright WebKit (so typst.ts falls back to
   `setTimeout`); the real WKWebView has it. typst.ts paints canvas previews in
   an idle callback and every later update awaits that pass. In the preview
   webview idle callbacks stalled until user input, which blocked rendering
   until a click. Fix: shim `requestIdleCallback` with `setTimeout` in the
   preview's init script.
2. **GPU-accelerated canvases** in the real WKWebView are composited layers,
   which WebKit mispositions inside `<foreignObject>` (same bug as the CSS
   transform). Fix: request software canvases (`willReadFrequently: true`) in
   addition to the transform-free CSS sizing.
3. The renderer waits 500 ms after the last scroll event before drawing newly
   visible pages; after a long jump they were blank that long. Fix: dispatch a
   window `resize` 120 ms after scrolling stops (its resize handler redraws
   immediately).

**Verification now uses the real app.** The self-test takes PNG snapshots of
the preview WKWebView (`takeSnapshotWithConfiguration`, includes composited
layers) and records which pages are SVG vs canvas. Sample and 491-page books:
pages in order and painted 150 ms after scrolling to the end and back
(491-page book: pages 490–491 fully rendered 150 ms after a 315,000 px jump).
`screencapture` isn't usable from the agent's environment.

### Source ↔ preview sync

- **Preview → source:** Tinymist sends the standard LSP request
  `window/showDocument` (`{uri, selection, takeFocus}`), not the
  `tinymist/preview/scrollSource` notification VS Code's extension handles
  (that path needs a client flag). Both are handled: open the file, select,
  center, and give keyboard focus back to the editor (`focus_main`).
- **Source → preview:** `tinymist.scrollPreview` + `panelScrollTo` does jump
  (finding 4 above was wrong), but only for positions that map to rendered
  content: never column 0; inside words of running text almost always; code
  (`#figure(...)`), labels and some math not. Failures are silent. A heading
  renders twice (TOC and body) and the preview picks the copy nearest the
  current page.
- Implementation: on cursor settle (150 ms), try candidates best-first
  (`src/editor/preview-sync.ts`: cursor, other words on the line, nearest text
  lines above; on a heading, the first content line below), and stop at the
  first one the preview actually jumps to. The preview webview reports jumps by
  wrapping its WebSocket in an init script. Result: one smooth scroll and one
  ripple per cursor move. Measured in-app: 1 jump per move on both books; a
  heading lands in the body, not the TOC.

### UI zoom (⌘= / ⌘− / ⌘0)

- Native page zoom of the main webview (`Webview::set_zoom`, WKWebView
  `pageZoom`), like VS Code's Electron window zoom; CSS `zoom` would break
  Monaco's hit-testing. Steps 50–250 % (browser steps); persisted; status-bar
  indicator resets on click. The preview webview isn't zoomed: its pages fit
  the pane width either way.
- Shortcuts: a capture-phase key handler in the main webview (⌘=, ⇧⌘= i.e. ⌘+,
  ⌘−, ⌘0), plus View-menu items with the same accelerators so zoom works while
  the preview has focus. A press seen by both is applied once.
- The preview webview is placed in window points, so its pane rect is scaled by
  the zoom. Verified in-app at 125 % and 80 %: within 0.5 pt of the pane.

### Title-bar inset (macOS 26)

Windows get a full-size content view: the main webview spans the 32 pt title
bar and WebKit insets the page (`safeAreaInsets.top = 32`; page viewport 968 pt
in a 1000 pt webview). The preview webview, positioned in window coordinates,
was therefore 32 pt too high (covering the preview header, leaving a gap at the
bottom). It now adds the main webview's native safe-area inset, re-read on
resize (full screen removes the title bar). Verified natively: preview top =
pane top (off by 0 pt).

### Context menus

- Native macOS menus through Tauri's menu API (`core:menu:default` allows
  `popup`), not HTML imitations:
  - **Editor:** Fix This Error (when on one), Ask the Assistant, Get Three
    Versions, Explain This, Cut/Copy/Paste/Select All, Show in Preview, Typst
    Basics.
  - **Tabs:** Close, Close Others, Close Tabs to the Right, Close All, Reveal
    in Finder, Copy Path, Copy Relative Path.
  - **Files:** Open, Use as Main File, Reveal in Finder, Copy Path (the empty
    area: Refresh, Reveal Book Folder).
  - **History rows:** Show Changes, Undo These Changes, Restore This Version.
  - **Chat items:** Copy, Copy Message.
  - **Text fields:** the usual editing commands.
  - **Preview:** Copy, Show the Text Here, Export PDF, Restart Preview.
- WebKit's own menu is suppressed everywhere. Its "Reload" would wipe the app
  state or break the preview. Option-right-click keeps it in dev builds.
- Monaco's HTML menu is off (`contextmenu: false`). Its Cut/Copy/Paste are the
  predefined native items, which go through WebKit's editing commands and so
  reach Monaco's hidden textarea.
- The preview is another webview: an init script swallows its `contextmenu`
  event and reports it over IPC, and the main webview shows the menu. "Show the
  Text Here" clicks the nearest `.typst-text` element. `elementFromPoint` can
  hit a canvas layer that Tinymist ignores.
- Menu "Copy" actions use a small NSPasteboard command (`clipboard_write`).
  They run outside a DOM gesture, where WebKit can refuse `navigator.clipboard`.
- Native popups are modal, so the self-test records each pane's menu instead of
  showing it, then runs actions directly.

### Figures mode

- Figures are made as code the author can see in the preview and keep
  editing: fletcher diagrams, CeTZ drawings, Lilaq charts (from inline numbers
  or CSV/JSON), SVG files and tables. The mode's instructions pin exact package
  versions, all compiled with Typst 0.15.1. Models guess versions otherwise,
  and mismatches fail: cetz-plot 0.1.4 only works with cetz 0.5.x, not 0.4.2.
- No AI image generation. OpenCode has no image tool, and its LiteLLM key is in
  OpenCode's own auth store, which Typst Studio doesn't read. The mode says so
  and offers diagrams, SVG or a placeholder instead (see IDEAS.md).
- With four modes, the mode control became a compact menu (opens upward, a
  description per mode) next to the model picker. ⇧Tab in the message box
  cycles modes, as in Claude Code.
- Verified in-app with gemini-3.8-flash: it added a fletcher flowchart with a
  caption and label using the pinned version; 0 errors; it renders in the preview.

### Book history (TODO #8)

- **A snapshot repo owned by the app, separate from the author's Git.** Each workspace
  gets a Git repo under `<app data>/history/<sha256(root)[..16]>.git`, with the
  book folder as its work tree (`--git-dir`/`--work-tree`). The author's own
  `.git` is never read or written. Git ignores `.git` entries anyway, and a test
  checks the book's `.git` is byte-for-byte untouched. Snapshots respect the
  book's `.gitignore`, and also exclude the PDF output and our temp files.
- **Isolated from the author's Git config.** `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_NOSYSTEM=1`, hooks off, signing off, and no `GIT_DIR`-style env vars.
  Without this, a global pre-commit hook or commit signing would run on every
  snapshot. Arguments are arrays, and version ids are checked to be hex before
  they reach git.
- **When versions are recorded:**
  - on open ("Started keeping history", or "Changed outside Typst Studio: …");
  - 10 s after the last save or disk change ("Edited {files}");
  - right before each agent turn, so the author's own edits are separate;
  - right after each agent turn (`Agent: …` with the message, only if files changed);
  - named versions, which are always recorded, even with no changes;
  - before and after every restore.
  Disk changes during an agent turn are folded into that turn's version, so
  edits the author saves mid-turn are attributed to the agent (Phase 4 can
  split them).
- **Restores never use git on the work tree** (no checkout/reset). The frontend
  reads blobs (`history_file`) and writes them through the normal
  expected-hash `fs_write`.
  - Open buffers with unsaved edits are skipped and named.
  - Clean open buffers are reloaded as an undoable edit.
  - "Undo these changes" (agent versions) only reverts files that are still
    exactly as the agent left them.
  - Files that would need deleting (added later, or created by the agent) are
    left in place and named. There's no delete command yet; moving files to the
    Trash is a later option.
- No pruning yet: history grows with the book (text compresses well). Moving
  the book folder starts a new history (the key is its path).

### Book templates (TODO #12)

- Five templates in `src/templates/<id>/`: novel, non-fiction, textbook,
  children's picture book, blank. Each is an ordinary Typst project: `main.typ`,
  a `style.typ` with the look and a few helpers, and chapters that explain
  themselves in comments. The helpers are `#scene-break`, `#epigraph`,
  `#pull-quote`, `#note`, `#definition`, `#example`, `#exercises` and
  `#story-page`.
- The title, author and year are only ever substituted inside Typst string
  literals (`#let title = "{{title}}"`), escaped by `typstString`, so any title
  is safe. Chapters `#import "../style.typ": *` because included files don't
  see the importer's scope.
- Fonts are bundled with Typst (Libertinus Serif, New Computer Modern), except
  the picture book, which uses Avenir Next. That ships with macOS, and there's a
  bundled fallback.
- `npm run check-templates` compiles every template with the installed `typst`
  (0.15.1), using a title that needs escaping. It fails on any error *or
  warning*; a deliberate bad font proved the warning check works.
- Typography lessons:
  - `pagebreak(to: "odd")` adds blank pages that still get headers, so chapters
    simply start on a new page.
  - A heading show rule must return a `block` with `first-line-indent: 0pt`.
    Otherwise the title is indented and so is the first paragraph after it.
- Creating a book uses `project_create`. It makes `parent/<title>` (refusing an
  existing folder), writes the files with `create_new`, and removes that new
  folder again if anything fails. The book also gets `.typst-studio.json`
  (entry `main.typ`, PDFs to `export/`), a `.gitignore` for `export/`, and a
  `WRITING_STYLE.md` starter with genre-specific prompts.

### Review, rethought

- **What was wrong with the first version:**
  - A read-only "review mode" that got in the way, when commenting already
    worked without it.
  - Comments visible only as faint highlights with a hover.
  - A modal box to write in.
  - "Address all" as a black box: one message, then comments marked resolved
    on the assistant's word. You couldn't see what changed for each, or keep
    one change and undo another.
  - No way to fix one comment, or to hear why one wasn't done.
- **Now** (Google Docs comments, plus a pull-request review):
  - **No mode.** Select text in the editor (or the preview, through the
    mapping), then use the Comment bubble beside the selection, ⌥⌘M or
    right-click. A box opens under the passage: ⏎ adds, ⇧⏎ makes a new line,
    Esc cancels. The editor is never read-only.
  - **Cards in place.** Open comments, and changed ones waiting to be
    checked, show as cards under their passage, in Monaco view zones sized to
    the card. Each card has Fix with assistant, Resolve, Edit (inline) and
    Delete.
  - **The assistant reports on each comment** with one hidden line per
    comment: `REVIEW c3: changed — what it did` or
    `REVIEW c4: declined — why`. An older `ADDRESSED:` line still counts. Fix
    works on one comment or on every open one.
  - **The author decides.** Before the turn, the app records each file's text
    and each passage's place. Afterwards a changed comment becomes "addressed":
    the card shows the assistant's note and the passage's change word by word
    (`passageChange`: the changed lines touching the passage, including lines
    added right after it). **Keep** resolves it. **Undo change** puts the
    passage back (only if it's still exactly as the assistant left it) and
    reopens it. A declined comment stays open, with the reason.
  - **The list** (the toolbar's Review button, with a count, and always in the
    sidebar) groups To check, Open and Resolved.
  - A review turn that ends in the background (another task shown) is handled
    too, by fetching its last reply.
- **Card placement:** Monaco didn't reliably move view zones when a file
  reloaded from disk (a card stayed above the text the assistant had changed).
  Each update now moves any card whose passage moved, keeping its node and
  React state. A changed comment's card goes under the whole new text.
- **Verified with a real model** (self-test `review`):
  - comments added through the bubble (⏎) and ⌥⌘M (the Comment button);
  - cards and highlights shown, the editor editable;
  - comments following two lines added above them;
  - Fix one from its card: changed with a note and its exact change, the
    other untouched;
  - Fix all;
  - Undo restoring the passage and reopening it, and Keep resolving the other;
  - each card's zone starting at the bottom of its passage.

### Review comments (first version)

- **Storage:** comments live beside the text in `.typst-studio/review.json`, in
  the book so they travel with it. The source stays clean.
- **Anchoring:** each comment keeps the quoted passage, 32 characters of
  context either side, and a line hint, like a web annotation's
  TextQuoteSelector. Re-anchoring picks the occurrence whose context and line
  match best. A short quote (< 20 chars) only re-anchors if some context
  matches; otherwise it shows "text changed" rather than jumping to the same
  phrase elsewhere.
- **Review mode:** the editor goes read-only and a floating Comment button
  follows the selection. ⌥⌘M and right-click → Add Comment work in any mode,
  and preview selections work through the existing mapping. Passages are
  highlighted, with the comment on hover. The Review tab can go to, edit,
  resolve/reopen and delete comments, and show or remove resolved ones.
- **Addressing:** "Address all with the assistant" sends every open comment
  (id, file, current line, quote, text) in one message, in Write mode. The
  reply ends with `ADDRESSED: c1, c3`, and those comments are marked resolved.
  Marker lines are read and hidden as whole lines anywhere near the end of a
  reply: the model put the task marker after it.
- Verified in-app with gemini-3.8-flash:
  - Read-only mode, the widget and the multi-line dialog.
  - Two comments saved and highlighted; they followed an insertion above.
  - Both addressed and resolved; markers hidden.

### Task-based conversations

- **Each OpenCode session is a task.** The header's task menu lists this
  book's sessions, from `GET /api/session?directory=<book>`, under Open and
  Done. Switching restores the transcript from `/api/session/{id}/context`:
  user text without our appended selection block (its labels become chips),
  plus assistant text and tool parts. It also re-applies the current mode,
  permissions and instructions.
- **Goal and done check:** a `task` instruction entry asks the assistant to
  restate the goal first (asking only if it's unclear), stay on it, and end
  with the line `TASK COMPLETE?` when it believes the goal is met. The UI hides
  that line and shows "Yes, it's done: new task" / "Not yet". Done marks the
  task finished (remembered per book on this Mac), saves a named History
  version "Task done: …" and starts a fresh conversation. Sending in a done
  task reopens it.
- **Context meter.** It shows the latest call's prompt size (input + cached
  tokens) against the model's context window, turning amber over 55% and red
  over 80%. `session.usage.updated` is the session's running total, which
  overstates it.
  - **Compact** calls OpenCode's compaction. The conversation becomes one
    summary message, shown as "Summary of the conversation so far".
- Verified with gemini-3.8-flash: restated goal, did it, `TASK COMPLETE?`,
  finish (task done, History version), switch back (messages restored),
  compact (summary shown).

### Selections go with chat messages (editor or preview)

- **Automatic, like Claude Code:** the editor's current selection appears in
  the message box as a dashed "Selected" chip (label, length). Clicking it
  shows the text; × leaves it out of the next message, keyed on place and
  text, so a different selection comes back. It's sent with every message
  while selected. ⌘I still pins a selection as a fixed attachment.
- **Preview selections:** Tinymist's preview has a real text layer
  (`.typst-text` holds the characters), so a drag there gives text. An init
  script waits for the selection to settle, marks the first and last text
  runs, and reports the text. The app then:
  1. clicks those runs through Tinymist's own click-to-source, catching the
     `window/showDocument` positions instead of moving the editor;
  2. finds the selected text near them, ignoring whitespace, markup
     characters (`_ * $ # \`) and typographic quotes and dashes;
  3. if math blocks a full match (the preview shows "λ", the source says
     `lambda`), uses the longest matching start and end;
  4. selects that range in the editor, labelled "From preview".
- Verified in-app:
  - The chip, its preview, dismissing and its return.
  - A message sent without ⌘I carried the selection; the model repeated the
    sentence word for word.
  - A two-run preview selection mapped to the exact source text.

### Runnable code examples (technical books)

- **Markup:** `#run("name", ```python …```, expect: "…")`, from a `code.typ`
  helper that sits in the book. The book shows the code and the real output
  stored in `code-output/outputs.json`, which is committed with the book, so
  `typst compile` works without the app. The helper reads one JSON file
  (always present) with `.at(name, default: none)`, because `read()` of a
  missing per-example file would be a compile error.
- **Out-of-date detection in Typst itself.** Each stored output keeps the code
  that produced it, and the helper compares it with `src.text` (trimmed). Editing an example shows
  "out of date" in the live preview at once, and expect mismatches show ✗,
  with no hashing in Typst. The app parses examples with the same text rules
  as Typst's raw blocks: fence newlines dropped, common indentation removed,
  blank lines kept. This was cross-checked with `typst eval` on indented,
  four-backtick and escaped cases.
- **Running** (`code.rs`):
  - the interpreter matching the language tag (python3, node, bash/zsh, ruby,
    Rscript, julia, perl, lua), found like the other tools;
  - a temp file, the book as working directory, stdin closed;
  - 256 KB cap per stream and a 30 s timeout that kills the whole process
    group, so child processes don't linger.
  - Only for books the author trusts: asked once per book, remembered on this
    Mac, revocable in Settings.
- **App:**
  - ▶ Run lenses above each example, with its status.
  - A Code tab: run one, run what's stale, run all.
  - A check before Export PDF: run them first / export anyway / cancel.
  - Agent instructions: write examples, never run them, never edit
    outputs.json.
- **The loop:** after an assistant turn in a trusted book, changed examples
  are re-run. Failures come back as a chat notice whose button asks the
  assistant to fix them. Verified with gemini-3.8-flash: a planted bug in
  `fib` came back as "expected …, got …"; the button got it fixed; the re-run
  said "all fine". Tinymist picks up the rewritten outputs.json, and the
  preview shows the real output.
- **New template, "Programming book"**: textbook look, code styling and
  sample Python examples.

### Assistant permissions

- **Action names, checked against the server's own built-in agents** (OpenCode
  2.0.20): `read`, `glob`, `grep`, `edit` (also creating files), `shell`
  (resource = the whole command line), `external_directory`, `webfetch`,
  `websearch`, `subagent`, `question`.
- **Fixed a bug:** our rules denied `task`, a name that doesn't exist; the
  subagent action is `subagent`. Both are denied now.
- **Six controls** (Ask / Allow / Never): edit and create files; rename or
  move (`mv`, `git mv`); delete (`rm`, `rmdir`, `unlink`, `trash`, `git rm`,
  `shred`); files outside the book; other commands; the web.
- **Presets:** "Ask first" (the default), "Edit freely" (the old "edit
  without asking", migrated) and "Read-only".
- **Rule order** (last match wins): everything asks, then the specific rules,
  then Plan/Options read-only rules, then the build-command denials last.
  - Rename and delete are shell commands in OpenCode, so they're matched at the
    start of a command and after separators (`cd x && rm y`, `;rm`, `| xargs
    rm`). False positives like `echo "don't rm"` only ask or deny; nothing is
    wrongly allowed.
- **OpenCode's `question` tool is denied.** Typst Studio doesn't render it,
  so the agent asks in its reply.
- **The control moved to the composer**, next to the mode and the model, and
  opens upward. Settings shows the same editor. Changes apply to the current
  conversation, and the chat notes what changed.
- **Verified in-app with gemini-3.8-flash:**
  - Ask first: an edit shows a card with the diff, and rejecting it leaves the
    file alone.
  - Edit allowed: the edit lands with no prompt.
  - Delete set to Never: `rm delete-me.typ` → "Permission denied: shell", and
    the file is still there.

### Files: create, rename, duplicate, trash

- **Where:** in the file tree's right-click menu (New File, New Folder, New
  Chapter, Rename, Duplicate, Use as Main File, Move to Trash) and in File →
  New File (⌘N). Names go through the in-app text dialog.
- **Rust commands** (`files.rs`): mkdir, rename, copy, trash.
  - Every path goes through `workspace::resolve`, so it stays inside the book.
  - Nothing is ever overwritten.
  - Deleting means NSFileManager `trashItemAtURL`, i.e. the macOS Trash, never
    `remove_file`.
- **Renames keep the book compiling.** Every `.typ` file's path arguments are
  rewritten to the new location: `#include`, `#import`, `image`,
  `bibliography`, `read`/`json`/`csv`/…, relative or root-absolute (`/x`).
  Packages are skipped. This includes relative paths inside files that moved
  with a renamed folder.
  - Open buffers are edited in place (undoable) and saved unless they were
    dirty; closed files are written with the expected hash.
  - Renaming the main file updates `.typst-studio.json` and restarts the
    preview. The file list is refreshed first, or validation rejects the new
    name.
  - Open tabs move with the file. A rename is refused while an affected file
    has unsaved edits.
- **Move to Trash** confirms first, naming the references. Whole-line
  `#include` lines for the item are removed; other references are only named.
- Verified in-app on a fresh novel: rename a chapter, the chapters folder and
  main.typ; duplicate; trash. Includes, tabs and the setting all follow, with
  0 errors throughout.
- The self-test's trash step puts real files in the Trash. Terminals can't
  open `~/.Trash` without Full Disk Access, so they can't be cleaned up from
  here.

### New-book journey: sizes, chapters, research papers

- **Page sizes.** Each template offers trim sizes plus Custom. The size is a
  validated Typst length (`^\d+(\.\d+)?(in|mm|cm|pt)$`, positive), inserted
  as-is into `book.with(width:, height:)` in main.typ, so it's easy to change
  later. Titles still go only into escaped strings.
- **New Chapter** (⌥⌘N, File menu, + in the files header, right-click):
  - creates `chapters/NN-slug.typ`, numbered after the highest existing
    number and keeping the digit width;
  - copies the `#import` lines from an existing chapter and escapes the title's
    markup characters;
  - inserts `#include` after the last chapter include (else before
    `#bibliography`, else at the end), using a path relative to the main file;
  - the main file changes in its buffer (undoable) and is saved unless it
    already had unsaved edits.
- **Research papers** come from official Typst Universe template packages.
  The Rust side downloads `packages.typst.org/preview/<name>-<version>.tar.gz`
  over HTTPS, the same as `typst init`. reqwest gained `native-tls`, which uses
  the macOS Security framework. The package is checked against
  `[a-z0-9-]+` / `N.N.N` and size-limited to 50 MB, then unpacked with the
  system bsdtar, which refuses `..` and absolute paths. Only regular files from
  the `[template]` folder are copied, never symlinks, into a new folder only.
- **Venues offered:** IEEE (charged-ieee), ACM (faithful-acmart), NeurIPS,
  CVPR, AAAI, ACL (tracl), Springer LNCS (fine-lncs), arXiv (arkheion), AMS,
  APA 7. Each one's `main.typ` compiles with Typst 0.15.1
  (`npm run check-templates -- --papers`).
- **Not offered:** ICML (lucky-icml 0.7.0) and ICLR (clear-iclr 0.7.0). Their
  main.typ fails on 0.15 ("cannot add string and type", "unknown variable:
  diff"). A first check had wrongly compiled `appendix.typ`.
- **Fonts.** Several venues want free fonts (TeX Gyre Termes/Cursor,
  Libertinus, Inconsolata, New Computer Modern). Without them Typst falls back
  with a warning. The app names the exact `brew install --cask …` command,
  checked to exist in homebrew/cask.
- **Title and authors.** These live in each template's own markup, so the app
  doesn't guess. It puts a ready message in the composer asking the assistant
  to fill them in; verified in-app with IEEE (title and both authors set,
  0 errors).
- **The message box's text lives in the studio** (`composerDraft`), not only in
  the component. It survives the composer remounting, e.g. when a book opens,
  and can be filled before it mounts. The first try, a consume-once pending
  draft, lost the text on remount.

### Onboarding for writers new to Typst (TODO #11)

- **Typst basics** (`src/help/typst-basics.json`): plain-language explanations
  with examples, covering paragraphs, emphasis, quotes and dashes, escaping,
  headings, lists, chapter files, footnotes, citations, figures, quotations,
  math, what red squiggles mean, and shortcuts. It opens in the right-hand pane,
  so the editor and preview stay visible, from the toolbar's ? button or
  Help → Typst Basics. On the welcome screen it's a dialog. Markup patterns get
  "Insert", an undoable edit at the cursor; block examples get their own
  paragraph. The content is JSON so `npm run check-templates` also compiles
  every example (14) and fails on warnings.
- **Welcome screen:**
  - New Book first, then recent books;
  - "New to Typst?" with a link to the guide;
  - tool status in plain words ("Live preview", "Writing assistant"). A
    missing tool shows its install command, checked to be in homebrew-core
    (`brew install tinymist`, `brew install opencode`).
  - Versions are parsed cleanly. Homebrew's tinymist reports
    `VERGEN_IDEMPOTENT_OUTPUT`, so its version is read from the Cellar path.
- **Chat starter:** before the first message, the assistant pane says what the
  assistant does and offers suggestions. Clicking one fills the composer
  without sending.
- **Errors:** the status bar's error count jumps to the next error. "Ask the
  assistant to fix it" attaches the error's line and asks for a plain-words
  explanation plus a fix. Verified in-app with a real model: an unknown
  variable was explained and removed, leaving 0 errors.
- The agent's instructions now say many authors are new to Typst: explain
  unfamiliar markup briefly and prefer the simplest markup.
- Self-tests no longer write the recent-books list or the last-opened folder.
  They share localStorage with the author's app, and scratch folders showed up
  there.

### Cover designer

- **What a cover is here:** a print wrap (back, spine, front, with bleed all
  round) as its own Typst document in the book's `cover/` folder.
  - `spec.typ` holds the measurements: trim size, page count, paper
    thickness or an exact spine width, and bleed. The wrap is
    2 × trim + spine + 2 × bleed by trim + 2 × bleed.
  - `design.typ` is the design, from one of three styles: Classic, Band, or
    Picture (which comes with a placeholder `front.svg`).
  - `cover.typ` is what's printed. `preview.typ` is the same with a guide layer
    showing bleed, trim, spine folds, safe areas, the barcode box and the
    spine width.
- **Why separate files:** the author edits only `design.typ`. Typst Studio
  rewrites only the `trim-width`, `trim-height` and `pages` lines of `spec.typ`
  ("Update from book"), so a changed bleed or exact spine width survives.
- **Spine:** pages × thickness per page, using Amazon KDP's published figures
  for cream, white and colour paper. An exact width from the printer
  overrides it, and the dialog says the printer's spine calculator is the one
  to trust. Spine text appears only from 0.25in up, as printers advise.
- **Preview:** a Book | Cover switch in the preview header restarts Tinymist on
  `cover/preview.typ`. While the book is shown, its page count is remembered
  (`bookPages`) for the spine. Export PDF always exports the book's main
  file, even while the cover is showing. Export cover compiles
  `cover/cover.typ` (no guides) to the export folder.
- **Safety:** creating a cover refuses if any of its files exist, and never
  overwrites them.
- **Checks:** `check-templates` compiles every style with a 24-page spine
  (too thin for text), a 500-page spine and an exact 20mm spine. It checks
  that the PDF is one page of exactly the wrap size.
- **Verified in the app** (self-test `cover`):
  - The dialog prefills title, author, trim and pages from the book.
  - The Band cover for a 5.5×8.5in novel exported at 811.44 × 630 pt, the
    expected size.
  - After three chapters were added, the spine followed (5 → 8 pages) on
    "Update from book".
  - Export PDF while the cover was showing still produced the 8-page book.
- **Not done:** printer-specific templates (Mixam's or IngramSpark's own spine
  and bleed rules) and PDF/X output. Typst 0.15 writes PDF/A and PDF/UA, not
  PDF/X. Printers such as Mixam convert to PDF/X themselves; KDP accepts
  standard PDFs.

### History: what changed from one version to the next

- **The problem:** versions showed line counts ("+1 −1"), and the diff opened
  one file at a time in Monaco's side-by-side editor. In prose a paragraph is
  one line, so "+1 −1" can mean one word or a rewritten paragraph.
- **What changed** opens one window per version. It covers every changed
  file, with the changed paragraphs shown as text: deleted words struck
  through, added words highlighted, a line of context around each change, and
  word counts per file and in total.
  - **◀ Older / Newer ▶** (⌥← / ⌥→) step through versions one at a time.
  - **Compare with now** shows everything since a version.
  - The side-by-side diff, Restore file, Undo these changes and Restore this
    version remain available from the same window.
- **Diff:** a Myers diff (`src/lib/diff.ts`), checked against a brute-force LCS
  on random inputs. It runs on lines first, then on words only inside changed
  passages, so a 3,000-paragraph chapter stays fast. Passages over 6,000 words
  are shown as replaced rather than diffed word by word. Changes separated
  only by a space or a punctuation mark are grouped into one phrase:
  "~~was quiet~~ lay still", not alternating word fragments. Changes up to two
  lines apart share one passage.
- **Verified in the app** (self-test `changes`):
  - The second edit showed "with ~~her~~ the collar *of her coat* turned up"
    (+4 −1 words).
  - Older went to the named version (no files), then to the first edit
    ("~~noon~~ early morning").
  - Compare with now showed both changes (+6 −2).

### The assistant's changes, marked in the editor

- **Source:** History's agent versions. Every turn that changes files is one
  version, with the files before and after, so the marks cover every way the
  assistant changes a file (edit, write, patch, shell) and survive restarts.
  History is the record; the tool events aren't needed. The per-file log
  (`history_list` with a path: `git log -- :(literal)path`) finds a file's
  last 12 agent versions in one call. Their line changes are worked out once
  per version and cached, since versions never change.
- **Mapping onto today's text:** each version's changed lines are mapped onto
  the current text with a line diff. A line keeps its mark only while it is
  exactly as the assistant left it: rewriting a line makes it the author's,
  and lines added above move the marks down. Where two versions changed the
  same line, the newer one wins. Removed text gets a small notch on the line
  after it. It repaints 300 ms after typing stops, like the review highlights.
- **What it shows:**
  - a violet gutter bar (the ✦ colour History uses) with a faint tint on the
    line, and a scroll-bar mark to find changes in long chapters;
  - a hover on the line number (`lineNumberHoverMessage`, so text hovers stay
    quiet), with the request, the time, the earlier text, and a **What
    changed** link (a trusted command link, only for that command);
  - right-click → **What the Assistant Changed Here**;
  - **History of This File** (editor and file-list menus) filters History to
    that file's versions.
  - Settings can turn the marks off.
- **Verified in the app** (self-test `aiedits`):
  - A recorded agent version marked line 10 (changed) and 16–17 (added).
  - After the author rewrote line 17 and added a line on top, the marks moved
    to 11 and 17 (the blank line); the rewritten line lost its mark.
  - The menu entry opened the right version (+9 −2 words), and the file's
    history listed its two versions.
  - A real turn (change "the colour of slate") marked line 11 when it ended.

### The lines the assistant read, marked in the editor

- **Source:** the `read` tool's result. OpenCode 2 starts it with "Read file
  x, lines 1-35" and then numbered lines ("12: text"). Other versions wrap the
  numbered lines in `<content>`. These were checked against OpenCode's own
  message store. The numbered lines are the exact range and text read,
  including when the output was truncated, so they are parsed rather than
  `offset` and `limit`. A run of lines only counts while the numbers follow
  on, so a book line that itself starts "3: " can't confuse it. Tool paths
  (relative or absolute) become book paths; reads outside the book are
  ignored.
- **Scope:** the current conversation. A new conversation starts with none.
  Switching to an earlier one rebuilds its reads from the transcript, as do
  compactions. A compaction drops older reads, matching what the
  conversation still has in context.
- **Placing reads on today's text:** the read block is diffed against a
  window around where it was read (±300 lines, or the read's length), not the
  whole file. Then the mark spans from the first to the last read line still
  in the file, ignoring blank lines. Overlapping reads merge. The diff now
  keeps only the active band per step (memory O(D²) instead of O(D·(N+M))),
  so a 35-line read in a 4,000-line file stays fast.
- **What it shows:**
  - a thin blue gutter bar beside the violet "changed" bar, with a tooltip,
    and a faint scroll-bar mark; no text hover, since whole-file reads would
    put it on every line;
  - the chat's read rows say "path · lines 8–13", and clicking one opens the
    file with those lines selected;
  - Settings can turn it off.
- **Verified in the app** (self-test `aireads`):
  - A read of lines 8–13 through the event path was marked 8–13, and moved to
    10–15 when two lines were added above.
  - Its chat row selected 8–13, and a new conversation cleared the marks.
  - A real Plan-mode read was marked 1–15 (what the model chose to read),
    gone after switching away, and back from the transcript on return.

### Export PDF asks where to save

- **Export PDF…** (⇧⌘E, the toolbar, the File menu) opens the macOS Save
  dialog. For each book it starts where that book was last saved. The first
  time it suggests Documents/<title>.pdf, with the title from `#let title` or
  `#set document(title: …)`.
- Tinymist still builds into the book's export folder, and the result is
  copied to the chosen place. The `export_copy` command only copies `.pdf`
  files from the book, to an absolute `.pdf` path in a folder that exists,
  through a temporary file and a rename, so a failed copy never leaves half
  a PDF.
- The message says where the PDF went (the folder shortened in the middle when
  long) and has **Open** and **Show in Finder**. `open_pdf` and `reveal_pdf`
  only act on existing `.pdf` files.
- **Open Exported PDF** (⌥⌘E; File menu, the preview's header and its menu)
  opens the book's latest PDF in the PDF viewer. It looks where the book was
  last exported, then in the export folder, then next to the main file. With
  none, it offers Export PDF…. PDFs in the file tree open in the viewer too,
  not as text.
- Remembered locations are kept per book in local storage
  (`studio.exportTargets`), never from self-tests. Self-tests answer the dialog
  themselves (`studio.pickExportPath`).

### Tab shortcuts (VS Code's, plus Safari's ⌘W)

- ⌘W closes the tab. Close Window moves to ⇧⌘W, and the default menu's ⌘W
  "Close Window" is removed from File and Window. ⇧⌘T reopens closed tabs, the
  last 30 of them, newest first.
- ⌥⌘T closes the others. ⌘K W or ⌘K ⌘W closes all, ⌘K U the saved ones,
  ⌘K P copies the path and ⌘K R shows the file in Finder.
- Next and previous tab: ⌃⇥ / ⌃⇧⇥ (also in the Window menu), ⌥⌘→ / ⌥⌘← and
  ⇧⌘] / ⇧⌘[. ⌃1…⌃9 picks a tab by position, ⌃0 the last.
- Keys are matched by position (`KeyboardEvent.code`), since ⌥ changes the
  character (⌥T is †).
- In the editor, the ⌘K chords are Monaco keybindings, so Monaco's own (⌘K ⌘C
  comment, ⌘K ⌘U uncomment) still work. Elsewhere a window handler takes ⌘K
  and the next key within 1.5 s.
- A press can reach both the page and the native menu (as zoom found), so the
  same tab command within 300 ms runs once.
- **Fix:** with the editor focused, ⌘K ⌘W closed only one tab. Monaco ran
  ⌘K chords there, but the window handler caught the second key as a lone ⌘W.
  Every ⌘K chord is now read in one place, editor included. The editor's own
  ⌘K chords are passed on as its actions: ⌘K ⌘C / ⌘U to comment and
  uncomment, ⌘K ⌘0 / ⌘J and ⌘K ⌘[ / ⌘] to fold and unfold, ⌘K ⌘L to toggle a
  fold, ⌘K ⌘X to trim whitespace, ⌘K ⌘F to format the selection. Tested with
  the keys sent to the editor.

### Showing that the assistant is working

- **Live events** (recorded from OpenCode 2.0.20 with a real turn, through a
  raw-event tap in the self-tests):
  - `session.step.started` (a model call starts);
  - `session.reasoning.started` / `.delta` / `.ended` (the model's thinking);
  - `session.tool.input.started` (the tool chosen) and `session.tool.called`
    (its input);
  - the text events;
  - `session.retry.scheduled` (`attempt`, `at`, and an error such as a 429
    from a busy free model). Before this, a retry looked like the app hanging.
- **The progress line** at the end of the chat, from the moment Send is
  pressed: a spinner, a label with a light sweeping across it, and the time so
  far. The label is Sending…, Thinking…, the tool's own label (Reading …),
  Writing…, or "The model is busy. Trying again in 8 s (attempt 2)" with a
  countdown and the provider's message as a tooltip. It's hidden while a
  thinking block already says "Thinking…".
- **Thinking blocks:** while the model reasons, its last lines stream in
  faintly, fading out at the top. When it's done they fold to "Thought for
  4 s", which opens the full text. Saved conversations show them folded (from
  the reasoning parts' times).
- `prefers-reduced-motion` stops the spinner and the sweep.

### Starting and finishing tasks from the header

- The assistant's header has a labelled **New task** button (blue, never
  smaller than at 100%) where the small ＋ was. The task menu still has it.
- **Done** shows whenever the conversation has a reply and isn't running. It
  doesn't wait for the assistant's "Is this task done?" check, which only comes
  when the reply ends with the marker; a question answered in passing never
  had one. It marks the task done, saves a named version, and starts a new
  task. Its message offers "Open it again". The task menu has **Mark done**
  too.
- Titles fall back to the first message until OpenCode names the conversation.
- Verified with a real model (self-test `questions`): after an answered
  question, Done marked the task done and started a new conversation.

### Several tasks at once

- OpenCode runs conversations concurrently and its event stream carries every
  session's events. The app shows one conversation, while others carry on.
- **Leaving a conversation** that's at work or waiting on the author (switching,
  or New task) keeps it in `agent.background`.
  - Its own events keep a small status up to date: at work and what it's
    doing ("Reading “The Storm” (chapter 2)", "Writing…", "The model is busy,
    trying again"), needs you (a question or a permission), new reply, or
    stopped.
  - The full transcript isn't mirrored in the background; switching back
    reloads it from OpenCode.
- **When a background turn ends:**
  - its changes become a History version, labelled with the message that
    started it, and the editor marks refresh;
  - a notice "“…” is done." (or "needs you: it has a question") has a Show
    button;
  - turns that end without an event (a rejected permission) are caught by
    polling `/api/session/active` every 4 s while any run.
- **Switching back:**
  - The transcript, pending permission cards
    (`GET /api/permission/request`, filtered to the conversation) and
    pending questions are fetched, and whether it's running comes from
    `/api/session/active`.
  - Saved items now get the ids the live events use (text and reasoning
    numbered per kind within a message; tools by call id), so a reply still
    being written carries on in the same item.
  - Switching doesn't go through the end-of-turn hooks, since leaving isn't
    the end of a turn.
- **Task menu:** groups In progress (the shown one while it runs, plus the
  background ones, each with what it's doing), Open and Done. The trigger shows
  how many others are at work (spinner) and how many need you (orange).
  Switching and New task are no longer blocked while something runs.
- **Verified with a real model** (self-test `multitask`):
  - A carried on in the background while B was asked and answered.
  - A's finish produced "… is done." with Show and a "new reply" status.
  - Switching back showed A's replies.
  - Leaving and returning mid-reply ended with one reply item and the full
    text.

### Messages while the assistant works: queue, send now, take back

- **OpenCode 2 does this natively.** Each conversation has an inbox, and
  `POST /api/session/{id}/prompt` takes `delivery`: `queue` delivers after the
  current turn, `steer` at its next step. `PATCH …/inbox/{id}` changes the
  delivery, `DELETE` takes it back, and `session.inbox.delivered` reports
  delivery. All read from the server's OpenAPI file.
- **In the app:**
  - While it works, the composer stays usable. ⏎ (or the Queue button) queues;
    ⌥⏎ or Send now steers. Stop still interrupts the turn.
  - Queued messages wait above the composer (Queued / Next step) with Send now,
    Edit (takes it back into the composer) and ✕.
  - On delivery each one moves into the conversation where it arrived. A
    queued one starts its own turn, which gets the progress line too.
- The delivery event can arrive before the reply to our request, so early
  inbox ids are remembered.
- **Verified with a real model** (self-test `queue`):
  - A queued message waited, then ran and was answered.
  - A steered one was delivered mid-turn and answered in it.
  - A taken-back one never reached the conversation.

### The settings file, and commands allowed without asking

- **`~/.typst-studio/settings.json`** holds every preference: send key,
  History's place, editor marks, zoom, permissions and `allowCommands`. It's
  like Claude Code's `~/.claude/settings.json`: plain JSON, editable by hand.
  - Unknown keys are kept when the app writes.
  - Edits made elsewhere apply when the window regains focus.
  - A file with a JSON mistake is never overwritten. The app keeps the last
    good settings, and Settings → General shows the problem, with the
    file's path and "Open in text editor".
  - On first start the file is written from the settings this Mac had (local
    storage, which stays as a fast cache).
- **Self-tests never touch it.** With `TYPST_STUDIO_SELFTEST` set, the folder
  is next to the results file (`TYPST_STUDIO_CONFIG_DIR` overrides). Before
  this, tests shared the author's local storage.
- **Commands:** `allowCommands` in the settings file applies to every book; in
  `.typst-studio.json` to one book (it travels with it). Both add to the
  built-in look commands and are edited in Settings → Permissions. Names are
  one or two plain words (`python3`, `uv run`), with no wildcards or shell
  syntax; the app adds `cmd` and `cmd *`. A line still asks if any part isn't
  allowed, writes with `>`, or deletes, and building stays blocked. Changes
  apply to the current conversation at once, with a note in the chat.
- **Verified** (self-test `config`, in its own folder): the first write; an
  app change reaching the file; an outside edit applied on focus with an
  unknown key kept; and commands added from the Settings page for every book
  (`Rscript`) and this book (`node`).

### Settings, full size

- A 960×700 window, with sections in a sidebar: General, Assistant,
  Permissions, This book and Tools.
  - **General:** the send key, History's place, the UI size.
  - **Assistant:** the model in use, the editor marks, the style guide.
  - **Permissions:** presets, the detailed settings, and the commands that
    never need asking.
  - **This book:** `.typst-studio.json`.
  - **Tools:** Tinymist, OpenCode and git, with versions and paths.
- Open it with Settings… in the app menu (⌘,), as on any Mac app, or the
  toolbar's settings icon, now full size. The last section shown is
  remembered.

### Commands that only look never ask

- **How OpenCode checks shell commands** (verified live in 2.0.20):
  - A command line is split into its commands, and each is checked on its own:
    `ls a && wc -l b; echo x | cat` asks about four.
  - `$(…)` and backticks are checked too.
  - Redirections and flags stay in the command (`echo hi > f.txt`,
    `find … -delete`, `sort -o out`).
  - So an allowlist is safe as long as the writing forms are caught.
- **The rules (last match wins):**
  - `shell *` takes the author's setting;
  - then the commands that only look are allowed: ls, pwd, cd, cat,
    head/tail, wc, file, stat, du, tree, which, echo, printf, date, basename,
    dirname, realpath, diff, cmp, grep/egrep/fgrep/rg, find, sort, cut, tr, nl,
    column, jq, shasum, md5, and git status/log/diff/show/blame/ls-files;
  - then the writing forms (`*>*`, find's -delete/-exec/-ok/-fprint/-fls,
    `sort -o`, `--output`, `tree -o`) fall back to the shell setting;
  - then rename/delete and the build block, as before.
  - In Plan, Options and Read-only, the look commands still run and the
    writing forms are denied.
- `sessionRules` takes extra commands to allow (the config file, next).
- **Verified live in "Ask first":** `ls chapters && wc -l main.typ` ran without
  a question; `echo hi > probe-out.txt` asked, was rejected, and wrote nothing.

### The assistant asks: multiple choice or free text

- **How OpenCode 2.0.20 does it** (from the server's bundled code, since the
  OpenAPI file has no question routes): the `question` tool creates a Form
  with one field per question:
  - `q0`, `q1`… with the header as the title and the question as the
    description;
  - `string`, or `multiselect` when `multiple`;
  - options of `{value: label, label, description}`;
  - `custom: true`, so free text is always allowed.
  It waits for `POST /api/session/{id}/form/{formId}/reply {answer: {q0: …}}`.
  Cancelling the form (`DELETE`) gives the model "The user dismissed this
  question". Events: `form.created`, `form.replied`, `form.cancelled`.
- **Permissions:** the question action is allowed (asking needs no
  permission); before, it was denied because the app couldn't show it. The
  instructions ask for the tool when the author must choose: a few options with
  a line each, the recommendation first.
- **In the chat:** a card ("The assistant asks") with each question's header
  and text.
  - Options are buttons with their descriptions and number keys; 1–9 picks,
    and ⏎ answers.
  - Multi-select questions use checkboxes; there's an "Or type your own
    answer…" field.
  - Answer and Dismiss buttons; afterwards the card shrinks to "You answered:
    …".
  - The progress line says "Waiting for your answer", and the tool's own row is
    hidden while its card is there.
- If the form event doesn't arrive, the app lists pending forms 1.5 s after a
  question tool starts, and again on switching conversations. Saved
  conversations show the row "Asked you a question · you said “…”".
- **Verified with a real model** (self-test `questions`): the asked card, an
  option clicked and answered (the reply followed the choice), and a dismissal
  that ended the turn.

### Feeling fast

- **Instant response:** Send clears the composer and shows the message at
  once. Saving, the History version, creating the conversation and the request
  follow. If sending fails, the message is removed again and its text goes
  back in the composer, with the reason.
- **Work in progress always moves:**
  - a sweeping bar under the assistant's header for the whole turn, plus the
    progress line;
  - the same bar under the preview's header while it typesets or starts, shown
    only after 150 ms, since typesetting is usually faster than that;
  - spinners on running tool rows and in the Export button.
- **Entrances:** chat items rise in, dialogs scale in, toasts pop up, tabs and
  sidebar views fade in, and buttons give a slight press. All take about
  0.1–0.2 s.
- `prefers-reduced-motion` turns it all into a still bar.

### Tool calls in words

- Chat rows describe each tool call as a sentence, using the book's names:
  - "Read “The Storm” (chapter 2) · lines 1–40", "Read the main file",
    "Read the style guide";
  - "Searched for “lighthouse” in chapters/ · 3 matches", "Looked for
    **/*.typ · 12 files";
  - "Edited “The Harbour” (chapter 3)", "Ran a command `python3 count.py`",
    "Read a web page (typst.app)".
- While a tool runs, the progress line says the same in the present tense
  ("Reading …"), with a small spinner on the row.
- **Names:** chapters are numbered by the main file's `#include` order
  (commented-out lines skipped) and named by their first `= heading`. The map
  is rebuilt when a book opens, and for the changed files after a save or a
  change on disk.
- The file in a row is a link: reads open with their lines selected, edits
  open the file. The raw output still folds out under the row, and its tooltip
  keeps the tool name and input.

### Printing with Mixam

- **What Typst Studio does:** it makes print-ready PDFs, checks them, and
  opens Mixam's product page in the browser. Size, paper, binding, price,
  upload and payment all happen on Mixam's site. Typst Studio never places
  an order or handles money.
- **Mixam's requirements** (mixam.com/support/filesetup and /support/bleed,
  October 2026):
  - 0.125in (UK: 3mm) bleed on inner pages and covers. Files without bleed are
    scaled up to the bleed size, which moves text toward the edge.
  - Single pages for the interior; the cover as one spread with the spine.
  - Perfect binding from 32–48 pages, depending on the paper.
  - CMYK preferred; RGB is converted on upload.
  - Quiet areas: 0.25in from the edges and 0.5in from the binding (UK: 5mm and
    12mm or more).
- **Interior bleed without touching the book:** Typst 0.15 has `page(bleed:)`.
  The PDF grows by the bleed, a TrimBox marks the finished page, and the page
  `fill` runs into the bleed. Typst Studio writes `.typst-studio/interior.typ`
  (`#set page(bleed: 0.125in)` + `#include "/main.typ"`) and exports that.
  Pagination is unchanged, since `100%` is still the trim size.
  - Content sized to the page stops at the trim. The picture-book template's
    `picture-page` now reaches into `page.bleed`, and the checks warn about
    zero-margin pages elsewhere that don't use `page.bleed`.
- **Checks read the real PDFs.** The Rust `pdf_info` command uses lopdf to
  read page count, MediaBox and TrimBox, and a test runs on PDFs that Typst
  made. It checks:
  - every page has the same size, with bleed, and matches main.typ's trim;
  - the page count is even, and long enough for perfect binding;
  - the cover's trim and page count match the book, and the cover PDF is one
    page of exactly 2 × trim + spine + 2 × bleed (to 0.1pt, under one page of
    spine);
  - code examples are up to date, and there are no errors.
  - Fixes sit next to the checks: Design a cover, Update cover from book, and
    Run code examples.
- **The spine comes from Mixam.** Mixam shows the spine width for the chosen
  paper and page count, but only on its site (or through its API). The dialog
  takes that number, writes it into `cover/spec.typ` and makes the cover again.
- **Exports straight after an edit:** Tinymist sees disk writes through its
  file watcher, a moment later, and the first print run exported a cover
  from the old spine. Edits that are exported straight away (the cover spec,
  the wrapper) now go through an open document, so Tinymist gets `didChange`
  at once.
- **Opening the site:** the Rust `open_url` command only opens `https://` pages
  on mixam.com, mixam.co.uk, mixam.ca and mixam.com.au (tested against
  look-alike hosts). Each site's `/novels`, `/paperbackbooks`, `/textbook`,
  `/childrensbooks`, `/hardcoverbooks` and `/support/filesetup` pages were
  checked (HTTP 200); mixam.de redirects them, so it's left out. The site
  follows the system region and can be changed.
- **The Mixam API (not used yet):** `POST /api/public/offers` returns prices,
  production days and the spine width for an item specification. It needs a
  Mixam account approved for API use, and a JWT from `GET /api/user/token`
  (Basic auth). Orders need the PDFs at public URLs, plus billing and delivery
  addresses. Quotes inside Typst Studio are worth doing once there's an
  account to test with (credentials in the Keychain). Ordering stays on
  Mixam's site.
- **Verified in the app** (self-test `print`):
  - A 5.5×8.5in novel produced a 414 × 630 pt interior with TrimBox
    9 9 405 621, with the short-book and odd-page warnings.
  - "Design a cover" from the check opened the cover dialog.
  - After four chapters were added, the spine mismatch was caught, and Update
    cover from book fixed it (11.2725in wrap).
  - An exact 16.3mm spine gave an 11.892in wrap.
  - A picture book had no edge warning.
  - `open_url` refused another host.

### Helper processes, revised

- **Leak found (October 2026):** quitting while OpenCode was still starting
  left it running. `agent_start` holds the agent lock for the whole start-up
  (up to 30 s), the exit handler's `try_lock` failed, and the registry file was
  deleted anyway, so the next launch couldn't reap it either. Self-tests that
  end by reopening a book hit this every time: 31 orphaned servers in a day.
  At exit, `children::kill_all()` now also stops everything in the instance's
  registry, without any lock. Each PID's command line is checked first, then
  SIGTERM, with SIGKILL after 300 ms. A test checks it stops a matching child
  and leaves a non-matching one alone.

The child-process registry is now per app instance (`children-<pid>.json`).
The first version used one file, so a second instance (e.g. a self-test next
to the user's window) would have terminated the first instance's OpenCode.
Files of instances that are still running are left alone. `tauri dev` restarts
the app with SIGKILL on Rust changes, so the next start reaps the old helpers.

### Open questions

- Release-build numbers, and real keyboard input (the self-test types through
  Monaco, not OS key events; the status bar HUD measures real keys).
- Cold start to editable workspace (§6 budget 1.5 s): boot reaches an open
  workspace at ~0.4–0.7 s after navigation in dev; app launch → navigation not yet measured.
- Monaco bundle is 4.8 MB (all languages). Trim to the editor core + JSON if
  cold start needs it.
- Upstream reports for typst.ts: foreignObject canvas previews in WebKit, and
  idle-callback dependency of the update loop.
- Whether the cursor indicator (`changeCursorPosition`) comes back. Tinymist
  currently says it's "temporarily disabled".

## Tooling on this machine (2026-10-16)

- Installed with Homebrew: `rust` 1.99, `tinymist` 0.15.8. Discovery order for
  tinymist: `$TINYMIST_PATH` → PATH (+ Homebrew dirs) → VS Code extension.
- OpenCode 2.0.20 with a LiteLLM provider already configured in `~/.config/opencode`.
