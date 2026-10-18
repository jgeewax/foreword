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
- **Typing doesn't flash the preview.** An author saw several ripples per
  pause while typing, none where they were typing.
  - **Causes:** every keystroke moved the cursor, so every pause ran the
    candidate ladder. Each candidate got 80 ms to answer, and while the
    preview recompiles answers come late. Later candidates (other words,
    lines above) then jumped too, each with a ripple.
  - **Now:** a move that came with an edit (Monaco's cursor reason isn't
    `Explicit`) waits 400 ms and tries only the cursor's own position. The
    preview's ripple is hidden for that jump: a class on the preview's
    `<html>` for 1.5 s, and `visibility: hidden`, so Tinymist's animation
    still ends and removes it.
  - **Clicks and arrow keys** keep one visible ripple. They end any quiet
    period, and while a compile is running each candidate gets 400 ms
    (otherwise 120 ms) before the next is tried.
  - Verified (self-test `typingsync`): two typing bursts gave 2 jumps with 0
    visible ripples (the old code: 2 visible); an arrow key gave 1 jump with 1
    visible ripple.

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

### Zoom applies to everything

- **Every surface follows the zoom,** in both directions: the title bar, pane
  headers and tabs, the sidebar's icons, the status bar, the chat's controls
  row, popovers and every dialog (Settings, ⌘P, New Book…).
- **This replaced "zoom is for the writing; the chrome stays put":** below
  100 % the chrome used to be zoomed back up to 100 % with CSS `zoom: 1/zoom`
  (`--chrome-scale`), and What changed kept its size on screen. The author
  zoomed with Settings open and nothing in it changed. Every surface has to
  follow the zoom.
- The page zoom is now the only zoom:
  - No CSS `zoom` anywhere. It's what breaks Monaco's hit-testing, so the
    side-by-side diff is safe again too.
  - No sizes that undo the zoom. A popover or dialog sized in `vh`/`vw` is
    still the same share of the window, because the page zoom shrinks or
    grows the CSS viewport.
- What changed's passages are Typst source, so they use the editor's
  monospace, not a book serif.
- **What doesn't zoom:** the preview, a separate webview whose pages always fit
  the pane's width. Native menus, tooltips and file dialogs are drawn by macOS.
- Close buttons use the line-icon ×, not the text character, which looked
  thin and off-centre:
  - Settings;
  - tabs;
  - message attachments;
  - allowed-command chips.
- Verified (self-test `chrome`):
  - The window, the model list, Settings, ⌘P, New Book and Typst basics were
    opened at 67 %, 100 % and 150 %.
  - Each part's height on screen is the zoom times its height at 100 %: the
    title bar's icons and search box, the tabs, the file rows, the editor's
    lines, the status bar, Send and Settings' header, close button and
    sections.
  - No element has CSS `zoom`, and the model list still opens above its
    button, inside the window.
- **WebKit's text floor:** zoomed out, WebKit keeps text that is 9 px or more
  at 9 pt or more on screen, as Safari does. At 67 % the 12.5 px UI text is
  held at 9 pt instead of 8.4 pt, so a row of it is up to about 10 % taller
  than the zoom alone gives. Fixed sizes (icons, rows, the editor's lines)
  scale exactly.

### Title-bar inset (macOS 26)

Windows get a full-size content view: the main webview spans the 32 pt title
bar and WebKit insets the page (`safeAreaInsets.top = 32`; page viewport 968 pt
in a 1000 pt webview). The preview webview, positioned in window coordinates,
was therefore 32 pt too high (covering the preview header, leaving a gap at the
bottom). It now adds the main webview's native safe-area inset, re-read on
resize (full screen removes the title bar). Verified natively: preview top =
pane top (off by 0 pt). Since the title bar became the page's own (next
section), the page starts at the window's top and the offset is measured.

### The title bar, as VS Code's

- **One bar, as in VS Code on macOS.** The window has no native title bar
  (`TitleBarStyle::Overlay`; the title is hidden but still set, for the Window
  menu and Mission Control). The page draws its own bar and macOS puts the
  close, minimise and zoom buttons in it.
  - In the middle, the book's name in a search box. It opens Go to File (⌘P),
    like VS Code's command centre.
  - At the right, the pane toggles (sidebar, preview, assistant), drawn like
    VS Code's layout icons: the window with the pane's column outlined, filled
    in while the pane shows.
- **What the old toolbar had went where VS Code keeps it:**
  - "Typst Studio" and "entry main.typ": gone. The Files view already marks
    the main file.
  - Review: the activity bar's Review icon, which has the count.
  - Export PDF…: the preview's header, beside Open PDF (and Book → Export PDF…,
    ⇧⌘E).
  - Open…: File → Open Book… (⌘O) and the welcome screen.
  - Typst basics (?) and Settings: the bottom of the activity bar, where VS
    Code has Manage.
- **It moves the window:** the bar is a `data-tauri-drag-region="deep"`, so
  anywhere but its buttons drags, and a double-click zooms the window
  (`core:window:allow-start-dragging`).
- **Its size is in points.** macOS draws the window's buttons at one size
  whatever the page zoom. So the bar is as tall as macOS's own title bar (32 pt
  on macOS 26, the webview's safe-area inset) and leaves the buttons' room
  (their frame from `native_geometry`, plus 10 pt) at every zoom
  (`--titlebar-height`, `--titlebar-buttons`, set by `studio.applyTitleBar`).
  This is the one exception to "Zoom applies to everything":
  - What's in the bar zooms like the rest. At 150 % it needs more than 32 pt,
    so the bar grows.
  - In full screen the buttons leave with the title bar, and so does their
    room.
- **The welcome screen has the bar too,** empty. Otherwise the buttons would
  sit on the page and there'd be nothing to drag the window by.
- **The page starts at the window's top now.** WebKit insets the page below an
  opaque title bar (above) but not below a transparent one. So the preview's
  offset is measured: the webview's height less the page viewport's
  (`innerHeight` × zoom). The safe-area inset is still 32 pt and would put the
  preview 32 pt too low.
- Verified in the app (macOS 26, 75 % zoom):
  - The buttons are at 9–69 × 9–23 pt, centred in the 32 pt bar.
  - The preview is within 0.5 pt of its pane.
  - Self-test `chrome` passes, with the title bar's icons and search box
    following the zoom. The bar is 32 pt at 67 % and 100 %, 37.5 pt at 150 %.

### The activity bar stays when the sidebar closes

- The sidebar's view icons (Files, History, Code, To do, Review) sit on the
  window's left edge, outside the collapsible sidebar, as in VS Code.
  - Clicking the open view's icon hides the sidebar.
  - Clicking any icon while it's hidden opens it at that view.
  - No icon is marked while the sidebar is hidden.
- Before, the bar was inside the sidebar, so hiding the sidebar (⌘B, the
  toolbar) hid the icons too, and clicking the open view did nothing.
- It looks like VS Code's: 22 pt icons in a 44 pt bar, dimmed until hovered
  or open, and an accent stripe on the open view's edge rather than a filled
  button. The icons follow VS Code's codicons: stacked pages for Files, a
  clock with a back arrow for History, two speech bubbles for Review, a ticked
  list for To do, `< >` for Code.
- Verified (self-test `activity`): Files closes it (width 0, the bar stays);
  Files opens it again; Review switches views; while hidden, Files opens it on
  Files. The `chrome` group's pane headers still line up.

### Source Control: the book's own Git repository

- **The need:** existing books already have Git repositories. History
  deliberately never touches them (it keeps its own snapshots), so there was
  no way to commit from the app.
