# Changelog

What's new in each version of Typst Studio. The release build uses each version's section as its release notes, which the app's update dialog shows under What's new.

## 0.3.0 · 19 October 2026

### Finding your way

- **Search the whole book** (⇧⌘F, or the new Search view): words or a pattern, matching case or whole words, in every chapter at once, open ones as they are in the editor. Results sit under each chapter's name in reading order and follow your edits; a click opens the chapter with the match selected. **Replace All** asks first, and History keeps the book as it was.
- **Contents:** the book's chapters in order, numbered as the book numbers them, each with its sections and about how many words. The heading you're in is lit, and a click goes anywhere.
- **Go to File numbers chapters** ("17. The Harbour"), and typing the number finds it. A prologue without a numbered heading doesn't push the rest up one.
- **A tour for someone new:** a minute's look around the window, one part at a time. It offers itself the first time you open a book; Help ▸ Take the Tour runs it again.
- **The icons down the side say what they're for** in a card when you hover them, and each has a shape of its own now, with small count badges that don't cover it.

### The window

- **A colour for each book**, as VS Code's Peacock gives a folder: the title bar, the icons down the side and the status bar wear it, so a glance tells one book's window from another. Choose it in Settings ▸ This book ▸ Colour (or Surprise me). A book with a Peacock colour in its VS Code settings wears that one already.
- **The title bar's search box is VS Code's size**, and like VS Code's title bar it doesn't shrink when you zoom out.
- **The assistant's conversations stay in the assistant pane.** The Conversations view is gone; its list is the task menu at the top of the pane (View ▸ Assistant Tasks), and while the pane is hidden a dot on its button says when a task needs you.

### History

- **History is a timeline:** each version a dot on a line from now back to the start, coloured by who made it (you, the assistant's purple ✦, a version you named), with how much it changed. A click shows what it changed, and its files and what you can do with it (compare with now, undo the assistant's changes, restore) fold out beneath. No more "What changed" button.
- **What changed** shows a file's actions (Open, Side by side, Restore) as one quiet line, never as tall buttons in a narrow pane.

### Fixes

- The To do view's rows keep their height under the pointer; the circle marks a TODO done.
- A line of maths starting with "=" is no longer taken for a heading.
- Icons that appeared down the side while you worked could stay invisible.

## 0.2.0 · 19 October 2026

### The assistant

- **Questions in a panel.** When the assistant needs you to decide something, it asks in a panel where you type: a choice by its number, several at once, yes or no, or your own words, one question at a time, with a review before you send. It works with every assistant.
- **Effort, beside the model.** Choose how hard the model thinks: Claude Code's effort, Codex's reasoning effort, or an OpenCode model's variants. It's kept for each model, and `/effort high` sets it from the message box.
- **Ask it to change Typst Studio.** "Switch me to Claude Code with its default model", "make the text bigger", "put a ruler at 80": the assistant does it with Typst Studio's own tools. A new permission, *Change Typst Studio's settings* (Allow, Ask or Never), says whether it asks you first. It can't change what it may do: that's yours, in Settings.
- **See who's working.** "Claude is thinking…", "Codex is writing…", words that change while it waits, a tip once a turn runs long, and a small animation for each step.
- **Options asks if you're done** once you've picked an option, and keeps your pick in the version it saves.

### Your writing style guide

- **Interview me.** Answer a few rounds of questions about your book, with answers to pick from, and the assistant writes the guide from them. It's the first choice while a book is short.
- **Templates to start from:** classic fiction, a friendly textbook, a picture book, a research paper, rules and reference, a programming book, or blank. Each is shown beside the guide its sample book has.
- **Draft from my chapters** no longer asks about the guide itself, and runs as a task of its own; the guide opens in the editor when it's written.
- **Redraft…** when the guide isn't quite right. The rules you wrote or changed yourself stay.
- **It learns from your rewrites.** Drafting looks in History for the assistant's passages you rewrote by hand, and turns what they have in common into rules ("use, not utilize").

### Books

- **Export EPUB** for Apple Books, Kobo, Google Play and Kindle (which takes EPUB now; MOBI is gone). Reflowing text for prose; every page exactly as typeset for picture books, papers and books full of math. It picks for you, says what didn't carry over, and every sample's EPUB passes epubcheck.
- **Picture books set their words on the pictures:** full-page and two-page pictures out to the bleed, words on a soft panel, and sound words drawn on the picture. The sample is now *Luca's Wonderful Brain*.

### Editing

- **Long lines:** wrap at the edge, at a column, or not at all, with rulers at the columns you choose (Settings ▸ Editor).
- A click in the preview puts the text near the top of the editor, with what follows in view.
- History's versions show that they fold out: a chevron, the files they changed under a guide line, and what a click opens.

### Fixes

- Check for updates, and a version you skipped, are remembered across launches.
- Typst Studio needs macOS 13 or later, and says so on an older Mac instead of opening a broken window.

## 0.1.0 · 18 October 2026

The first release.
