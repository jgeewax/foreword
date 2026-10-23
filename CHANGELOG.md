# Changelog

What's new in each version of Foreword (called Typst Studio up to 0.3.0). The release build uses each version's section as its release notes, which the app's update dialog shows under What's new.

## 0.6.0 · 23 October 2026

### The assistant

- **Formulas in the chat are set in your book's own notation.** The chat drew `$…$` formulas and Typst blocks, but set each one on its own, so a formula using the book's own functions (`$#mmat("R")_90^2$`, `#trythis`) showed as code. Now they're set with what the book's files import, as the book sets them: `#mmat` comes out bold and upright, and `#trythis` is the book's own box. The same goes for review comments, What changed and Options. An equation on lines of its own (`$ … $`) is drawn as one, centred, and a Typst block wraps at the chat's width like a paragraph.
- **Options shows each version as it would print.** Beside *Pick one to replace…* are two tabs, **Text** and **Preview**. Preview sets each option as a paragraph, as wide as its card, with emphasis, bold and maths as they'd print, so you can compare the three as text. Foreword remembers your choice.
- **A button's message shows what you asked for, not the brief behind it.** Write it, Go ahead, Fix This Error, Explain This, a TODO, Fix all, Interview me and the rest still send the assistant its full instructions. In the chat, your message shows the request as a step, "Explain this passage · in plain words", with what it's about a line each: the error, the TODO, each comment, each question and your answer. Your own messages show as you wrote them. The same goes for a conversation you open again later, History's name for the turn ("Agent: Write it") and a task's name.
- **"Always allow" for code it writes on the spot.** A command like `uv run python -c "…"` had no "always", since the code is new every time. Now it offers *Any Python code it writes, through uv*. A `>` inside quoted code is code, not writing a file, so `print(a > b)` no longer asks for that. And a rule you make in Settings or in Your rules answers a card that's already waiting on it.

### The window

- **Light or dark, as you choose.** Settings ▸ General ▸ Appearance ▸ Theme is *As the Mac is* (as before), *Light* or *Dark*, and the palette has all three. Before, Foreword was light only when the Mac was.
- **Dividers you can grab.** Each divider between the panes is a 4 px band in the title bar's colour, as in VS Code: the book's colour when it has one, lit as you point at it. It takes a press 6 px either side; before, it was a 1 px line, and a press just beside it on the editor's side also jumped the text.
- **One click is enough in a window that isn't in front.** With another app in front, or another Foreword window, the first click on a button (say, *Always allow* on a card that was waiting for you) only brought the window forward, and it took a second click to press it. Now one click does both, in the preview too.

### The preview

- **A click in the preview puts the source level with the click.** The editor scrolls so the line you clicked is at the height you clicked it, so your eye doesn't have to look for it. Before, it moved only when the line was off screen.

### The sidebar

- **Contents opens where you are.** Working in chapter 17, opening Contents scrolls the list so the section you're in sits in the middle.
- **Source Control's file names get the row.** A row's buttons take no room until you point at it, as in VS Code. In a narrow sidebar a name showed as "ch1…" beside empty space; now it shows whole.

### The editor

- **Formatting leaves one blank line at most in a row**, and none at the start or end of the file. Typst prints any number of blank lines as one paragraph break, so the book looks the same. Raw text and `/* comments */` keep theirs.

### Fixes

- With one chapter shown, a reference written `#ref(<label>)` to another chapter stopped the preview with "label does not exist". It shows in grey now, as `@label` did.
- The style guide's templates dialog cut its preview off on the right.

## 0.5.0 · 22 October 2026

### The assistant

- **Discuss mode, in place of Plan.** Plan answered every message with an outline, even a question that wasn't settled yet, like "should this be two volumes?". Discuss weighs it with you: two or three real directions, what each costs, and which it would pick. It argues against a weaker idea, points to the book's own lines, and keeps its turns short. **Write it** first says what you agreed, then writes it. `/plan` still works, as Discuss.
- **The assistant offers another mode** when one would suit what you asked, such as a question of direction asked in Write. Under its reply, *How should it go on?* offers two ways, each saying what it would do: *Talk it through* in Discuss, or carry on as you are. A pick switches the mode and goes on.
- **Done and New task sit on top of the message box**, beside the reply you've just read and the box you type in, with the context meter at the right. They stay put, and Done is greyed until there's something to finish. When a chat grows long, New task turns blue: long chats get slower. ⌘T starts a new task and ⇧⌘D marks this one done.
- **Slash commands anywhere in a message:** type / after a space ("rewrite this /options") and pick one. It runs, and the rest of your message stays in the box, ready to send in the new mode.
- **Revise the style guide** (Style guide ▸ Revise…, the palette, or Settings ▸ This book): say what should change ("less formal", "never use semicolons"), and the assistant changes just that in `WRITING_STYLE.md`, keeping every other line word for word. What you say after a draft, redraft or interview changes the guide the same way, rather than writing it all again.

