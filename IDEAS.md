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

- AI image generation (photos, painted art). This needs an image model and a key Foreword holds itself (in the Keychain). Today OpenCode holds the LiteLLM key and has no image tool. Possible route: an "Image model" setting that calls LiteLLM's `/v1/images/generations`, saves the PNG to figures/ and inserts a `#figure`. History keeps the old file, so regenerating is safe.
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

- Per-book permissions saved in `.foreword.json` (e.g. a shared book that's always read-only), overriding the app setting.
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

- A task's live transcript in the background (not only its status), so switching back mid-reply never has to reload.
- Answer a background task's question or permission straight from its notice, without switching.
- Per-task History versions when tasks run side by side (today a version records the whole book when a turn ends, whichever task it was).
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
- Reads by other tools too: grep matches (the lines it found) and globbed files, as lighter marks.
- A "what the assistant knows" panel: files and ranges in the current conversation, with what's stale (changed since it was read).
- A per-paragraph authorship view ("who wrote this": you or the assistant, from History), for authors who must disclose AI use.

## Review

- Comments in the preview: a margin bubble next to the rendered passage. Click it to see and reply.
- Reply threads on a comment: ask the assistant about one comment, or tell it "not like that", in the card.
- Suggestions (tracked changes): the assistant's change waits beside the text, and only goes into the file when you press Keep.
- Fix a comment as a background task, so you can keep reviewing while it works.
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

## Chat

- Show the model's thinking in a side panel for the whole turn, for authors who want to follow along.
- Retry with another model when the current one is busy (the progress line already says when it is).
- Pin a queued message to send even if the turn fails.
- Images in questions: the assistant asks "which layout?" with small previews of each option.

## Settings and the config file

- A JSON schema for settings.json, so editors complete and check it.
- Per-book overrides of any setting (send key, marks) in .foreword.json, not only commands.
- Sync settings across Macs (iCloud Drive folder as the config location).

## Toolbar and layout

- Custom layouts (writing: editor + preview; reviewing: preview large + comments), switched from the pane toggles.
- A focus mode: only the editor, full width, typewriter scrolling.
- Indent guides in the file tree (VS Code's thin vertical lines), shown on hover or for the active file's folder.
- A separate "chrome size" setting (compact / regular / large) apart from the writing zoom.

## Go to file

- ⌘P with ":" for a line (`ch2:40`) and "@" for a heading in the open chapter, as in VS Code.
- Recently opened files remembered across launches, first in ⌘P's empty list.
- ⌘⇧O: headings, figures and labels across the book (`<eq-eigen>`), not only files.

## Figures

- After a turn that leaves new compile errors, tell the assistant (as code examples do) so it fixes them before the author sees a broken preview.
- A "Figure style" page in Settings (or the This book page): pick the palette and line width, preview a sample figure, and write figures/figure-style.typ.
- "Restyle all figures": convert existing cetz.canvas/diagram figures to the shared wrappers in one task, with each figure's before/after in What changed.

## Menus

- Grey out menu-bar items that can't act (no book open, nothing to fix, assistant not running) by updating them from the page.
- Assistant → Mode (Write, Plan, Options, Figures) as checkable items, in step with the composer's mode menu.
- Help → Keyboard Shortcuts: one page listing every shortcut, chords (⌘K …) included, generated from the menus and key handlers.

## Long books

- "Export this chapter": a PDF of one chapter for an editor or reviewer. Needs the book to say how (a template that reads `sys.inputs.chapter` and includes only that one, keeping the preamble and numbering).
- A "focus on this chapter" preview mode built on the same opt-in, for writers who find 500 pages of preview distracting.
- Re-measure edit → preview on a 1,500-page book; compile time grows with the book even though the preview only draws what's in view.

## Source Control

- "Write the commit message": the assistant drafts one from what changed, the author edits it.
- Branches: list, switch (only with nothing uncommitted) and create, in words ("a draft for the editor").
- Conflicts after a pull that needs a merge: show both versions of the passage side by side and let the author pick, instead of Git's markers.

## From Ayakaleaf Pro

Ideas from [Ayakaleaf Pro](https://github.com/ayaka-notes/ayakaleaf-pro) (formerly Overleaf Pro Edition), a self-hosted Overleaf fork with Overleaf's paid features and its own AI tools, looked at in October 2026. Its web server parts (SSO, admin panel, sandboxed compiles, compile quotas) don't apply to a Mac app; these do.

- The assistant sees the page. Ayakaleaf's assistant has a `view_page` tool that renders a page of the compiled PDF as an image for the model, and a `view_struct_tree` tool for the PDF's outline. Here: a tool that renders page N of the preview (or the page a passage lands on) as a PNG, so a vision model can check what the source can't show: a figure floated pages away from its mention, a table running off the page, a lone line at the top of a page, a chapter opening on a left page, the cover's spine text. Plus the outline with page numbers ("chapter 3 starts on page 41").
- Diagnostics as a tool. Its `get_diagnostics` returns the compile errors and warnings with file, line and log context, and says whether they're current (`hasUncompiledChanges`). Here: the assistant asks for Typst's errors and warnings itself, before and after an edit, instead of only being told about new ones at the end of a turn.
- Fix this error, in place. Its Error Assistant puts "Suggest fix" on each entry of the compile log: the fix shows as a change to accept, "Suggest a different fix" asks again, and the last suggestion stays with the error until it's gone. Here: the same on a red squiggle's hover and on the status bar's error count, with the change shown before it goes into the file (today "Ask the assistant to fix it" goes through the chat).
- An MCP server for the open book. Each Ayakaleaf project has one, so Claude Code, Codex, Cursor or Gemini CLI can read and edit files, compile, read the log, download the PDF and answer comments. Here: a local MCP server while a book is open, so the author's own agent in Terminal or VS Code works on the live book: unsaved buffers, diagnostics, page images, review comments to answer and resolve. The same permissions and History versions as the built-in assistant apply.
- Edits that carry the old text and a reason. Its `replace_lines` takes the exact current lines (to find them if the file moved) and a one-line rationale, and the author approves a diff. Here: show each change's reason in What changed and on the assistant's marks ("tightened: the sentence repeated the heading").
- Zotero and Mendeley. Link the account once; import a library or a group's collection as the book's `refs.bib`, and refresh it from a button when the library changes. Typst reads BibTeX and Hayagriva YAML, so either works.
- A citation picker. Ayakaleaf's reference search finds entries across every `.bib` file by author, title and year, highlights the words that matched, and inserts the keys. Here: typing `@` (or a shortcut) opens it, with several picks becoming `@a @b`, and the entry's title shown on hover over a citation in the editor. Tinymist completes a citation once you've started typing its key.
- Search the whole book. A Find view for every file at once, with match case, whole word and regular expression, match counts per file, and Replace in all. Monaco only finds in the open file.
- A symbol palette. Math symbols by group (Greek, arrows, relations, operators, sets) with search by name or by look, each shown rendered, inserting Typst's name (`arrow.r.double`, `subset.eq`). Typst's dotted names are hard to guess; Tinymist's symbol data has them all.
- Two-way sync for people who don't use Git: "Back up to GitHub" (create a private repository and push each named version), and a Dropbox or iCloud Drive folder kept in step, with a sync status in the status bar.
- "Open in Foreword" links, as Overleaf's "Open in Overleaf" API: a `foreword://` URL that opens a snippet, a file URL or a zip as a new book, for template sites, Typst Universe pages and tutorials.
- Scripts that make figures. Its Python runner runs a project's scripts. Here: a figure's script (`figures/growth.py` writes `figures/growth.svg`) runs again when it or its data changes, so a chart is never stale; History keeps the old images.
- The assistant looks things up in Typst's documentation (a docs search tool, as Ayakaleaf has) instead of guessing at syntax, and in Typst Universe for packages.
- Template gallery with pictures: each template's title page and a spread, rendered, in New Book.
- A first-use note before the assistant runs: which company's model reads the chapters, and what's sent. Ayakaleaf asks for consent before its error assistant's first use.