- **The Source Control view** (activity bar: branches, with a badge of
  uncommitted files; View → Source Control) appears when the book is in a
  repository. It's laid out as VS Code's, in two foldable sections with a
  draggable divider (folds and divider remembered):
  - **The repository** (its folder's name, the branch on the right):
    - a message box (`Message (⌘⏎ to commit on "main")`), kept while the
      view is closed. The placeholder stays on one line, cut short with …;
      only what's written makes the box taller.
    - a full-width **✓ Commit** button, with a ⌄ for **Commit & Push**.
      As in VS Code, Commit takes what's staged. With nothing staged, it
      takes every change in the book's folder, new files too, without asking
      as VS Code does. Without a message it points at the box instead of
      failing.
    - **Staged Changes** (when anything is staged), then **Changes**, each
      with a count badge and one row per file: a file-type icon, the name,
      the folder dimmed, and VS Code's coloured status letter on the right
      (M, A, D, R, U untracked, ! conflict). A file staged and then changed
      again is in both groups. The chapter heading is in the tooltip.
    - On hover, as VS Code's inline actions: Open File, and **+** Stage
      Changes (**−** Unstage Changes when staged). Group rows have What
      changed for them all, and Stage All or Unstage All.
    - What changed shows the same diffs as VS Code: a staged file from the
      last commit to what's staged, and a file under Changes from what's
      staged to the file as it is.
  - **Graph:** the commits that touched the book, on this branch and its
    remote, as dots on coloured lanes. Merges and forks are drawn, and the
    checked-out commit is a ring. Labels: the current branch (with a cloud
    when its remote is at the same commit), other branches, the remote, and
    tags. Rows with labels leave the author out, as VS Code does. Pull (↓
    behind) and Push (↑ ahead) are in its title. 50 commits, then Load
    More.
  - The title bar has Refresh and ⋯ (Pull, Push, What Changed, Copy Branch
    Name).
  Files and commits open **What changed** in words, the same view as History
  (shared `Passage`), with formulas drawn. A passage of uncommitted changes
  opens the file there.
- **The Graph's log** is `git log --topo-order --parents HEAD @{upstream} --
  .`. With `--parents`, each commit's parents are the previous commits that
  touched the book, so the graph stays connected even when commits outside
  the book are left out. `--decorate=full` tells local branches from remote
  ones, even with a `/` in the name. The lanes are laid out in
  `src/lib/git-graph.ts` (unit-tested). Rows are exactly 22px, so each row's
  lines meet the next row's.
- **Refreshes overlap** (files changing, a push finishing), so the newest one
  wins; an older one that finishes later is dropped. Otherwise a stale log
  could put the remote's label on the wrong commit.
- **Scoped and safe** (`src-tauri/src/git.rs`):
  - **The author's Git:** it uses their config, hooks, signing and
    credentials, unlike History.
  - **Only the book's folder:** everything is limited to it (`-- .`).
    With nothing staged, `commit -- .` leaves anything staged elsewhere in a
    larger repository alone. A commit of what's staged commits the index, so
    if anything outside the book is staged too, it refuses and names the
    file rather than taking it.
  - **Stage and unstage** are `git add --all` and `git restore --staged`
    (`git rm --cached` before the first commit, which has no HEAD). Paths
    are literal (`--literal-pathspecs`), so a name can't act as a pattern.
  - **Pull** is `--ff-only`, never a merge or rebase. **Push** sets the
    upstream to origin on a branch's first push.
  - **Nothing destructive:** no discard, reset, clean or checkout of files.
    Unstaging keeps the changes in the files.
  - **No hanging:** Git never waits on a terminal (`GIT_TERMINAL_PROMPT=0`,
    SSH in batch mode); timeouts are 20 s to read and 120 s to write.
  - **Checked arguments:** commit ids must be hex (or HEAD, `^`, or `:0`
    for what's staged), and paths must stay in the book, after `--`.
- **Native menus** drop a lone `&` (it marks a Windows-style shortcut
  letter), so context menus double it: "Commit & Push" shows as written.
- **When it refreshes:** when the book opens, 0.8 s after files change on
  disk (saves, the assistant), and when the window comes back to the front
  (commits made in a terminal).
- **The assistant** is told not to commit, push, pull, stash or switch
  branches unless asked.
- Verified:
  - Rust tests: status parsing (ahead/behind, renames, conflicts, a book in a
    subfolder of the repository), argument checks, and a real commit that
    takes only the book's folder. Staging: a file staged and then changed
    again is in both groups; staging and unstaging work before the first
    commit; a commit takes only what's staged, or everything when nothing is;
    and something staged outside the book is refused, then left staged.
  - Self-test `git`, on a scratch repository with a local bare remote:
    - an edited and a new chapter showed as M and U with a badge of 2;
    - What changed listed both, with the preview hidden;
    - the message box was 26px empty (the placeholder on one line) and with
      one line, and 60px with three;
    - the hover icons were centred in their 22px buttons (offset 0, 0);
    - the row's + staged the edited chapter under Staged Changes, its What
      changed showed the one word added, and − took it back out;
    - Commit with it staged took just that chapter ("Edit chapter one");
      Commit again, with nothing staged, took the new one;
    - Push emptied "ahead" and the remote has the commit; Pull said "Up to
      date";
    - the Graph (on a history with a merged branch and a tag) had 11 rows,
      22px each and as tall as their lane cells, on 2 lanes. `main` was
      marked as the same as `origin/main`, with `figures` and `v0.1` labelled;
    - folding the Graph kept a half-written message, and unfolding brought
      the 11 rows back;
    - the commit's What changed listed both files.

### Several windows, one book each (like VS Code)

- **File → New Window** (⌥⇧⌘N) opens another window on the welcome screen.
  Each window has its own book, with its own:
  - folder watcher;
  - Tinymist and preview;
  - OpenCode;
  - History lock.
  It's one process, so there's one Dock icon, and Window ▸ lists the windows
  by book: each window's title is its book's name.
- **How (Rust):**
  - `AppState` became a map from window label ("main", "win-2", …) to a
    `WindowState` holding what used to be global.
  - Commands take a `Win` argument, built by Tauri from the webview that
    called (`CommandArg`), so their bodies didn't change.
  - Each window's preview is the child webview `<window>-preview`. Its
    reports go back to its own window's app webview.
  - The capabilities match `main`/`win-*` and `*-preview`.
  - Closing a window stops its helpers and drops its state.
- **The menu bar** is the app's: its items go to the window in front.
- **The page** listens on its own webview (`getCurrentWebview().listen`):
  `listen` from the event module also hears events sent to other windows.
- **One window per book.** Opening a book that's open elsewhere brings that
  window forward and says so, before this window lets go of its own book.
  `workspace_open` refuses it too.
- **A new window starts fresh:** the environment (a book to open, the
  self-test) is for the first window only, and it doesn't reopen the last
  book, which is open in the first window.
- Verified (self-test `windows`):
  - A new window started without a book, titled "Typst Studio".
  - It opened another book and was titled "book-in-src".
  - Asked to open the first window's book, it was refused and kept its own;
    the first window kept its book.
  - Closing it removed its state and freed its book.
  - The regression groups (preview placement, jumps, preview selections,
    menus, layout…) pass with the per-window labels.

### Long books: no need for a one-chapter preview (yet)

- **Question (from the author):** as books get long, will the preview need to
  show one chapter at a time?
- **Measured again (2026-10-17)** with the current app: the stress book (60
  chapters, 491 pages, 137,534 words), self-test `typing`, WKWebView dev
  build, Apple Silicon:
  - edit → preview p50/p95: 113 / 120 ms isolated, 40 / 80 ms while typing
    at 60 ms a key (the budget is 150 / 400 ms);
  - edit → editor paint p95: 18 ms.
- That's because Tinymist recompiles incrementally and the preview renders
  only the pages in view (partial rendering), in its own webview, apart from
  the editor. Page count barely matters to typing.
- **So not for speed.** A chapter on its own also can't be compiled in
  general: it relies on the main file's set and show rules, imports and
  counters (chapter numbers, figure numbers, references to other chapters).
- What a writer might still want is focus, or a PDF of one chapter for an
  editor. Both are in IDEAS.md (a template-level opt-in like
  `sys.inputs.chapter`, so the book decides what "one chapter" means).

### Typst drawn outside the editor (chat, comments, What changed)

- **Formulas are drawn as they would print**, not shown as source:
  - in the assistant's replies: inline `$…$`, and a "Renders as" box under
    each ```` ```typst ```` block, whose source stays (it may be markup to
    copy);
  - in review comments, now rendered as Markdown;
  - in What changed: the formulas a passage changed, old → new, on red and
    green.
- **How:** a `typst_render` command compiles each snippet with Tinymist
  (`tinymist compile … page-{0p}.svg`, about 30 ms).
  - Each snippet compiles in a fresh temp folder that is also its Typst root,
    so it can't read the book or anything else (a test reads /etc/hosts and
    fails).
  - Limits: 20 KB per snippet, 40 per call, a 15 s timeout that kills the
    process group.
  - The preamble sets an auto-sized page, no fill, and the UI's text colour
    (`#rrggbb` only).
- **The page:**
  - It batches requests made in the same moment, caches results by colour,
    size and source, and redraws when light/dark mode changes.
  - It shows each SVG as an `<img>` with a data: URL, so nothing in it can
    run. The height is in em (×1.2: Computer Modern reads small beside the UI
    font).
  - Until a snippet is ready, or if it doesn't compile (LaTeX, a book-only
    function), the source shows as before.
- Every session's instructions ask for Typst math in replies (never LaTeX),
  and for Typst markup in ```` ```typst ```` blocks.
- Verified:
  - Self-test `mathchat` (deepseek-v4-flash): a reply with 6 inline formulas
    (including a `mat(…)`) and a Typst block all drawn, none left as source;
    a review comment's `$det(A - lambda I) = 0$` drawn.
  - Self-test `mathdiff`: changing `det(A - lambda I)` to `det(lambda I - A)`
    showed both formulas drawn in What changed.

### A book in a subfolder (`src/`)

- **The problem:** some books live in a subfolder of a larger folder
  (`src/main.typ` beside a README and notes).
  - Opened at the top, the app picked "the first .typ file" as the main file
    when there was no top-level main.typ.
  - Tinymist used the opened folder as the Typst root, so `/figures/x.png`
    pointed outside `src/`. `typst compile src/main.typ` uses the main file's
    folder, so a book that builds on the command line failed here.
- **The Typst root** is now `root` in .typst-studio.json (e.g. `"src"`;
  `"."` for the folder opened). By default it's the main file's folder, as
  `typst compile` does. That changes nothing for a main file at the top.
  It applies to:
  - Tinymist (`rootPath`) for the book's preview and export (the cover keeps
    the opened folder: its files live in .typst-studio/);
  - the Makefile's `--root`;
  - reference handling (chapter names from `#include`, rename and delete
    updating references, root-absolute paths kept root-absolute).
- **Finding the main file:**
  - the configured entry;
  - else `<root>/main.typ`;
  - else the shallowest `main.typ`;
  - else the shallowest .typ file.
- **Settings → This book** has a "Book folder (Typst root)" field. It's
  validated: inside the project, and containing the main file.
- The export folder is relative to the folder opened (an absolute
  `outputPath` for Tinymist), whatever the root.
- Verified (self-test `subroot`):
  - A folder with README.md, notes/aaa-notes.typ and src/ found
    `src/main.typ`, used `src` as the root, compiled with 0 errors (including
    `image("/figures/dot.svg")`) and named the chapter "One".
  - With `"root": "."` the same book has 1 error: the image isn't found.
  - The `export` group still builds into `dist/`.

### Conversations in the sidebar

- **Before:** the only list of tasks was the small menu under "New task ▾" in
  the assistant's header.
- **Now:** the sidebar has a **Conversations** view (a speech bubble in the
  activity bar; View → Conversations). It groups every task:
  - at work or waiting for you;
  - open;
  - done (resolved).
- Each group shows a count. Each row shows its state (working, has a
  question, asks permission, new reply, stopped) and when it last changed.
- A click opens the conversation in the assistant pane. Right-click: Open,
  Mark Done, or Open Again. Marking another task done records a named
  version in History, as finishing the shown one does.
- The activity bar's badge counts conversations waiting for you.
- The header menu and the view share their grouping and rows
  (`useTaskGroups`, `TaskRow`).
- Verified (self-test `conversations`): the view lists all 60 of the scratch
  book's tasks under Open and Done, and opens from the activity bar and the
  View menu.

### The assistant hears about the author's edits to its text

- **Every change is tracked.** History records:
  - the author's edits 10 s after the last save;
  - everything right before each assistant turn (unsaved editor changes are
    saved first, so the assistant reads what the author sees);
  - the assistant's changes right after its turn, as their own version.
- **What was missing:** the assistant wasn't told. Say it wrote A and the
  author changed it to A′; asked to look again, it worked from its memory of
  A, and could undo the author's change.