### The preview

- **Show only the chapter you're in**, for a long book's speed: **Chapter** in the Book | Chapter | Cover switch above the preview, or Settings ▸ General ▸ Preview ▸ Shows. In a 743-page book, a keystroke took about half a second to show, and up to 5 seconds when it moved text onto another page; with the chapter alone it shows in under a tenth of a second. The book's own setup still applies, the chapter keeps its number, and a reference to another chapter shows in grey instead of stopping the preview. Open another chapter and the preview goes there.
- **A click in the preview rings the spot in the editor**, as a click in the editor rings it in the pages.

### The editor

- **⌘Z undoes your typing a step at a time again**, and ⇧⌘Z redoes it. Before, ⌘Z took out a run of recent typing all at once, then did nothing more.
- **Typing `_` `*` `$` `(` over a selection wraps it**, as in VS Code: `_word_`, `*word*`, `$word$`, `(word)`, and the same for `[` `{` `"` and backticks. The word stays selected.
- **Emphasis and strong text are italic and bold** in the editor, as in VS Code: `_word_` and `*word*` look like what they'll print.

### Contents

- **Collapse all and Expand all**, as in VS Code's Outline: fold every chapter down to its title to see just the chapters. A folded chapter is lit while you're anywhere in it, and what's folded stays folded while another view shows.

### Fixes

- Switching what the preview shows could fail with "tinymist exited during initialize".
- The text dialog's multi-line form sends on Return, as the chat does.

## 0.4.0 · 21 October 2026

**Typst Studio is now Foreword.** The name was taken by other projects, and the app is for writing a book, whatever it's set in. Your copy updates as before and keeps its books, settings and History. A book's settings move to their new names (`.foreword.json`, `.foreword/`) the first time it's opened. In Applications the app keeps its old file name until you rename it or download Foreword again.

### The assistant

- **Ask mode**, after Write: questions and talking things over, answered in the chat, with nothing changed or written anywhere. When you want what you discussed made, **Go ahead** switches to Write and makes it.
- **Plan answers in the chat.** Every mode is Foreword's own now, as Options always was. Claude Code used to go into its own plan mode, which could write the plan to a file outside the book and leave only a card in the chat. **Write it** still writes what you planned.
- **A command says what it runs** before you allow it ("lint.py, a Python script in this book"), with the command part by part, what each part is, and what it reaches beyond the book: the internet, files outside it, deleting.
- **Your "always" rules are yours, and can be undone.** *Always allow* offers rules from narrow to broad (exactly this command, the script with any arguments, any Python script), says what the broad ones would let in, and keeps the one you choose for this task, this book or every book. A command a rule let through says which rule; remove it there, in the permissions menu's **Your rules**, or in Settings. Before, an "always" went into Claude Code's or Codex's own settings, for every project, where Foreword couldn't show it or take it back.
- **The assistant's own steps in words:** its to-do list, a task handed to a helper, a skill, a tool from an MCP server, never a name like "exitplanmode (*)".
- **A welcome for each new task:** a greeting, your TODOs, and four things to try, with the style guide's offer in a quiet card below them.

### The preview

- **A long book keeps its place.** Back from another desktop or a sleeping screen, a long book's preview could start again at page 1: macOS had closed it for using too much memory (8 GB for a 739-page book). Now it keeps only the pages near the ones in view drawn (528 MB for that book), and whenever it reloads, it goes back to where you were. To keep every page drawn, use Settings ▸ General ▸ Preview ▸ Pages kept drawn.
- **The preview follows a diff** as it follows the editor: a click or an arrow key in What changed (History's, Source Control's or a file's) scrolls the pages there, on either side.

### Books that include their chapters in code

- **A chapter included in code**, as `#book-chapter(include "chapters/ch01.typ")` or `include` inside `#{ … }`, is a chapter everywhere now. Contents lists and numbers it, a reflowing EPUB starts a new part at it, and **New Chapter** adds the next one after the last, named like the others (`ch26_…` beside `ch25_…`). A preface or afterword without numbered headings doesn't push the chapter numbers up.

### The window

- **The status bar is VS Code's:** line icons in place of coloured dots, the book's items at the left and the session's at the right. It keeps its full size when you zoom out, clear of the window's rounded corners, and in a narrow window the file's name shortens instead of running into the rest.
- **The badges on the icons down the side** are at full strength, and 99+ stays inside the bar.

### Fixes

- A newline or a lone `&` in a command line could carry a second command past one you'd allowed. Each command on a line is checked on its own now.
- The assistant could edit the book's Foreword settings or its `.claude/` settings, and so give itself rules. Those edits always ask now.

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
