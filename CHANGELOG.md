# Changelog

What's new in each version of Foreword (called Typst Studio up to 0.3.0). The release build uses each version's section as its release notes, which the app's update dialog shows under What's new.

## 0.8.2 · 24 October 2026

### The assistant

- **Switch assistants halfway through a task.** Choosing another assistant is like choosing another model: the chat stays where it is, and the task carries on. Start with Claude Code, switch to Codex, and Codex gets the conversation so far with your next message. Switch back, and Claude Code picks up its own conversation, told only what was said since.
- **Every task in one list.** The Tasks view and the menu at the top of the assistant pane list all your tasks, whichever assistant they were with, and a task opens with the assistant you're using now.

## 0.8.1 · 24 October 2026

### The assistant

- **Ask mode answers as a card.** It starts by giving your question back as it understood it, so you see at once whether it took you right, and *Not quite?* lets you say it again. When a question could mean two things, it answers the likelier one and offers the other: *Or did you mean…?*, with *Answer that instead*. Then the answer, in a sentence or two, and how sure it is (certain, fairly sure, or a guess) with what it checked.
- **The places that show it, quoted from your book.** Each place it points to is quoted from your own text, the words you asked about marked, and pinned on a map of the chapter; click one to go there. Its reasoning follows, then what it would change, word by word: *Make this change* makes it in your text (⌘Z undoes it), and *Go ahead* still makes them all. Under the card, a follow-up or two to ask next, one click each.
- **Charts in the chat.** When numbers compare, such as how long each chapter is or how often a name comes up, the assistant can draw them as bars, the ones it means in colour. Rest the pointer on a bar for its value.

## 0.8.0 · 24 October 2026

### Spelling and grammar

- **Spelling and grammar as you type, as Word does it.** A red squiggle under a misspelling and a blue one under a grammar slip. Click it, or right-click, for suggestions; a fix is one ⌘Z. It's all checked on your Mac: no AI, and nothing is sent anywhere. Your sentences, headings, captions and footnotes are checked; maths, labels and settings aren't. Comments and the names in code are spelled too, so `tmie_zone` suggests `time_zone`. The word you're typing waits until you've finished it. ⌘; goes to the next mistake, and the status bar counts them.
- **Your book's own words.** *Add to Book Dictionary* keeps a name like Utterson with the book, for everyone who works on it; *Add to My Dictionary* keeps a word for all your books. *Ignore* lasts too, kept with the book, for that one sentence: the same words elsewhere are still checked. Settings ▸ This book ▸ Spelling lists what you've ignored, each with *See again*.
- **Other languages.** A passage marked as French, say (*Set Language* on the right-click menu), is checked with the Mac's own French dictionary, one of the forty or so it comes with. In English the Mac's dictionary is a second opinion, so a word you've taught your Mac in another app isn't flagged here. A book checked as American but spelled the British way ("colour", "theatre") is offered British English, once.
- **A Spelling view for the whole book** (Edit ▸ Show Spelling and Grammar, ⇧⌘;). Every word the dictionary doesn't know, listed once with how often it comes up, the most frequent first, so a character's name goes into the book's dictionary in one click. Then the grammar, chapter by chapter. A click goes to the mistake.
- **Settings ▸ Spelling & Grammar** turns each check on or off, sets the language for books that don't say, skips words in capitals or with numbers in them, and has your dictionary and every grammar rule.

### The assistant

