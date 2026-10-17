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

## Permissions
- Per-book permissions saved in `.typst-studio.json` (e.g. a shared book that's always read-only), overriding the app setting.
- "Allow for this book" on a permission card. OpenCode supports saved permissions (`/api/permission/saved`); show and revoke them in Settings.
- Show which rule decided a refusal ("Delete files: Never") in the failed tool's details.

## Code examples
- Examples that build on each other (a "session": later examples see earlier variables), like notebook cells.
- Show plots: an example that writes an image (matplotlib `savefig`) gets it placed as a figure under the code.
- Run examples in a sandbox (macOS `sandbox-exec` profile or a container) for books from other people.
- Pinned environments: a requirements.txt / package.json next to the book, set up in a per-book virtualenv.
- Test the whole book in CI: a small CLI that runs every example and fails on mismatches (same rules as code.typ).
- More languages: TypeScript (deno/tsx), Go, Rust, C, Java (compile, then run).

## Selection and context
- "Selected in preview" for images and figures: clicking a figure in the preview attaches its #figure call.
- Attach a whole file or chapter to the chat by dragging it from the file tree onto the message box.

## TODOs
- Show TODOs in the preview (a margin marker) in draft mode, hidden when exporting.
- Assign a TODO to the assistant in the background (its own task session), and mark it done when that finishes.

## Tasks
- Run several tasks at once in the background (OpenCode supports concurrent sessions), with a badge when one finishes or needs permission.
- Hand a task its own History branch, so finishing it can be reviewed as one change ("Review task changes" diff) and undone as one.
- Suggest a new task when the context meter goes red, or when a message drifts away from the task's goal.
- Rename, archive and delete tasks; search them.

## History, what changed
- Word counts in the version list itself (computed in the background and cached per version), so the list reads "+120 −30 words" without opening anything.
- Compare any two versions (pick two in the list), e.g. "Draft 1" against "Draft 2".
- A one-line gist of each version ("since noon → since early morning") under its label.
- Changes in the rendered book: the preview with changed passages highlighted, for authors who think in pages rather than source.

## The assistant's marks
- Accept the assistant's changes (clear their marks) per passage or per file, like reviewing a pull request; "Accept all" after reading.
- Show the assistant's changes in the preview too (a violet margin bar on changed paragraphs).
- Next/previous assistant change (keyboard), across files.
- A per-paragraph authorship view ("who wrote this": you or the assistant, from History), for authors who must disclose AI use.

## Review
- Comments in the preview: a margin bubble next to the rendered passage. Click it to see and reply.
- Reply threads on a comment, and the assistant's per-comment answer shown under it.
- Address comments one at a time with Options mode (three versions each), for picky passages.
- Export comments as a PDF with annotations, or import them from one (an editor's PDF markup → review comments).
- Share a review: other people add comments through a shared link (needs a server, or comments in Git).

## Covers
- Printer presets: Mixam, IngramSpark and Lulu bleed, spine and barcode rules; pick the printer once and the cover and the print checks follow it.
- A real barcode: generate the ISBN EAN-13 barcode in the box (a Typst package such as tiaoma), from an ISBN field.
- More styles, and covers matching each book template's fonts and colours (one per template, chosen by default).
- Ask the assistant for cover copy (back-cover blurb, tagline) in the book's voice, from the manuscript and style guide.
- A front-only export (ebook cover, 1600×2560 PNG) from the same design.
- Hardcover case wraps and dust jackets (different hinge and wrap allowances).

## Printing
- Mixam quotes in the print dialog through its Offers API (price, production days, exact spine) once there's an approved API account; credentials in the Keychain.
- A print proof: the interior and cover PDFs side by side in a spread view with trim and bleed marked, before uploading.
- Check margins against the printer's quiet area (text frames within 0.25in of the trim, 0.5in of the binding) from the compiled layout.
- Other printers through the same checks: Amazon KDP (no bleed unless images run off the page), IngramSpark, Lulu; each with its own page-count and cover rules.
- Grayscale check for black-and-white printing (colour on an inside page costs more at most printers).
- Blank-page padding as an option (add the blank pages a printer needs, as a print-only setting, instead of in the book).