- **Now:** each conversation remembers the version right after its last turn
  and the versions its turns made. Sending the next message:
  - diffs that version against the files now. Between turns only the author
    changes them, so the differences are theirs;
  - keeps the differences that touch lines the assistant wrote in this
    conversation (its versions' changes, mapped onto that version);
  - appends them as `<author-edit>` blocks: "you wrote … / the author changed
    it to …", saying to build on the author's version and not put back what
    they removed.
- Each passage runs between unchanged lines, so it reads whole. Removed and
  inserted lines count too. At most 6 passages of 40 lines go with a message.
- The message shows a chip per passage ("Your edit: chapters/ch1.typ:3"). A
  conversation loaded again shows the chips, without the block.
- **Limits:**
  - In memory: after a restart, edits count from the next turn on.
  - Another conversation's changes to the same file between turns would
    count as the author's.
- Verified (self-test `authoredits`, deepseek-v4-flash):
  - The assistant added "A vector is an arrow with a length and a
    direction."; the author changed "an arrow" to "a quantity".
  - Asked, without reading files, what the sentence says now, it quoted "A
    vector is a quantity with a length and a direction." and added "I'll keep
    your version".

### Tagged comments look like notes

- `// TODO:`, `// NOTE:`, `// FIXME`, `// IDEA:`, `// QUESTION:` (also
  `XXX`, `HACK`, `WARNING`) in .typ files:
  - the tag becomes a bold label on a soft background in its colour:
    amber to do, red fix, blue note, green idea, purple question;
  - the `//` fades;
  - the comment reads upright in the same hue, and the line is faintly
    tinted;
  - TODO and FIXME also mark the scrollbar.
- Only colours, weight and backgrounds change, never widths or padding, so
  Monaco's character positions stay true and the cursor moves through the
  real text. Measured: the end of a tagged comment is drawn 0.3 px from where
  Monaco puts it.
- Tags must be in capitals after a `//` that starts the line or follows a
  space, so `https://…` and "// a todo list" aren't caught.
- Verified (self-test `ctags`): five tags labelled in their colours, five
  lines tinted, an ordinary comment left alone.

### One sentence per line

- Every session's instructions ask for one sentence per line in .typ files
  (a blank line between paragraphs) in whatever the assistant writes or
  rewrites. Typst joins a paragraph's lines, so the book looks the same, and
  edits, What changed, comments and the assistant's marks then work sentence
  by sentence. Paragraphs it isn't changing aren't rewrapped.
- The first wording ("write one sentence per line") lost to "follow the
  project's conventions": the model matched the chapter's wrapped paragraphs.
  Saying it applies "even where the file's existing paragraphs are wrapped
  differently" fixed it.
- The style guide template's Formatting section suggests it too.
- Verified (self-test `sentences`, deepseek-v4-flash): three runs, each a
  three- or four-sentence paragraph with one sentence per line. The weaker
  wording gave one long line.

### Context menus

- Native macOS menus through Tauri's menu API (`core:menu:default` allows
  `popup`), not HTML imitations. Each holds only what's about the thing under
  the pointer; book- and app-level commands are in the menu bar (see "The menu
  bar, rethought"):
  - **Editor:** what's under the pointer first (Fix This Error, What the
    Assistant Changed Here); with a selection, Ask the Assistant About This,
    Explain This, Three Versions to Pick From, Add Comment. Then Cut, Copy,
    Paste, and Show in Preview.
  - **Tabs:** Close, Close Others, Close Tabs to the Right, Close Saved, Close
    All; History of This File, Reveal in Finder, Copy Path.
  - **Files:** Open; New Chapter (in chapters), New File, New Folder; Rename,
    Duplicate, Move to Trash; Use as Main File, History of This File; Reveal
    in Finder, Copy Path, Copy Relative Path. The empty area: New Chapter,
    New File, New Folder, Refresh, Reveal Book Folder.
  - **History rows:** What Changed, Compare with Now, Undo These Changes,
    Restore This Version.
  - **Chat items:** Copy, Copy Message.
  - **Text fields:** the usual editing commands.
  - **Preview:** Copy, Show the Text Here, Export PDF, Restart Preview (on
    the cover: Show the Book, Update Cover from Book, Export Cover).
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

### The menu bar, rethought

- **Before:** the default macOS menus, with everything the app added pushed
  into File: new book, chapter and file; cover, export, open PDF and print;
  then the tab commands. Meanwhile Open, Go to File, Find, the panes, History,
  Review and the assistant were missing. The right-click menus repeated book
  commands (cover, Makefile, runnable code, print) and spelled chords into
  labels ("Close All  (⌘K W)").
