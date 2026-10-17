# Live preview spike

Phase 0 spike for SPEC §4/§6: one Tinymist process serves both the LSP and the
live preview. Monaco edits go to it as LSP `didChange` and the embedded preview
re-renders the whole book from the unsaved buffers. Nothing is written to disk.
Throwaway code; the findings live in [docs/decisions.md](../../docs/decisions.md).

## Run

```sh
cd prototypes/live-preview
npm install
node ../../scripts/gen-stress-book.mjs          # optional: 491-page book in fixtures/stress-book

node serve.mjs                                  # sample book → open http://127.0.0.1:5199 in Safari
node serve.mjs --root ../../fixtures/stress-book
```

Type in the editor and watch the preview. The footer shows compile status,
edit → compiled time and key → editor paint latency. Scroll the preview by hand
(`?scroll=1` turns on click-to-scroll, which reproduces the WebKit bug below).

Tinymist is found via `$TINYMIST_PATH`, then `PATH`, then the VS Code extension.

## Measure

```sh
node bench.mjs                                   # headless: LSP + preview WebSocket, no browser
node bench.mjs --root ../../fixtures/stress-book

npx playwright install webkit chromium           # once
node browser-bench.mjs --root ../../fixtures/stress-book                   # WebKit, partial rendering on
node browser-bench.mjs --root ../../fixtures/stress-book --partial off
node browser-bench.mjs --root ../../fixtures/stress-book --engine chromium
```

`bench.mjs` checks that an unsaved edit in an included chapter changes the
compiled book, that errors surface without breaking the preview, and that files
on disk are untouched. `browser-bench.mjs` types real keys into Monaco and times
key → editor paint and key → preview DOM paint inside the embedded iframe.

## Files

- `lsp.mjs` – minimal LSP client over stdio
- `tinymist.mjs` – Tinymist discovery, session, `pinMain`, `doStartPreview`
- `serve.mjs`, `index.html` – Monaco + embedded preview page
- `bench.mjs`, `browser-bench.mjs` – measurements