- **A Tasks view in the sidebar**, after History, with an amber badge when a task needs you. Tasks are listed as Needs you, At work, Open and Done (by day, then by month), and each says what's happening, or the mode it ran in and the chapters it changed. A click opens the task in the assistant pane and folds out what it changed, as a version in History does. Search them, show just *This chapter*'s, and mark done the open tasks that haven't moved in two weeks.
- **Ask about a selection in your own words.** In the bar under a selection, Explain gives way to **Ask**: type what you want to know, or pick one of the usual questions (Explain it, Is it clear?, Check the facts, What's weakest?, Does it fit?, and Against my style guide when the book has one). It's answered in Ask mode, so a question never changes the book. *Ask in chat* is now **Add to chat** (⌘I), and it leaves the mode as it is.
- **Options stay with their passage.** *Use this* puts an option where the passage is now, even if you've moved the cursor, selected something else, or written above it since you asked. If you've changed the passage itself, the card shows your changes and offers *New options for it as it is*, *Replace mine anyway*, or *Cancel*. A follow-up such as "shorter", with nothing selected, is about the same passage.

### The editor

- **⌘-click a reference to go to what it points to.** Hold ⌘ over `@ch:vectors` and it's underlined as a link, showing the heading, figure or table it points to; ⌘-click opens that chapter at the spot. It works whether the preview shows the whole book or one chapter. A citation opens the bibliography at its entry.
- **A reference that points nowhere no longer stops the preview.** Mistype `@ch:vectrs` and it shows on the page in red, while the rest of the book carries on typesetting. The editor underlines it and suggests the right one: "Did you mean @ch:vectors?". Click the red reference on the page to find it in your text. Export PDF asks first when a reference points nowhere.
- **A TODO's bar stays up while the cursor is on its line**, so *Ask the assistant to do it* and *Done* are there as you arrow onto it, not only under the pointer. Escape puts it away.

### The sidebar

- **Contents keeps up with you.** In a subsection, the section it belongs to is lit. Switch to another chapter and the list scrolls to it.

### Fixes

- History takes far less room on your Mac. It now tidies its saved versions away once a day.

## 0.7.0 · 24 October 2026

### The assistant

- **A bar under what you select: Revise, Options, Explain, Comment, Ask in chat.** Select a passage, in the text or in the pages, and a bar comes up under it, each button in the colour of what it does. **Revise** and **Options** open a box to say how, with the usual requests a click away: Tighten, Proofread, Clearer, Simpler words, Expand, and Match my style guide when the book has one. A note under the passage follows the request, *Revising…* with Stop, then *Revised −11 words* with Undo and Show change, the words it changed. **Explain** puts the passage in plain words and changes nothing, **Comment** leaves a comment, and **Ask in chat** (⌘I) takes the passage to the chat with the cursor in the box. Over a Typst error, **Fix error** comes first. The bar sits under the end of the selection, so it never covers what you're reading, and it takes the place of the Comment bubble.
- **Places in a reply are links to the editor.** When the assistant points to a line, as `chapters/one.typ:42` or "one.typ, lines 42–48", a click puts the cursor on that line, or selects the lines. A file's name written as `code` opens the file. Only the book's own files are links, so "10:30" never is.
- **Each mode keeps its own assistant, model and effort.** Discuss with Claude Code and Write with Codex, say: choosing a mode brings back what you last used in it, and the mode menu shows each one's. When the chat moves to another assistant this way, it's given the turns it hasn't seen.
- **Foreword's icon and name** sit over the assistant's welcome in a new chat.

### The editor

- **⌘-click a name to go to where it's defined, as in VS Code.** Hold ⌘ over `#key-idea`, or anything else the book defines, and it's underlined as a link, with its definition and the comments above it under the pointer. ⌘-click opens its file at the definition. Typst's own functions, like `#figure`, are part of Typst, so they aren't links.
- **⌘-click a file's name to open it.** The same goes for a name in quotes: `#include "chapters/one.typ"`, `image("figures/map.png")`, a bibliography. With ⌘ held it's underlined, and the pointer shows how the file starts. A Typst file opens in its tab; a picture or PDF opens in Preview. Pictures open in Preview from Files too, where before they couldn't be opened.
- **Rest the pointer on a TODO for what you can do with it.** Over a `// TODO` or `FIXME` comment, or a `#todo`, a small bar offers *Ask the assistant to do it* (*to fix it* for a FIXME), *Done*, and *All 12 TODOs* when there are others. Right-clicking the line offers the first two.
- **⌘Z takes back Done on its own.** Before, it took back the TODO along with what you'd typed just before. The same goes for every change Foreword makes to an open file, like a review comment put back.

### Fixes

- Codex named nearly every task "Typst book editing assistant", after Foreword's instructions. It names them after what you asked now, like "Clarify Typst eigenvector derivation".
- New task (the button, ⌘T or `/new`) and Done left the cursor nowhere. They put it in the message box now, ready to type.

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
