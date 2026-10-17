# IDEAS

Ideas that came up while working through TODO.md. Not commitments, just things worth considering.

## History

- Filter the history list by file ("show versions that touched ch2"), or show only agent changes.
- Compare any two versions, not just a version against the one before it.
- Thin out old automatic versions after a while, e.g. keep hourly versions after a day and daily ones after a month. Never thin out named versions.

## Status bar

- Writing goals: show the day's word count next to the book total, and an optional daily target ("412 / 1,000 words today").
- Click the page and word count to see per-chapter counts.

## Figures

- AI image generation (photos, painted art). This needs an image model and a key Typst Studio holds itself (in the Keychain). Today OpenCode holds the LiteLLM key and has no image tool. Possible route: an "Image model" setting that calls LiteLLM's `/v1/images/generations`, saves the PNG to figures/ and inserts a `#figure`. History keeps the old file, so regenerating is safe.
- A figure gallery: every figure in the book with its caption and number, with a jump to its source or a request to the assistant to restyle all figures consistently.
- Charts that track their data: when data/\*.csv changes, the chart changes (Typst already does this). Show which figures read which data files.
- Vision models: let the assistant look at a raster figure (send the image) so it can describe it, write alt text, or suggest a better caption.

## Menus and commands
- A command palette (⌘K or ⇧⌘P) listing every action with its shortcut. The context menus already define most of them.
- "Copy as plain text" / "Copy as Markdown" for a selection in the preview or the chat.

## New books and papers
- Import an existing manuscript (Word .docx, Markdown, LaTeX) with pandoc (`pandoc -t typst`), split into chapter files by top-level heading. Needs pandoc installed, or bundled.
- ICML and ICLR paper templates, once their Typst Universe packages work with Typst 0.15 (lucky-icml 0.7.0 and clear-iclr 0.7.0 fail today). Re-check with `npm run check-templates -- --papers`.
- Thesis templates: many universities have one on Typst Universe. Search by university name in the New Book dialog.
- Venue page limits: warn when the paper goes over (e.g. "NeurIPS: 9 pages of content").
- Reorder chapters by dragging in the file tree, which rewrites the `#include` order and optionally renumbers the files.
- "Install fonts" button: run the `brew install --cask …` command for the author, with a confirmation.

## Files
- Drag and drop in the file tree to move files. This would use the same rename logic, references included.
- Inline rename in the tree (Enter or double-click on a name), like Finder.
- Drop images from Finder onto the editor: copy them into figures/ and insert a `#figure(image(...))`.
- "Unused files": images and chapters that nothing includes.
