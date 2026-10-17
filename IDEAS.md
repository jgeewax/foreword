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