- **Now:** one menu per subject, built in full in `src-tauri/src/menu.rs`
  rather than patched into the default:
  - **Typst Studio:** About, Settings… (⌘,), Services, Hide, Quit (named
    "Typst Studio", not the crate's name).
  - **File:**
    - New Book / Chapter / File;
    - Open Book… (⌘O), Go to File… (⌘P);
    - Save (⌘S), Save All (⌥⌘S);
    - Close Tab (⌘W), Reopen Closed Tab, Close Window (⇧⌘W).
  - **Edit:** Undo…Select All; Find (⌘F), Find and Replace (⌥⌘F); Add
    Comment (⌥⌘M).
  - **View:**
    - Command Palette… (⇧⌘P; see "Command palette");
    - Toggle Sidebar (⌘B), Preview (⌥⌘P), Assistant (⌥⌘B);
    - Files, Review, History;
    - Show in Preview;
    - zoom; Full Screen.
  - **Book:**
    - Export PDF (⇧⌘E), Open Exported PDF (⌥⌘E), Print with Mixam;
    - Design Cover, Writing Style Guide, Name This Version;
    - Runnable Code Examples, Add a Makefile;
    - Book Settings.
  - **Assistant:** New Task, Task Done; Ask About Selection (⌘I), Fix
    Review Comments, Stop; Permissions.
  - **Window:** Minimize, Zoom, previous and next tab. **Help:** Typst
    Basics. These two use Tauri's window and help ids, so macOS treats them
    as its own (window list, Help search).
- Items forward their id; `studio.menuCommands` maps each id to what it does.
  Without a book open, items that need one do nothing (a static menu bar
  can't grey them out).
- **Shortcuts the page also handles** (⌘O, ⌘P, ⌘S, ⌘B, ⌘I, ⌘F in the
  editor) are on the items too, so they're discoverable. The page calls
  preventDefault on a press, which stops the menu's key equivalent, so a
  press isn't applied twice. With the preview focused, the menu acts.
- **Select All** (⌘A) is the app's item, not the stock one. In the page,
  AppKit's `selectAll:` selects the focused field, and the editor's is
  Monaco's hidden one: Edit → Select All in the editor selected nothing you
  could see. With no field focused (after a click on the path under the tabs,
  say), ⌘A fell through to it and selected the whole page, line numbers and
  labels too. While the page has the keyboard the item goes to the page
  (`select-all`, `editor/select-all.ts`): the editor's text, a field's own,
  else the text last clicked in (the conversation, Typst basics) or the
  editor in front. Anywhere else (the preview, a dialog's text field) it's
  AppKit's. ⌘A in the editor stays Monaco's. A click on a file's tab no
  longer takes back the keyboard the tab gives the editor.
- The window is one grid column, `minmax(0, 1fr)`: a whole chapter selected
  showed in the message box's card as one long line, which widened the column
  past the window and pushed the preview and the assistant off screen.
- Verified (self-test `selectall`; once also with real key presses, clicks and
  the menu item, sent as AppKit events): each case above, the preview's own
  Select All, and the layout with a whole chapter selected.
- Verified (self-test `menubar`):
  - Every app item has a handler and every handler an item; the menu bar is
    read back from the running app (`menu_outline`, self-test only).
  - Go to File, Book Settings (opens on This book), Find, Toggle Preview
    (hides, then shows), Review, and Name This Version (asks, cancelled)
    work.
  - Self-test `menus` checks the trimmed context menus.

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
- **Figures in one style:** asking for "consistency" in a prompt does little,
  so the book gets one file that holds the look, and every figure uses it.
  - **The file:** `figures/figure-style.typ` has:
    - a palette: ink, accent, muted, soft;
    - the line width and the label size;
    - a wrapper per package that applies them: `figure-canvas` (CeTZ
      `set-style`), `figure-diagram` (fletcher's node and edge strokes and
      fills) and `figure-chart` (Lilaq's colour cycle).
  - **How the assistant uses it:**
    - It creates the file from a fixed starting point
      (`src/services/agent/figure-style.typ`, in the instructions whole) the
      first time it makes a figure.
    - Chapters import it with `: *`. Listing names was tried: the model left
      out `node` and the chapter failed to compile.
    - Figures don't set colours, fonts or widths of their own.
    - It looks at the existing figures first and matches their scale, arrows
      and captions.
  - Every session's instructions also say so, for figures made in Write mode.
  - The style guide template gains a Figures section.
  - `npm run check-templates` compiles the starting file with a figure from
    each wrapper, and fails on any warning. Vitest checks it uses the pinned
    versions and defines every name the instructions promise.
  - Verified (self-test `figures`, deepseek-v4-flash):
    - A flowchart: the model created the file and imported it. It used
      `figure-diagram` and set no colours or widths of its own.
    - Then a CeTZ parallelogram: it reused the file unchanged and used
      `figure-canvas` and the palette (accent only on u + v).
    - No compile errors.

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

- **History explains itself** (an author asked where it's kept, whether it's
  Git, and whether they could go back and see the changes). The panel's line
  ends with "How does this work?", which opens three short paragraphs:
  - **Where:** the app's own Git repository for the book, outside the book
    folder, leaving the author's Git alone.
  - **Going back:** What changed line by line, ◀ Older / Newer ▶, Compare
    with Now, Undo, Restore. Restoring adds a version, so you can go forward
    again.
  - **Named versions.**
- **The panel also has:**
  - **Show in Finder:** `history_reveal` works the path out in Rust, so no
    path comes from the page.
  - **Copy Git command:** `git --git-dir=… --work-tree=… log -p`, quoted for
    the shell, since "Application Support" has a space.
- Verified (self-test `historyabout`):
  - The repo is outside the book and the explanation opens and closes.
  - The copied form of the command lists versions with their changes.

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
  - **The list** (the activity bar's Review icon, with a count) groups To
    check, Open and Resolved.
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

- **Automatic, like Claude Code:** the editor's current selection appears
  above the message box as a quote card. It's sent with every message while
  selected.
- **What the card shows** (it replaced a dashed chip of path:line, which looked
  odd and showed nothing of the text):
  - where the text is from, by chapter heading ("Eigenvalues · lines 13–15";
    the path is in the tooltip);
  - the start of the text on one line.
- **What it does:**
  - clicking the text shows all of it;
  - clicking the place selects it in the editor again;
  - × leaves it out of the next message, keyed on place and text, so a
    different selection comes back;
  - **Keep** pins it, so it stays after the selection moves on.
- ⌘I pins a selection directly. Pinned passages use the same card, with a
  grey bar and a pin instead of the blue bar.
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
  4. selects that range in the editor, labelled "from the preview".
- Verified in-app:
  - The card, its full text, dismissing and its return; Keep surviving a new
    selection; the place selecting the range again; removing a kept one.
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
  math, what red squiggles mean, and shortcuts. It opens in its own tab beside
  the files (see "Tabs, as VS Code's"), from the activity bar's ? icon or
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

- **Export PDF…** (⇧⌘E, the preview's header, the Book menu) opens the macOS Save
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
- **Open Exported PDF** (⌥⌘E; Book menu, the preview's header)
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

### Tabs, as VS Code's

- **The pointer is a hand over a tab** and its ×. Everywhere else it stays
  the arrow, as in Mac apps. Verified (self-test `tabs`): both are
  `cursor: pointer`.
- **Each tab has its file type's icon** before the name, in VS Code's (Seti)
  colours: Typst a teal t, PDF red, Markdown blue, BibTeX an orange @, JSON
  yellow braces, images purple, others a plain page. It's the same `FileIcon`
  as Source Control's rows. Verified (self-test `tabs`): four chapters' tabs
  each start with the Typst icon.
- **Tabs that aren't files** sit among the files' tabs, as VS Code's
  Settings or Welcome do. They close, reorder and cycle like the rest (×,
  ⌘W, ⌃⇥, the tab menu), and they aren't remembered for next time.
  - Their keys share the tab list with the files' paths (`view:…`,
    `src/app/view-tabs.ts`). `viewTab` says which is in front. `active` stays
    the file the editor holds, so everything that reads it as "the current
    file" still does.
  - The editor is hidden, not unmounted, behind one. Coming back, the file is
    where it was (switching tabs no longer re-applies an older saved position
    when the file didn't change).
- **Typst basics is a tab** (help icon), no longer drawn over the assistant
  in the right-hand pane, so the chat stays usable beside it. In the tab it's
  a page in one readable column with its title. The ? icon brings it to the
  front, or closes it when it's in front.
  - **Insert** goes into the file behind the tab ("Insert at the cursor in
    ch1-vectors.typ"), which comes to the front so the author sees it land.
  - Verified (self-test `guide`): opening put the guide in the editor pane
    (not the assistant's), with the editor hidden. Insert added the footnote
    at the cursor and brought the chapter to the front; a block example got
    its own paragraph, and undo restored the text. Going to the guide and
    back kept the cursor and scroll. ⌃⇥ went on to the first tab, ⌘W and the
    × closed it, and only the three files were saved as open tabs. The tab
    shortcuts (self-test `tabs`) work as before.

### What changed, in tabs: side by side or inline (as VS Code's diffs)

- **History's and Source Control's diffs are tabs now, not dialogs.** That
  covers what a version changed (or everything since it), one file of a
  version, uncommitted changes and a commit. Each sits beside the files with
  its own icon and name, so the preview and the chat stay usable beside it.
  - As in VS Code's preview tab, the next one of a kind takes the same tab
    and comes to the front.
  - Closing the tab clears what it showed. Restoring a version closes it, as
    the dialog did.
  - The buttons that were in the dialog's footer are in a bar at the top of
    the tab: ◀ Older / Newer ▶ (⌥← / ⌥→ while the tab is in front and nothing
    is being typed in), Undo these changes, Restore this version.
- **Each file is Monaco's diff editor** (`DiffEditor`), as in VS Code:
  - side by side when the diff is wider than VS Code's breakpoint (900px),
    inline when it isn't, switching as the pane is resized. In the default
    layout the editor pane is narrower than that, so it's inline until the
    sidebar or the preview is hidden (or the zoom is lowered);
  - unchanged stretches are folded ("20 hidden lines"), wrapped like the
    editor;
  - each is as tall as its content, so a version's files scroll as one page,
    under sticky file headers (file icon, path, +/− words, Open, Restore
    file).
- **Lines or Words** (the bar's switch, remembered): Words is the
  word-by-word view the dialog had ("History: what changed from one version
  to the next"), with formulas drawn and line links. Lines is the default,
  since the diffs were asked for as VS Code shows them. In Words, a file's
  Side by side opens it in its own tab.
- **Clicking a file under a version in History** opens that file's diff (as
  VS Code's Timeline does). "What changed" still opens the whole version.
- **Monaco 0.57 bug, worked around:** going inline turns off wrapping on the
  (hidden) original side. Going side by side again resets only one of the two
  overrides, so long lines on the left ran off the edge. `DiffEditor` resets
  the other one whenever it's side by side.
- **Not done:** a new file's diff starts with a removed empty line, since
  Monaco's original side can't have no lines at all.
- Verified:
  - Self-test `difftabs` (scratch book): an edit to a chapter, then What
    changed, opened a tab ("Diff tab check") in front, with the preview still
    shown. At the default layout (637px) the diff was inline. With the
    sidebar hidden it was 906px, still inline (the diff itself is under
    900px). At 50 % zoom (1370px) it was side by side, both sides wrapped
    (screen capture). It went back to inline after.
  - In `difftabs`, Words showed ", in plain words," added. The file's diff
    opened in a second tab. Going to the file and back worked, and the next
    version took the first tab. ⌘W and the × each closed their tab and
    cleared what it showed.
  - Self-test `changes`: the word-by-word view (Words) in its tab, Older and
    Newer, and Compare with now, as before.
  - Self-test `git` (scratch repository): Not committed yet opened as a tab
    with both files, inline (screen capture). Staging, commits, push and pull
    worked as before.

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

### Slash commands

- Typing `/` at the start of the message box lists the commands. It narrows as
  you type (by name, or by description when no name fits). ↑↓ choose; Tab or
  ⏎ pick; Esc closes the list.
- Commands without an argument run when picked. `/model` and `/permissions`
  wait for theirs.
- Commands act on the app and are never sent to the model. An unknown
  `/word` says so instead of going out as a message.
- **The commands:**
  - /write, /plan, /options, /figures (modes);
  - /new, /done, /compact, /stop, /resume;
  - /model <part of a name> (prefers a recently used match);
  - /permissions ask | edit | readonly;
  - /fix (all open review comments), /export, /pdf, /help.
- Verified (self-test `slash`): the list, ⏎ picking Plan, /model, /permissions,
  an unknown command, /help and /new.

### Go to file (⌘P)

- ⌘P opens a box near the top, as in VS Code. It works from anywhere, the
  editor included, once a book is open.
- **Matching is fuzzy:** the letters you type, in order (`src/lib/fuzzy.ts`).
  - Matches at word starts (after `/`, space, `-`, `_`, `.`, or a lower→upper
    or letter→digit change) score higher, and so do runs of letters.
  - The query appearing whole in the text scores more, more still at a word
    start, and that's what is highlighted.
  - Matches in the file name beat matches in folder names, and shorter paths
    beat longer ones.
- A chapter matches by its heading as well as its file name ("eigenval" →
  *Eigenvalues*, `chapters/ch2-eigenvalues.typ`). The row shows the heading
  first and the path after.
- With nothing typed, it lists the open tabs (most recent first), then the
  other files, with the one you're in last.
- ↑↓ choose, ⏎ opens (a PDF opens in the viewer, like a click in Files), Esc
  or a click outside closes. The preview is hidden while it's open, as for
  every dialog, since it's a native view drawn above the page.
- Verified (self-test `quickopen`): ⌘P from the editor, ranking, a match by
  heading, no matches, ⏎ opening a file, ↓, Esc, and the preview hidden then
  shown again.

### Command palette (⇧⌘P)

- Everything the app does, found by name, as in VS Code. It's the Go to
  File box with ">" typed: ⇧⌘P (or F1, or View → Command Palette…) opens it
  that way; typing ">" in ⌘P switches to commands, and deleting it switches
  back. It works on the welcome screen too, with what needs no book (New
  Book, Open Book, Open Recent, Settings, zoom, Typst Basics, New Window).
- **The commands** (`src/app/commands.ts`, about 120):
  - Every menu bar item, by the same id, doing what the item does
    (self-test `palette` checks none is missing).
  - What's only in a pane or a right-click menu: close other, saved or all
    tabs, copy path, reveal, rename, duplicate, trash, use as main file;
    restart the preview, show the cover or the book, update and export the
    cover; explain the selection, three versions of it, compact, resume, the
    four modes; Source Control's commit, stage and unstage all, pull, push;
    run code examples; clear resolved comments.
  - New ones: Save All, Save Without Formatting, Revert File, Reload Window,
    Close Window, Toggle Full Screen, Turn Format on Save Off/On, Open
    Recent for each recent book, and Settings pages.
  - Editor commands from Monaco: Go to Line (⌃G), toggle comments, fold and
    unfold, trim whitespace, change case, sort, join, delete, copy and move
    lines, select all occurrences, cursors at line ends, expand and shrink
    the selection.
- **Each is filed under its menu** ("File: Save", "Book: Export PDF…"), or
  under its pane when it isn't in one ("Source Control: Push"), and shows
  its shortcut. It's listed only when it applies: Save with a file in
  front, Add Comment with a selection, Stop while the assistant works,
  Source Control with a repository. The shortcuts shown for Monaco's
  commands are checked against Monaco's own.
- **Matching** is stricter than for files (`wordMatch`): the query is the
  start of words in order ("show conv", "exp pdf"), or appears whole
  ("port" finds Export). Letters scattered through a label don't match:
  "save" doesn't find "Restart Preview". Commands also have a few other
  words ("reload" finds Revert File and Restart Preview), which rank below
  a match in the label. Typing nothing lists the recently used commands
  first (8, newest first, kept on this machine), then the rest by name.
- ⏎ runs the command and closes the box; the keyboard goes back to what
  had it (the editor), unless the command took it (Find, a dialog).
- **Revert File** puts back the file as saved. It's one edit, so ⌘Z brings
  the changes back. A reload from disk is now an undo step of its own; it
  could merge with the typing before it.
- **Reload Window** starts the page again with the same book and tabs
  (sessionStorage holds the window's book, so a second window gets its own
  back), and Tinymist and the preview start over. It offers to save
  unsaved changes first, and asks if the assistant is working. It's for
  when the page gets into a bad state, or for a dev build.
- ⌃P isn't Go to File: in the editor it's the line above, as in every Mac
  text field.
- Verified (self-test `palette`, and `reloadwindow` in a second window): ⇧⌘P
  and F1 from the editor, the menu item, ">" in ⌘P and back, ⇧⌘P while
  open; ranking; ⏎ running a command, Monaco's Go to Line, and focus coming
  back; recently used; Add Comment only with a selection; Revert File and
  ⌘Z; Save All writing both files; the welcome screen's list; Reload Window
  reopening the second window's book; Close Window from that window's
  palette.

### Resume after Stop (or a failure)

- When a turn is stopped or fails, the conversation is marked `stopped`. With
  the message box empty, **Send** becomes **Resume** (⏎ too). The "The request
  was interrupted." notice (plain: no advice about models) and the error
  notices have a Resume button. Resuming uses the model
  chosen now, so stop, switch model, resume works.
- **How:** `POST /api/session/{id}/synthetic` admits a synthetic message, the
  kind OpenCode uses for its own reminders, and schedules the agent loop.
  The message tells the model to carry on from where it left off without
  redoing finished steps. No invented message from the author appears in the
  conversation.
- **Verified with a real model** (self-test `resume`): a multi-step read was
  stopped mid-way; the model was switched (deepseek-v4-flash →
  deepseek-v4-pro); Resume carried on and finished, with no new user
  message.

### Starting and finishing tasks from the header

- The assistant's header has a labelled **New task** button (never smaller
  than at 100%) where the small ＋ was. It looks like Done, not blue, and it's
  hidden on a blank conversation, which already is a new task.
- **Done** shows whenever the conversation has a reply and isn't running. It
  doesn't wait for the assistant's "Is this task done?" check, which only comes
  when the reply ends with the marker; a question answered in passing never
  had one. It marks the task done, saves a named version, and starts a new
  task. Its message offers "Open it again".
- **The task menu is for switching.** On a blank conversation the header used
  to say "New task" three times: the menu's label, the blue button, and the
  menu's first action. The menu no longer repeats New task, Mark done or the
  context meter, which the header has. Compact is at its foot, and a blank
  conversation's label is greyed out.
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
  - While it works, the composer stays usable. ⏎ (or the ↑ button) queues;
    ⌥⏎ steers, as does Send now on a queued message. Stop (■) still
    interrupts the turn.
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

### The message box, one quiet box

- Modelled on Claude Code's input: the text and a row of controls share one
  rounded box. The box starts at two lines and grows as you type, up to 40 % of
  the window.
- **The controls are borderless until hovered:**
  - the mode, a tinted pill in its colour;
  - the model, muted, cut short with … when there's no room;
  - permissions, a shield in the preset's colour, with its name only when the
    row is wide enough (a container query), never clipped;
  - `/`, which opens the commands, shown while the box is empty;
  - a round send button (↑). While the assistant works, ■ stops it and ↑
    queues. After a stop, Resume.
- **No help line under the box.** It repeated what the selection card already
  shows, and the keys are in the buttons' tooltips.
- The row zooms with the text above it (see "Zoom applies to everything").

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
  settings icon at the bottom of the activity bar. The last section shown is
  remembered.

### Search in Settings

- **A search box at the top, as VS Code's "Search settings".** It has the
  cursor when Settings opens, and ⌘F goes back to it.
- **Typing shows every page at once,** each under its name, with only what
  matches:
  - a setting matches when its text, with its page's and section's names, has
    every word of the search, in any order;
  - a section's opening help stays with any match in it;
  - the words are marked, and the sidebar shows each page's count (a click
    scrolls to it);
  - nothing matching says so.
- **Esc clears the search,** then closes Settings.
- **It searches what's drawn,** not a list kept beside the pages, so a new
  setting is found without being registered. A page that redraws (a setting
  changed) is filtered again.
- **The marks are boxes behind the words.** WebKit (macOS 26) takes ranges for
  the CSS Custom Highlight API (`CSS.highlights`) but doesn't paint them, or
  paints them on other text.
- Verified (self-test `settings`, and screen captures for the marks):
  - the search box had the cursor when Settings opened;
  - "font" showed Extra font folders, on This book only (1 setting, 3 marks);
  - "enter send" showed the send key, on General;
  - "ALLOW python" showed the commands section's help, on Permissions;
  - "zzzz" said nothing matches;
  - Esc cleared the search and left General showing.

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
- **Redirections that write nothing:**
  - The `*>*` rule caught `ls -la . figures 2>&1; cat style.typ 2>/dev/null`.
    Models write that often, to look around quietly. It asked, and a
    self-test without anyone to answer sat there until it timed out.
  - Glob rules can't tell `2>/dev/null` from `> out.txt 2>&1`, so the app
    decides when the request arrives (`allowedWithoutRedirects`). It removes
    redirections into /dev/null and `n>&m`, then checks each command against
    the session's own rules (the same matching as OpenCode: wildcards, last
    match wins).
  - If they would all be allowed, the app answers "once" for the author and
    nothing is shown.
  - These still ask:
    - anything that still redirects (into a file, or `<`);
    - `$(…)` or backticks;
    - commands that aren't allowed anyway (rm, typst compile, python3 unless
      allowed).
  - Background conversations are judged as read-only, whatever their mode.
  - Verified (self-test `figures`, real model): that exact command ran
    without a question, and the turn went on to write the figure.
- **Reading part of a file with sed:** models often read line ranges with
  `sed -n '205,242p' file`. sed isn't a look command, since it can write (-i,
  `w`), so it asked.
  - The instructions now say to read part of a file with the read tool's
    offset and limit, not sed, head or tail, and to search and list with the
    tools. The shell can stop for approval; the tools never do.
  - The app also answers for `sed -n` when the script is only line addresses
    with `p`, applied to plain file names (`onlyLooks`, which also covers the
    redirections above).
  - `sed -i`, `w`, `e`, substitutions, `$(…)` and redirects into files still
    ask.
  - Verified (self-test `readtools`, Ask first, deepseek-v4-flash): "What do
    lines 12 to 18 say?" used the read tool (lines 12–18), with no question.
    An explicit `sed -n '12,14p' …` ran with no question.

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
  - "Edited “The Harbour” (chapter 3)", "Read a web page (typst.app)".
- While a tool runs, the progress line says the same in the present tense
  ("Reading …"), with a small spinner on the row.
- **Names:** chapters are numbered by the main file's `#include` order
  (commented-out lines skipped) and named by their first `= heading`. The map
  is rebuilt when a book opens, and for the changed files after a save or a
  change on disk.
- The file in a row is a link: reads open with their lines selected, edits
  open the file. The raw output still folds out under the row, and its tooltip
  keeps the tool name and input.
- **Shell commands in words too** (`command-words.ts`), since the book is
  for writers, not engineers. Shell rows used to say "Ran a command" plus the
  command; permission cards said "Allow shell sed -n '205,242p' …?".
  - **Commands described:**
    - reading: `cat`, `head`/`tail` with "the first 40 lines", `sed -n
      '205,242p'` with "lines 205–242";
    - `ls`, `find`, `grep`/`rg` (flags with values skipped), `wc`, `diff`;
    - the Git look commands;
    - `mv` (rename or move), `cp`, `rm`, `mkdir`;
    - `echo … > f` and here-documents (wrote f);
    - scripts ("Ran the Python script plot.py", "Ran some Python code"),
      installs, downloads (by host), and builds ("Tried to build the book").
  - **Anything else:** "Ran the command “pandoc”".
  - **Command lines:** they're split at `&&`, `;` and newlines. In a pipeline
    only the first command counts, since the rest shape its output. `cd` and
    bare `echo` separators are left out. Two steps are joined with "then",
    and more are counted.
  - The command itself folds out under the row.
- **Permission cards** say "The assistant wants to read “What Is a Vector”
  (chapter 1), lines 205–242." with **Allow** (this once) and **Don't allow**.
  The command is under "Show the command".
  - Edits name the chapters; `.env` reads say they can hold passwords; other
    folders and web requests are named.
  - Once answered: "You let the assistant …" / "You didn't let the
    assistant …".
  - While one waits, the progress line says "Waiting for your answer" rather
    than "Running…", and goes back once it's answered.
- Verified (self-test `readtools`, real model):
  - A `sed` row read "Read “Eigenvalues” (chapter 2) · lines 12–14".
  - A `python3 -c` request asked "The assistant wants to run some Python
    code.", with the command folded away and the progress line waiting.
  - Turned down, it said "You didn't let the assistant run some Python code."

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

### Formatting: typstyle through Tinymist, on save

- **Same formatter as VS Code.** Tinymist's `textDocument/formatting` with
  `formatterMode: "typstyle"` and its 120-column default, which is what VS
  Code's Typst extension runs. A book formatted here doesn't change when someone
  opens it there. No formatter of our own and no new dependency.
- **What typstyle does (Tinymist 0.15.8):** spacing in code (`#let f(x, y) = x + y`,
  `(a: 1, b: 2)`), indentation, long calls and tables broken one argument or row
  per line, trailing whitespace, list markers, sorted imports, and `&` / `&&`
  columns lined up in multi-line equations (`f(x) & = 0       && "otherwise"`).
  It leaves runs of spaces in prose, blank lines and line breaks alone (prose
  wrap stays off). It returns null for a syntax error and `[]` when there's
  nothing to change. Errors like an unknown variable don't stop it.
- **Format on save** (Settings ▸ General ▸ Editor, on by default; `formatOnSave`
  in the settings file) applies to the author's own saves: ⌘S, File ▸ Save,
  and "Keep my version". Saves the app makes itself don't format: before the
  assistant runs or an export, Duplicate, and edits from moving files, adding a
  chapter or marking a TODO done. The save waits up to 1.5 s
  (VS Code: 750 ms), then saves the text as it is. typstyle takes ~8 ms on a
  9,600-line file. With a syntax error the file is saved as written.
- **Format Document** (⇧⌥F, Edit menu, the editor's menu) works whether or not
  format on save is on, and says so when a syntax error stops it.
- **A blank line above and below each heading** (asked for by the user; our own
  rule, not typstyle's). It's Markdown's rule (markdownlint MD022, Prettier),
  not Typst's: Typst's tutorial writes the paragraph on the line after
  `= Introduction`, and both render the same. typstyle keeps the blank lines, so
  VS Code doesn't undo them. Headings come from Tinymist's
  `textDocument/documentSymbol` (kind 3, from the syntax tree), asked for after
  typstyle's edits are in the buffer, so an equation line or raw text starting
  with `=` is never taken for one. `//` comments right above a heading stay with
  it (the blank line goes above them), and so does a label on the line below
  (the blank line goes after it; a label attaches across a blank line too,
  checked with `typst compile`). None at the top or end of the file or of a
  block (a line ending in `[`, `(` or `{`, or a line starting with `]`, `)` or
  `}`), and none around a heading that shares its line (`#block[= Title] more`).
  Both steps are one undo step. typstyle on the result changes nothing, so one
  save is enough. The sample book and every template already follow the rule.
- **The cursor stays put.** Tinymist sends one edit from the first change to the
  last, which would move the cursor and scroll position. The edits are cut down
  first, as VS Code does: a line diff, then character diffs within changed lines
  that pair up (`smallEdits`, src/editor/text-edit.ts). They're applied as one
  undo step, so ⌘Z takes off only the formatting. If the text changes while the
  formatter works, its edits are dropped.
- **Diff cost:** this Myers diff keeps O(D²) memory. Reformatting a messy
  9,600-line file at once (7,800 changed lines) took 474 MB. `diff()` now takes
  `maxEdits`, and past it the changed middle becomes one replacement: 2,000
  changed lines (16 MB at most), 500 changes within a line.
- **Code examples survive.** typstyle indents a raw block inside `#run(...)`
  when it splits the call. Typst and `src/code/cells.ts` both remove common
  indentation, so the code and its hash are the same.
- Self-test `format` (edits, scratch book): ⌘S formats the equation and `#let`
  and puts blank lines around two headings (one with a comment above, one
  labelled on the next line), not around an equation line `= y`, without
  touching the rest of the chapter (29 ms save with the outline request; 16 ms
  before). The cursor keeps its place, ⌘Z
  undoes only the formatting, and the setting off saves as typed. Format
  Document took 5 ms. A syntax error shows a toast on Format Document and
  is saved as written. The editor's menu, the Edit menu and Settings all offer it.
- **Not yet:** several book templates aren't typstyle-clean (continuation
  lines in content blocks, `#run(...)` on one line, import order), so a new
  book's first ⌘S tidies those files. Formatting the templates needs care with
  their `{{placeholders}}`.

### The editor's text size

- **The author found the writing too big next to the controls.** The editor
  was 13 px SF Mono on 20 px lines, while the UI is 11–12.5 px system text, and
  a monospace face looks bigger than a proportional one at the same size.
- **Now 12 px on 18 px lines,** VS Code's own editor default on macOS (its
  line height is 1.5 times the size, rounded). The side-by-side diffs and What
  changed's words are set the same way, since they're Typst source too.
- **Settings ▸ General ▸ Editor ▸ Text size** changes it (9–24 px, − / + /
  Default), as VS Code's `editor.fontSize`; `editorFontSize` in the settings
  file. ⌘= and ⌘− still scale the whole window, this text included.
- Verified (self-test `textsize`): 12 px text on 18 px lines by default; two
  clicks on + give 14 px on 21 px lines in the editor, and 14 px in the
  variable What changed's words use; − stops at 9 px; the setting is put back afterwards (local storage is shared
  with the author's app). Pictures at 75 % and 100 %.

### The sample book: kept in Git, and more like a book

- **Kept, not ignored.** `fixtures/sample-book` is the book the self-tests
  open (as a scratch copy). They look for its files (`ch1-vectors.typ`,
  `ch2-eigenvalues.typ`), labels, citations and some sentences ("The
  eigenvalues of…", "so there are at most two eigenvalues"), and use the first
  three lines of each chapter. It's small on purpose: 9 pages.
- **Ignored:** every PDF in the repository (exports, the print interior), and
  the sample book's `.typst-studio/` (the print wrapper and review comments
  the app writes while the book is open in it).
- **More like a real book:** a title page with an author, a copyright page,
  a preface, Contents, and in each chapter a few more sections (linear
  independence, Cauchy–Schwarz, diagonalization) and exercises. The text is
  one sentence per line, as the assistant is asked to write, and typstyle-clean
  with blank lines around headings, so Format on save doesn't change it.
- The broader samples (a public-domain novel, a paper) are a separate TODO.
- Verified: `typst compile` without warnings, and the self-test groups that
  read or edit the book pass on it (preview, typing, format, quickopen,
  breadcrumbs, selection, typingsync, ctags). `mathdiff` finds no drawn
  formulas on the old book either: What changed opens on Lines now, and the
  test still looks for the Words view's formulas.

### Page sizes for the US, Europe and Asia

- **New Book lists the common trim sizes, grouped by where they're used**
  (`src/templates/index.ts`):
  - United States: mass-market 4.25 × 6.87, 5 × 8, 5.25 × 8, Digest 5.5 × 8.5,
    US Trade 6 × 9, Royal 6.14 × 9.21, Executive 7 × 10, 7.5 × 9.25, 8 × 10,
    US Letter; picture-book squares and landscapes.
  - UK: A-format 110 × 178, B-format 129 × 198, Demy 138 × 216, Royal
    156 × 234, Crown quarto 189 × 246 mm, a 210 mm square.
  - Continental Europe: 13.5 × 21.5 and 17 × 24 cm.
  - ISO: A6, A5, B5, A4 (and A4 landscape for picture books).
  - Japan: bunko 105 × 148, shinsho 103 × 182, shiroku-ban 127 × 188, JIS B6
    128 × 182, kiku-ban 150 × 220, JIS B5 182 × 257 mm.
  - China: 32 kai 130 × 184, large 32 kai 140 × 203, 16 kai 185 × 260, large
    16 kai 210 × 285 mm.
  - Korea: 4·6판 127 × 188, 국판 148 × 210, 신국판 152 × 225, 크라운판
    176 × 248, 4·6배판 188 × 257 mm.
- **Each template offers what suits it:** prose (novel, non-fiction) the small
  and middle sizes (24); textbooks and programming books the large ones (17);
  the picture book squares, landscapes and big portraits (9); Blank all of
  them (43). The defaults are unchanged (6 × 9, 7.5 × 9.25, 8.5 square, A5).
  The picker groups them by region (`<optgroup>`), with Custom… at the end.
- **Checked against printers' and publishers' lists:** the UK sizes, the US
  ones (Royal 6.14 × 9.21 in is the UK's 156 × 234 mm), and Japan's bunko,
  shinsho and B6. Kiku-ban, the Chinese kai, the Korean sizes and the two
  continental ones are the commonly quoted trims; printers' differ by a few
  millimetres, which the dialog says.
- **Margins follow the page.** The templates had fixed margins: a novel's
  1.6 in of side margins left a 4.25 in mass-market page 2.65 in of text. They
  now scale from each template's default size (novel and non-fiction from
  6 × 9 in, textbook and programming from 7.5 × 9.25 in), so the default looks
  exactly as before. Blank uses Typst's own margins (2.5/21 of the shorter
  side), which follow the page too: 17.6 mm at A5, where it had 18 × 20 mm.
- Verified: every template compiled at every size it offers (134
  combinations), no errors or warnings, with pictures of the smallest, largest
  and default sizes; unit tests on the lists and the grouping; self-test
  `booksizes` reads the grouped list for four templates and picks a Japanese
  size.

### Choosing which Tinymist, OpenCode and Git to use

- **Settings ▸ Tools** shows, for each tool, the program in use and whether it
  was found automatically or chosen. A path box with Choose… (a file picker)
  sets another, and Automatic goes back. Typing applies on Enter or on leaving
  the box; Esc puts the path back first.
- **Kept in the settings file** as `toolPaths` (`{ "tinymist": "~/…" }`; `~`
  allowed). The Rust side reads it from the file each time it looks for a
  tool, so every window, and a hand edit, agree. The app writes the file at
  once when a path changes (not after the usual 300 ms), then:
  - Tinymist: the preview starts again with it;
  - OpenCode: the assistant starts again (after the turn, if it's working; the
    conversation carries on, since OpenCode keeps sessions on disk);
  - Git: nothing to restart. Each command looks it up; History starts if it
    was unavailable.
  Restarts run in the background, one at a time.
- **Order:** the chosen path, then the old environment variables
  (`TINYMIST_PATH`, `OPENCODE_PATH`, `TYPST_STUDIO_GIT`), then the search path
  (with Homebrew's folders), then VS Code's Tinymist.
- **A chosen path with no program there** isn't an error: the automatic one
  runs, and the page says "There's no program at …". A mistyped path shouldn't
  stop the preview.
- **A bug found by the self-test:** starting a restart disabled the box,
  which blurred it, and the blur applied the box's stale text, putting back the
  path just cleared. Now leaving the box applies only what was typed, and the
  box is never disabled.
- Verified (self-test `tools`, with the Rust side in a scratch build):
  VS Code's Tinymist 0.15.10 typed with `~` (the preview ran on it, the file
  kept `~`); `/nowhere/tinymist` (the warning, Homebrew's 0.15.8 in use);
  Automatic; Git at `/usr/bin/git` (History and Source Control ready); OpenCode
  at its own path (the assistant went starting → ready, and again for
  Automatic). It ends with every tool automatic. Rust unit test: paths read
  from the settings file, with `~`, empty and malformed values.

### The Tools page: every copy found, and every way to pick one

- **Asked for by the author** after the first version (a path box): a button to
  search again, a list to choose from, a file chooser, a text box, the
  clipboard, "really elegant and useful".
- **Every copy, not just the first.** For each tool the Rust side lists every
  copy on this Mac, once each (by real path), in the order Automatic takes
  them, with its version and where it came from:
  - the environment variable, then each folder on the search path ("Homebrew",
    "macOS" for `/usr/bin`, "Cargo", "OpenCode's installer", "Bun", or the
    folder);
  - Tinymist in VS Code's, VS Code Insiders', Cursor's, Windsurf's and
    VSCodium's Typst extensions, newest first;
  - Git from the Command Line Tools, Xcode and GitHub Desktop.
  Automatic is simply the first of them.
- **A card per tool:** a dot (found or not), the name and what it's for, and
  one picker showing the choice (Automatic or Your choice), version, source
  and path. Its list has Automatic (saying which copy that is), "Found on this
  Mac", then Choose a file…, Paste a path and Type a path…, with arrow keys,
  Enter, and Esc closing only the list.
- **A typed path is checked as it's typed** (`tool_probe`, 200 ms after the
  last key): there's nothing there, it's a folder, an app, not a program, not
  a whole path, or not this tool (its `--version` is shown: "That isn't
  tinymist: it says “git version 2.50.1”"); otherwise "Tinymist 0.15.10 —
  ready to use", and only then is Use enabled. `--version` runs with no input
  and is stopped after 3 s, so a wrong program can't hang the page.
- **Paste** reads the clipboard in Rust (`clipboard_read`): a file copied in
  Finder gives its path. Quotes, `file://` URLs and Terminal's backslashes
  before spaces are removed. A good path is used at once; otherwise it opens in the box with
  what's wrong. The same goes for a file from Choose….
- **Search again** looks again (after installing something); the page also
  looks each time it opens. A missing tool shows its install command with
  Copy.
- Verified (self-test `tools`, the Rust side in a scratch build): 3 copies of
  Tinymist (Homebrew 0.15.8, VS Code's 0.15.8 and 0.15.10) and 3 of Git
  (macOS, Command Line Tools, Xcode) listed; VS Code's 0.15.10 picked from the
  list ran the preview; the five bad and good typed paths gave the messages
  above with Use off and on; Enter used the good one; a quoted `~` path pasted
  from the clipboard was used (the author's clipboard was put back); Xcode's
  Git ran History and Source Control; OpenCode restarted for its copy and for
  Automatic; Esc closed only the list; Search again. Rust tests for the list
  and the probe.

### Sample books, one of each kind

- **Six finished books** in `samples/<id>/`, each made as the app would make
  it: the template's `style.typ` unchanged (a test checks), its `main.typ`
  layout, a filled-in `WRITING_STYLE.md`, the Makefile, `.typst-studio.json`
  and `.gitignore` a new book gets.
  - **Novel:** Stevenson's *Strange Case of Dr Jekyll and Mr Hyde* (1886),
    complete: 10 chapters, the dedication, the letters set apart; 90 pages at
    5 × 8 in. Checked word for word against two transcriptions; three
    scanning errors fixed from the other one.
  - **Non-fiction:** Strunk's *The Elements of Style* (1920 edition of the 1918
    book), complete: wrong/right pairs as two-column tables, the misused words
    as a term list; 57 pages at 5.5 × 8.5 in.
  - **Textbook:** Thompson's *Calculus Made Easy* (1914), the Prologue and
    Chapters I–V with their maths, redrawn figures, exercises and answers;
    34 pages at 6 × 9 in.
  - **Programming book:** *Counting Words*, written for the app: Python for
    writers in four chapters, 33 runnable examples. Their real outputs ship in
    `code-output/outputs.json`, so every one shows its output and 30 show ✓.
    The text they analyse is the opening of *Pride and Prejudice*, checked
    against the 1813 edition.
  - **Picture book:** Potter's *The Tale of Peter Rabbit* (1902), complete
    with her 27 illustrations (1.3 MB); 32 pages at 8 × 10 in.
  - **Research paper:** *Attention Is All You Need* in the NeurIPS template
    package. The paper's text isn't openly licensed: Google allows only its
    tables and figures, with credit, in journalistic or scholarly works. So
    this sample restates it in its own words, with the same structure,
    equations, results and references, and its own CeTZ figures. The author
    block and a first-page note say so and link the original. An n-gram check
    against the original found no shared run longer than table labels, terms
    and names.
  - Public-domain texts carry no trace of where they were downloaded (a test
    checks), and each copyright page says when the book was first published.
- **Opening one:** New Book has a Samples tab (also the welcome screen's Open
  a Sample… and the palette's Open a Sample Book…). It copies the sample to
  `~/Documents/Typst Studio Samples/<title>` and opens it at its first
  chapter. The author can change anything; opening it again opens the same
  copy, as it is. The copy is made in Rust (`sample_create`), so the pictures
  come along: the repo's `samples/` in a dev build, the app's resources when
  bundled (`bundle.resources`). tauri-build requires that folder to exist.
- **Checks:** `npm run check-templates` compiles each sample (no errors or
  warnings); `src/samples.test.ts` checks every folder is listed and
  complete.
- **The templates' problems the samples found, fixed in the templates:**
  - A chapter title on two lines was justified, with wide gaps ("Remarkable
    Incident of Dr. / Lanyon"), or hyphenated ("Composi-tion"). Headings are now
    ragged and never hyphenated, in all four book styles.
  - The textbook and programming styles had no page numbering, so a page
    reference (`#ref(<label>, form: "page")`) was an error. The page counter
    now has a numbering; the header and footer print it as before.
  - The samples' own workarounds are gone. Every page of every template and
    sample renders exactly as before (compared image by image), since the
    templates' own titles fit on one line and the samples had the same rules.
  - Still open: with a title, copyright and dedication page, a novel's
    chapter 1 starts on a left-hand page. Jekyll and Hyde adds
    `#pagebreak(to: "odd")`; the template doesn't, since odd-page breaks
    give blank pages headers (see Book templates).
- Verified (self-test `samples`, Rust in a scratch build): the Samples tab
  lists six cards; Peter Rabbit (27 pictures), Jekyll and Hyde and Counting
  Words each open at their first file and compile with 0 errors and 0
  warnings; opening Peter Rabbit again keeps a change made to its copy.

### Claude Code as the assistant, over the Agent Client Protocol

- **Settings ▸ Assistant ▸ Which assistant:** OpenCode (as before) or Claude
  Code (`assistant` in the settings file). Changing it starts a new
  conversation with the other program. Gemini CLI and Codex use the same
  route (next sections).
- **ACP, not a CLI's own headless mode.** The Agent Client Protocol (Zed's,
  also used by JetBrains) is JSON-RPC lines on a program's stdin and stdout.
  Claude Code speaks it through `@agentclientprotocol/claude-agent-acp`
  (pinned 0.93.0), run with `npx` (Node.js), which signs in with the
  author's Claude Code login. A permission card needs the agent to *ask*,
  and ACP has that built in (`session/request_permission`); `claude -p`
  would need an MCP permission server instead.
- **Rust only runs the program** (`acp.rs`): in the book's folder, in its own
  process group (npx starts the agent as its child, so Stop and quit end
  both), stdout lines to the page, `acp_send` for lines back, registered for
  cleanup like OpenCode. The search path now includes Node from fnm, nvm and
  Volta, which a Finder-launched app doesn't inherit.
- **The page speaks the protocol** (`src/services/agent/acp.ts`), behind the
  same adapter interface as OpenCode, so the chat, tasks, queue, Stop and
  Resume work unchanged. What OpenCode keeps on its server is kept here:
  - each conversation's transcript, in OpenCode's context shape, so switching
    conversations rebuilds the chat (from `session/load`'s replay after a
    restart, with the instructions taken back out);
  - the instructions, sent before the author's message (in
    `<typst-studio-instructions>`), and again only when they change. The
    adapter only offers to replace Claude Code's own system prompt;
  - the permission rules: the agent asks, and the same `sessionRules` answer
    (allowed, denied, or the card). A command line is checked whole and part
    by part;
  - messages sent while it works: queued until the turn ends, or handed to
    the running turn (Claude Code's `_session/steering`) for "send now".
- **Its tools in the app's words.** Claude Code's `Read`, `Edit`, `Bash`…
  become the app's `read`, `edit`, `bash` (inputs renamed, a read's
  `12\ttext` lines as `12: text`), so the chat says "Read “Vectors”
  (chapter 1) · lines 1–30" and marks the lines read. Other agents' tools
  map by name or by ACP's `kind` and locations.
- **Models** come from the session's `model` option (Default, Opus, Sonnet,
  Haiku…), in the same picker; a session is made at start for them, and the
  first conversation takes it. Usage updates give the context meter;
  `session_info_update` names the conversation; `/compact` compacts.
- **The instructions now name the book's folder.** Haiku turned this
  scratch path's `-Users-…/` into `-Users-…-` and read outside the book (the
  card asked; the test refused); with the folder spelled out it didn't.
- **Not offered:** OpenCode's question tool (Claude asks in its reply
  instead), and editing unsaved buffers through ACP's `fs/*` (the app saves
  before every message, as with OpenCode).
- Verified: recorded traffic (`__fixtures__/acp-claude.jsonl`, the account
  lines removed) replayed through the adapter in unit tests. Self-test
  `acp-claude` with real turns on Haiku 5.5: models listed, a read (lines
  1–30 marked), an edit asked about with its patch, allowed, the chapter
  changed, a message queued and delivered after, Stop (interrupted, Resume
  offered), the conversation rebuilt after switching and after a restart.

### Gemini CLI as the assistant

- **The same route:** Gemini CLI speaks ACP itself (`gemini --acp`; the old
  `--experimental-acp` is deprecated). The app runs `gemini` if it's
  installed, otherwise `npx @google/gemini-cli` (pinned 0.64.0).
- **Signing in.** Not signed in, Gemini answers `session/new` with ACP's
  `auth_required` (-32000: "Gemini API key is missing or not configured").
  It offers Log in with Google, an API key, Vertex AI or a gateway. The app
  doesn't drive the sign-in (Google's login opens a browser, and an API key
  would have to reach the program somehow). Instead it says what's wrong
  and how to sign in once in Terminal (Gemini keeps its login), with Start
  again in Settings ▸ Assistant. Each assistant's status line and the
  status bar now name the program chosen, not "OpenCode".
- **Another program, its own models:** starting a different assistant clears
  the model list (a failed start no longer shows the previous program's
  models).
- **Not yet tried with a signed-in Gemini:** there's no Google login on this
  Mac. Everything after the sign-in is the code Claude Code's turns
  verified. Gemini's tools (`read_file`, `replace`, `run_shell_command`…)
  map to the app's by name, and ACP's `kind` covers the rest.
- Verified: a unit test with Gemini's recorded reply; self-test `acp-gemini`
  starts it with npx and shows the sign-in message and Start again in
  Settings, with an empty model list; back on OpenCode afterwards.

### Codex as the assistant

- **The same route,** through `@agentclientprotocol/codex-acp` (pinned 2.2.2;
  `codex-acp` if it's installed), signed in with `codex login`
  (ChatGPT or an API key). Recorded with this Mac's ChatGPT login.
- **Its modes decide whether it asks.** Codex has Read-only, Workspace
  access, Auto review (its default, which asks almost nothing) and Full
  access. The app picks the one that lets its own rules decide:
  - edits allowed (Edit freely): Workspace access. Codex edits the book
    without asking and asks about the rest;
  - otherwise, and in Plan and Options: Read-only, where it asks before
    changing anything. Once it got round its own read-only sandbox with
    `python3 -c …` writing the file, so the card asked about a command.
  Claude Code's "default" asks before changes, and the rules answer.
- **Plan** is Codex's `collaboration_mode` option, not a session mode, and
  the adapter sets that. `/compact` is used wherever the agent lists it.
- **Codex's own shapes:**
  - command output streams in `_meta.terminal_output_delta`, not in the
    result, and is collected per tool call;
  - some commands arrive quoted (`"\"python3 -c …\""`);
  - searches are described only in their titles ("Search for 'x' in …");
  - reads are shell commands with no line range, so their lines aren't
    marked;
  - it names a conversation by its first message, which would be the app's
    instructions, so such a title is dropped (the app's own title stays).
- Its models come from the same `model` option (6.1 Sol, 6 Astra, 6 Luna…),
  plus a reasoning-effort option the app doesn't show yet.
- Verified: `__fixtures__/acp-codex.jsonl` (recorded; the account and the
  author's own commands removed) in unit tests. Self-test `acp-codex` with
  real turns on 6 Luna: a read; an edit asked about (by its patch tool this
  time), allowed, the chapter changed; a queued message; Stop with Resume;
  the conversation rebuilt after a switch. After a restart, Codex's replay
  leaves out the stopped turn's partial reply.

### No assistant installed: OpenCode inside the app

- **The question:** what about people who have none of OpenCode, Claude
  Code, Gemini CLI or Codex? Could the app carry OpenCode, so they could
  eventually use an API service of ours?
- **Yes: a release build can carry OpenCode,** in the app's Resources
  (`Contents/Resources/opencode/`). The app uses it only when it finds no
  other copy: it's last in the Tools page's list ("bundled with Typst
  Studio"), and can be chosen there like any copy.
  - `npm run app:build` runs `scripts/bundle-opencode.mjs`, which copies an
    installed OpenCode 2.x and its MIT licence to `src-tauri/bundled/opencode/`
    (git-ignored), then builds with `tauri.bundle.json`, which adds that
    folder to the Resources. `npm run app` and a plain `tauri build` don't
    need it.
  - OpenCode 2.x isn't published as a binary: GitHub and npm have 1.19, the
    old API the app doesn't speak, and Homebrew builds 2.x from source. So the
    script copies an installed 2.x. Release builds should use a pinned
    source build per architecture.
  - The cost is size: OpenCode is 169 MB for arm64, and a universal app
    would carry two. The app is 10 MB, the samples 1.9 MB; the release
    `.app` with OpenCode is 181 MB.
  - With OpenCode in the app, a person still needs a model: an API key for a
    provider, or a local model.
- **An API service of ours** would fit here. OpenCode reads providers from
  its config, so when the app starts `opencode serve` it could add one more,
  an OpenAI-compatible endpoint and the person's key, through
  `OPENCODE_CONFIG_CONTENT`, and make it the default. With the bundled
  OpenCode, someone with nothing installed would then sign in and write.
  There's no setting for it yet: there's no service to point it at.
- Verified in a release build (`tauri build` with the overlay, 1 min 51 s):
  the Tools page listed Homebrew's OpenCode and then the bundled one. Chosen,
  the assistant ran on the bundled copy (ready, 80 models). A sample book
  opened from the app's Resources, which is the release path for samples
  (Peter Rabbit, 27 pictures, 32 pages).

### Settings: Typst Studio's, and this book's

- **Asked for:** "separate settings for your app config vs book config". The
  book's settings were one page among the app's, and the Permissions page
  mixed commands allowed in every book with those for this book only.
- **Two groups, as VS Code's User and Workspace settings,** split by where
  they're saved:
  - **Typst Studio** (General, Assistant, Permissions, Tools), for every book,
    in `~/.typst-studio/settings.json`;
  - **This book · *its name*** (Files, Assistant), in the book's
    `.typst-studio.json`, so they travel with it. Files has the main file, the
    Typst root, the PDF folder and the font folders. Assistant has the
    writing style guide, the commands allowed in this book only, and trust in
    its code examples.
- **Each page starts by saying where it's saved:** "For every book. Saved in
  ~/.typst-studio/settings.json…" with Open in text editor (and the file's
  problem, if it can't be read), or "For *the book* only. Saved in
  .typst-studio.json in the book's folder…" with Open the file. This
  replaces the Settings file section on General.
- Search still shows every page of both groups, a book's pages titled "This
  book · …". A page's name counts toward its matches, so the book's first
  page is "Files": named "Files and fonts", every setting on it matched
  "font".
- Opening a page puts the cursor on its first setting, not on the banner's
  link.
- Verified (self-test `settings`): six pages in two groups, each with its
  banner and the cursor on its first setting; "font" finds Extra font
  folders on Files (1 setting), "ALLOW python" the commands for every book on
  Permissions, "enter send" the send key on General.

### Waiting, apart from thinking

- **Asked for:** "thinking needs to be thinking time not waiting time. split
  them and show both in chat ui". The progress line said "Thinking…" from the
  moment a turn began, and after every tool, while the model hadn't said
  anything yet; its time ran from Send. A thinking block's "Thought for" ran
  until its end event, which can come well after its last words.
- **A new step, waiting:** "Waiting for the model…" is the progress line
  whenever the model has said nothing yet: after Send, a new step, a tool's
  result, an answered question, and after one thinking block before the next
  thing. The model may be queued, loading, or reasoning it doesn't show; the
  app can't tell those apart, so it doesn't call it thinking. "Thinking…" now
  means its reasoning is streaming in.
- **Each step has its own time:** the progress line's time is how long this
  step has run ("Waiting for the model… 12 s"), followed, when the turn had
  steps before it, by the turn's ("· 1:05 in all", tooltip "Since you sent
  it"). Sending and then waiting for the first words count as one wait.
- **Thinking blocks show both:** live, "Waited 12 s · Thinking… 3 s", the
  thinking time ticking from its first words; done, "Waited 12 s · Thought
  for 4 s", thinking timed from its first words to its last. A wait under a
  second isn't mentioned. Reasoning that comes all at once says "Thought",
  with no time, since how long it took isn't known.
- Saved conversations still show "Thought for 4 s" from the reasoning parts'
  own times: what came before a part isn't timed.
- The timing is in `src/app/activity.ts`, with unit tests.
- Verified: unit tests (9) for the step clocks, the wait before thinking, and
  the headings. The `thinking` self-test now waits 2 s, streams thought for
  2 s and closes it 1.5 s later; it didn't run here, with the screen locked
  (WebKit throttles the window, and the preview never started).

### Settings ▸ Assistant, as cards

- **Asked for:** "the settings UI for choosing claude/codex/opencode/gemini is
  bad … make it really elegant". It was four radio buttons with long dashes,
  a paragraph naming three sign-in commands, ACP and Node.js at once, an
  error line under all of them, and a Model section that only said where the
  model is changed.
- **A card for each assistant** (`src/components/AssistantSettings.tsx`), two
  to a row: a mark (a glyph on a tile of its own colour, not the maker's
  logo), the name and maker, the account it runs on, and a status line. The
  chosen card has the accent border and a check. Arrows move between the
  cards; Space, Enter or a click chooses, since choosing starts the program.
- **The status lines say what's true on this Mac** (`assistants_status` in
  `acp.rs`): for the chosen one, how it is now (Running · Opus 5.5,
  Starting…, Not signed in, Needs Node.js, Didn't start); for the others,
  how they'd run (Signed in with Claude Max, Signed in with ChatGPT,
  Installed · 2.0.20, Downloads the first time). Signed in comes from
  `claude auth status --json`, Codex's `auth.json` (its `auth_mode` only),
  Gemini's Google credentials or an API key in its `.env`; otherwise it's
  unknown until a start shows it. A start that fails with ACP's
  `auth_required` sets `agent.signedOut`, and a running one is signed in.
- **One panel for the chosen one:** a sentence for how it is, with Start
  again; what to do when something's wrong; then Model (the chat's model
  picker, working here too), Account (or OpenCode's Providers) and Program
  (installed, with its path; run by npx, with the package; or Node.js
  missing).
- **Sign in in Terminal:** a button opens Terminal on the exact command for
  this Mac (`claude auth login`, `codex login`, `gemini`, `opencode auth
  login`; the npx form when the program isn't installed), through a
  `.command` file that says what to do there. Back in Typst Studio, the
  assistant starts again by itself. The command is shown with Copy too. The
  chat's status line, signed out, says just "*Name* isn't signed in." with
  Sign in… (to this page) and Retry.
- **Gemini CLI or Antigravity CLI?** Google stopped serving Gemini CLI for
  personal Google logins on 2026-06-18; Antigravity CLI (`agy`) replaced it
  for them. Gemini CLI still works with a paid Gemini API key or a Gemini
  Code Assist Standard or Enterprise account, and its card and panel say
  so. `agy` doesn't speak ACP (only community bridges wrap it), so it isn't
  offered.
- Not done: the marks section's checkboxes stay as they were (the TODO about
  checkboxes in Settings is its own change). The Sign in in Terminal button
  wasn't clicked here: the script is unit-tested, and opening a `.command`
  file is how Terminal runs one.
- Verified: Rust unit tests for the account parsing and the script's
  quoting; self-test `assistantpage` (asked for by name, since it starts
  Claude Code and Gemini CLI): OpenCode running with its model, Claude Code
  chosen by its card (running, Opus 5.5, signed in with Claude Max), Gemini
  chosen (not signed in, the sign-in step and its npx command), the others'
  cards (Signed in with ChatGPT, Downloads the first time), arrows moving
  focus without choosing, the chat's Sign in… link; the settings file never
  written, OpenCode back after.

### Picture books: pictures across the page, and Luca's Wonderful Brain

- **Asked for:** "the childrens book example is kinda crappy because it
  doesnt use images the way id hoped", with JJ Geewax's own book (*Luca's
  Wonderful Brain*, © 2026, all rights reserved) to use instead. Peter
  Rabbit's pages were a vignette on white with a line under it; real picture
  books run the picture to the edge and set the words on it.
- **The picture-book template does what that book does** (its own Typst,
  driven by YAML, rewritten as functions an author calls):
  - `#story-page(picture:, at: top)[...]`: the picture fills the page and
    reaches into `page.bleed`; the words sit on a soft paper-coloured panel
    that hugs them, at the top or bottom of the safe area (0.375in from the
    edges, 0.6in from the binding, which side depending on the page).
  - `#spread(picture:, left:, right:)`: one picture over a left and a right
    page, each half reaching past the fold by the bleed, as printers ask.
    It refuses to start on a right-hand page, with the page number and what
    to do.
  - `#words(at: top + right)[...]` for more words on a picture (two boxes on
    one half of a spread); `sound("rub!", x:, y:, angle:, size:)` for sound
    words drawn on the picture, outlined in white.
  - `#vignette-page`, `#title-page`, `#the-end(picture:)`: a picture on
    white, fitted to the room left and faded at its edges. Also
    `#copyright-page` (as the other templates) and `#dedication`.
  - `book.with(font:, title-font:, accent:, page-numbers:)`; numbers sit in
    the outside bottom corner, never on the title, copyright or dedication
    pages.
- **The sample** (`samples/lucas-wonderful-brain`) is the printed book page
  for page: 28 pages at 8.5 in square, 3 spreads, 3 pages with sound words, a
  favourites list in two columns. The pictures are the chosen versions,
  1400 px a page and 2760 px a spread at JPEG quality 75 (4.9 MB in all; the
  print files are 2625 px). Its fonts, Andika and Sniglet (OFL, licences
  beside them), come in `fonts/` with `fontPaths`, so the sample test now
  allows `fontPaths` and checks the Makefile passes them, and
  `check-templates` compiles samples with them. Not carried over: the book's
  private notes, placeholder ISBN, and art-generation tooling.
- Peter Rabbit is gone (samples are one of each kind), and the README shows
  the new sample.
- Verified: unit tests; `check-templates` (the template at 5.5 × 8.5 in with
  the escaped title, and the sample, with no warnings); the sample through
  the print wrapper with 0.125in bleed, rendered with its bleed: every
  picture reaches the media box, and the halves of each spread match pixel
  for pixel across the fold; self-tests `samples` (the card, opened at
  story.typ, 28 pages, 0 errors, 0 warnings, 22 pictures, a change kept on
  reopening) and `print` (a new picture book passes, with no edge warning).

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
