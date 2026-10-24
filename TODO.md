# TODO

- [x] Since we are live previewing by default, AI agents should NEVER EVER offer to compile

- [x] setting for whether its enter or command+enter in the ai chatbox. default o just enter (shift enter for new line)

- [x] the model selector is just a stock select dropdown. with a long list of models it gets crazy long. lets make a proper ui for selecting

- [x] Are we customizing the system prompt for this? we need ot be sure that we're not asking the models to write code via opencode. it needs to know its writing .typ files for a book

- [x] a settings UI for everything we can put into the .typst-studio.json file

- [x] advanced multi-option mode (ask the model to fix something, but give you 3 options)

- [x] setting for whether the model can make edits or not by default

- [x] a way to track history , maybe git? do lots of auto commits? or something else?

- [x] advanced mode for discussion and planning before writing. equiv to like claude codes plan mode. extra verbose, clear with the narrative and plan in short form, then expand from there

- [x] formalize and document the writing tone and style (sort of what we'd put into a AGENTS.md for style). help users build that WRITING_STYLE.md file and then make sure that's done

- [x] better onboarding (help people get going, lots of writers wont be familiar wiht typst)

- [x] book templates (childrens book, novel, text book, non-fiction book, etc)

- [x] option for history to be BELOW the files in the left side panel

- [x] slightly more color on the bottom bar (its all grey. icons + colors for agents ready vs unavailable)

- [x] model selector needs to be at the bottom, close to where we're typing, maybe right above the box? or near the mode selector?

- [x] modes for image / figure generation and editing versus text?

- [x] right clicking doesnt open context menus appropriately. we need to add that

- [x] work through a typical journey for users: create a new book, from a template maybe, maybe not. templates should be nvoels, non fiction books, let you customize sizes, childrens books, research paper (include popular conference templates), etc. for books with chapters we need a quick way to add chpaters.

- [x] how do we create/rename/etc files?

- [x] permissions picker thing should be at the bottom

- [x] permissions picker needs ot be more than just ask or allow all edits. lets give some stuff in between. can delete files? can rename files? can edit files? can read all files? can read other files on the machine outside this workspace? much fancier ui options

- [x] often in technical books we need ability to run code to verify output. e.g., if we're writing a book that uses python code, we need a way to have code snippets and make them runnable, test the output, etc. we need this system to be really good at that

- [x] i cant select text in the preview to chat about in the chatbox. i should be able to select from either the preview panel or the text panel

- [x] selecting text by default should appear and be used in the chatbox. i shouldnt have to hit cmd + i to use it. it should just ALWAYS be used, just like claude code. but we should see that selection somewhere in the chatbox (to let the user know we've got that selected), and then be able to preview it

- [x] TODOs in the text should show up somewhere in a panel. suggestions in the chatbox should include the todos we've written

- [x] right now i think all we get is one big long session. sometimes that's good, other times that's not good (context window rot is real). can we explore a way to make it so that we can have multiple "task-based" AI sessions on the right panel? maybe the AI focuses first on clarifying the goal, then at the end it tries to decide whether the goal is complete or not. asks the user. if the goal is done, offer buttons to start a new task (which marks asn finished and adds to history)

- [x] clicking on a suggested thing in the empty state should just START the ai call, not just prefill the textbox.

- [x] templates should always include a makefile or some sort of build option that outputs the final result

- [x] review mode, where i can add lots of comments across a chapter, section, paragraph, etc. and then we can address them all at once. we can explore this more to clarify what this should look like...

- [x] can we build an integration with a printer like Mixam to print the book?

- [x] cover designer: can we make a cover.typ and give people templates to make that work? aligning w the book templates? maybe this depends on the printer also? not sure if this is a good idea?

- [x] I want to be able to see what lines were read on a file by the ai

- [x] i want to be able to see what edits were made on a file by the ai

- [x] in history, i want to understand the delta from one version/commit to the next

- [x] add thinking animations, something to the user know things are happening in the ai chatbox

- [x] less engineery tool calls (read/grep => Reading Chapter 4 (lines 1-200) / Searching for "xyz")

- [x] i cant switch tasks and have multiple tasks going at the same time... thats aproblem. i need to be able to multi-task

- [x] easily see which tasks are in progress and group by those so i can easily switch around and see whats going on

- [x] allow chat interruptions, queueing by default, push to interrupt if needed

- [x] question answering like in claude code (prompt for multiple choice or free text, give access to those tools)

- [x] much more animation when things are in progress. it needs to feel extra fast.

- [x] a full settings UI, available from menu as well as teh teeny tiny gear icon, make it larger, not narrow panel.

- [x] basic tools for the common things so we dont have to approve shell commands (e.g., we should never have to approve an ls command. thats crazy)

- [x] review mode is ... iffy at best. we need to think this through more thoroughly

- [x] export pdf doesnt tellme where to save it..

- [x] the review tab is crushed, i can barely see the title

- [x] ability to open main.pdf to see the preview

- [x] the preview panels selector icons are TINY (got way too small. lets fix teh size of that ? make them always at least a certain size?)

- [x] indicate which CLIs we can run by default? like python, etc? maybe in a config file like how claude code does it ?

- [x] save all settings in the config file?

- [x] similar keyboard shortcuts for tab management as vs code (cmd+k w for closing all, etc)

- [x] the new task button is too far away and too small... how can we make it more prominent to start a new convo?

- [x] icons still feel weird and awkward. (look at top right as well as close icon for settings page at 67% zoom to see how weird things look)

- [x] when looking at what changed, the zindexs are wrong. preview shows up ONTOP of the what changed modal

- [x] cmd k , w should kill all tabs, but it doesnt.

- [x] can we make comments be grouped by file?

- [x] the icons in the file view to expand directories is TINY at 67%, far tinier than they should be... use vs.code icons for comparison...

- [x] the "selected" blue box with dashes doesnt look very pretty. can we make this more elegant and useful and less odd?

- [x] cmd + p for file browser ?

- [x] update prompt to try to encourage consistent style ? specifically for figures? in this case, cetz diagrams i suppose?

- [x] im confused where change istory is stored? is this living in a git repository? can i work backwards ? see deltas? that seems like a good idea, no?

- [x] the menu system seems crowded and silly. we need to rethink and revamp the menus.

- [x] after asking a question, i have no way to resolve teh task and mark it as done... is there a way to do this im missing? if not we need to make sure thats doable?

- [x] slash commands int he ai chatbxo to change modes, etc

- [x] ability to resume. if i click stop, change models, i want to resuem and start again... i need to be able to resume (if the box is empty and we aborted the request)

- [x] we need to render the formula blocks and etc when we're showing ti to users outside of the typst text editor. that means in comments, in diffs (?), and in the ai chatbox. it needs to respond with blocks of typst text and we need to render those block sin the ui

- [x] when we stop, you dont need ot meniton "change the model" . just say that the request was interrrupted.

- [x] add support for mutliple windows like vs.code?

- [x] if books get long, will we find the need for a single chapter preview at a time? (Answered in docs/decisions.md: not for speed. Measured 113/120 ms edit → preview on a 491-page book; ideas for focus and chapter PDFs in IDEAS.md.)

- [x] why is the model trying to run sed so muhc? "Allow shell sed -n '205,242p' chapters/ch01_what_is_a_vector.typ?" thats crazy. why not tell the model to use tools we have that dont need approval?

- [x] explain all tool calls in english. this is NOT A SYSTEM FOR ENGINEERS ITS FOR WRITERS

- [x] sometimes teh book root is inside a subdirectory (like src/). can we make our project config json file understand that ?

- [x] display // NOTE: and // TODO: , etc as something prettier in the editor UI ?

- [x] the only way to see what's going on right now is that one little drop down of the things that i have as tasks (sort of) for the ai chat box. can we build another tab perhaps of the conversational history? and things that are resolved or not?

- [x] can we confirm that ALL changes are tracked? if i use the chatbox and it changes a line, i want that tracked. then if i go and edit that line. i want that tracked AND I WANT THE AI AGENT TO KNOW ABOUT IT. so if i then ask it to look again, we should include this context that it wrote A, i modified it to be A', and now im asking for more iteration on that same chunk of text. make sense?

- [x] click on the current icon on the left nav should close the left nav. if im on the files tab and i click on it again, it should close the nav

- [x] use vs-code style icons for the left nav. files for example.

- [x] when i type im seeing lots of click indicators on the preview like i clicked 4x times. none of them are on the part that im typing in

- [x] update system prompt to encourage one sentence per line.

- [x] add support for git repository ... i need that for my existing books. they have git repos already.

- [x] add search inside settings screen

- [x] typst basics shouldnt show up overtop of AI panel, it should be a new tab that we can close like a file

- [x] pointer icon should become hand with finger for file tabs.

- [x] file tabs should have file type icon like vs code

- [x] git diffs and history diffs show up as a modal. i want them both to show up like regular files as a tab. if width allows, side by side. if not , inline diffs. just like vs code.

- [x] text content size and text size for controls in the UI is too big of a difference. the content text is too big. can we shrink that down a bit?

- [x] should we git ignore the sample book? or not? if so, add to .gitignore. fi not, clean the sample book up to be something more realistic. definitely add the pdf's to gitignore though.

- [x] add more book sizes (royal, etc). we shoudl have all the common ones for USA, Asia, and Europe.

- [x] settings for tools doesnt allow any configuration. what if we want to change which tinymist/opencode/git to use?

- [x] better sample books , one for each type. a novel in the public domain. the transformers paper (attn is all you need), etc.

- [x] can we make this wokr with gemini CLI rather than opencode? (settings choice)

- [x] can we make ti work with claude code CLI as well? and not just opencode? (settings choice)

- [x] can we make ti work with codex CLI as well? and not just opencode? (settings choice)

- [x] what about people who dont have opencode/claude/gemini/codex installed? can we package opencode or something with it so that they could eventually use our own API service?

- [x] tool finding ui needs work. a button to retrigger a search. choices from dropdown, chooser, textbox, grab from clipboard , etc. make this ui really elegant and useful

- [x] separate settings for your app config vs book config

- [x] thinking needs to be thinking time not waiting time. split them and show both in chat ui...

- [x] explore ayakaleaf pro (overleaf clone) for inspiration on ideas

- [x] make a public-facing website in a gh-pages branch

- [x] use gh to create a repository and push remotely to github. jgeewax/typststudio

- [x] get rid of checkboxes in the settings. those are dangerous. healthy UI controls only for settings.

- [x] for defaults, be explicit. you can say "this folder" but then must include the exact path so that its clear

- [x] add a way to change ai providers (opencode/codex/etc) from the ai chat panel

- [x] add a way to open the agent settings form the ai chat panel

- [x] add an X button on the preview pane to make it go away

- [x] lines assistant changed vs us changes should be a color picker with an option to do the same and show no difference. a toggle switch is wrong for this.

- [x] line coloring should be in a separate settings section. that is about the editor, not about which agent system youre using

- [x] im confused why opencode is in the tools section of settings while also in the agent section. i think it should probably go from the tool section?

- [x] no model picker in the agent settings for opencode. that is something we leave to just the ai chatbox

- [x] make settings -> files screen much prettier. its really ugly

- [x] add support for antigravity CLI? (or is that gemini?)

- [x] make a really pretty README.md for the github repo

- [x] in settings modal, X in top right corner isnt centered properly (visible when hovering)

- [x] editor settings for where long lines wrap (e.g. at 120) and vertical rulers at chosen columns (e.g. 80 and 120), as in vs code

- [x] we need a claude-code style question asking tool and UI in the chatbox. right now, when there are questions, the model seems to just dump them as text and i have to type to answer. i want multiple questions in order possible. for each one, suggest 3 options and give me a "other" option as well. this also includes multi-select checkbox (as well as other), y/n questions, etc. we have to be really thorough on this one.

- [x] ai chat bot should also be able to mess w settings inside typst studio. if i ask it to change my ai agent over to claude code w default model, it should do it. or change a setting, etc. lets expose the right set of tools for those things. (Typst Studio’s own tools, an MCP server every assistant gets: get and change settings, list models, set model and effort, switch assistant, set mode, open Settings. Changes to the assistant apply when its reply ends. It can’t change its own permissions, commands or programs: it opens Settings for you.)

- [x] make sure we can control the effort level for things like claude code or codex or opencode. its not always just the model, it also includes effort. that selector needs to be there too. (An effort menu beside the model: Claude Code’s effort, Codex’s reasoning effort, OpenCode’s model variants. Kept per model; /effort high works too.)

- [x] draft writing style button needs some hardening in the prompt and the prompt itself should be hidden from the user -- they dont give a shit about that. i shoudl never see a question like "Who reads it: is the guide for you and human editors or co-authors, for AI tools, or for both?" from clicking "draft writing style from chapters" button... think carefully about the user experience on how this works. (The chat shows only “Draft my writing style guide from the chapters.”; the brief goes as hidden instructions that rule out questions about the guide itself. It runs as its own task, and the guide opens in the editor when written.)

- [x] in option mode, when i pick an option (use this), it shoudl prmpt me to see if the task is done (Picking one asks “Option 2 is in. Is this task done?”; Yes saves the files first, so the named version has it.)

- [x] hisotry left panel is a bit confusing because i dont know what ot expect when i click on stuff. its not obvious that it would expand and collapse. lets use visual indicators in that panel to make it more obvious (Versions have the file tree’s chevron and fold out on a guide line; files show their icon and an “opens in a tab” hint; ⏎ and space work too.)

- [x] make the loading spinners and text more interesting to feel less slow. e.g., waiting on the model "Claude is thinking..." or "Codex is thinking...", and better animations, something more entertaining so that we dont feel liek this is taking SO LONG because it really can be slow. (“Claude is thinking…”, words that change while it waits, a tip once a turn runs long, and an animation for each phase.)

- [x] add support for book covers (cover.typ) (The cover designer already does this: Book ▸ Design Cover… makes cover/ (design.typ, spec.typ, cover.typ), with Book/Cover in the preview, Export Cover and Print with Mixam.)

- [x] what if writing style just isnt quite right? can we trigger a re-run? (Redraft… on the style bar (and in the palette), asked first: the assistant writes the guide again from the chapters, keeping the rules you wrote or changed yourself (History says which); History keeps the old one.)

- [x] when looking at writing style re-drafting, can we look at historical changes (AI wrote A, human revised to A') and use that to guide the writing style document? (Drafting and redrafting read History for the assistant’s passages you then rewrote (as you left them before an assistant next changed the file), and the guide turns what they have in common into rules: “use, not utilize”.)

- [x] we need a permission checkbox that allows settings changes just like editing files (Settings ▸ Permissions ▸ Change Typst Studio’s settings: Allow, Ask or Never, set by the presets, and for settings files from before it, as for editing files. At Ask every assistant shows one card first, Codex’s from Typst Studio itself; at Never the tools refuse and say why.)

- [x] clicking on the preview jumps to the text, but the scrolling isnt quite right. i think we should position at like 10-20% scrolled , not 50% (A click in the preview puts the text about 15% down the editor, so what follows is in view; text already in view stays put.)

- [x] sometimes i might have an agent working on the same area im working on. we need to make sure that this never trashes users input. it shoudl also not do what codex does, where if ive edited, and codex has changed something before ive hit save, then i have to manually figure out how to reconcile my changes (which might be in a diff part of the file) from theirs... (A change on disk to a file you're editing (the assistant's, git's, another editor's) is merged into it now: yours stays, unsaved typing included, and theirs goes in around it, word by word within a paragraph. Where you both changed the same words, yours stays and a card under it offers theirs: Keep mine, Use theirs, or Resolve with your assistant. A save you make while the assistant works stays, on disk too, even if it writes from an older copy. Undo changes keeps what you did since. And auto save, every 5 minutes (Settings ▸ Editor).)

- [ ] (NOT YET) shoudl we explore hwo we can handle multi-volume books? multi covers. multi main.typ, but references that still make sense, tooling that still makes sense, etc? Or is it better just to do a few diff book folders? do we get enough from the multi volume functionality to make it worth it?

- [x] allow export to epub, mobi, etc (Book ▸ Export EPUB…: reflowing text for prose, fixed layout (every page as typeset) for picture books, papers and math-heavy books or when reflowing fails, or your pick; it says which and what didn’t carry over. Kindle takes EPUB now; MOBI is gone. Every sample’s EPUB passes epubcheck.)

- [x] interview style writing guide (ask me questions and we'll build a writing style guide) (Interview me, on the style bar (first choice while the book is short) and in the palette: a few rounds of questions about the book in the question panel, then the guide from your answers.)

- [x] writing style guide templates to pick from , also include these in the same docs that we let people try out (Start from a template (and Writing Style Guide Templates… in the palette): Classic fiction, Friendly textbook, Picture book, Research paper, Rules and reference, Programming book and Blank, one suggested for the book; each shows its sample’s guide beside it, and each sample’s guide names its template.)

- [x] history tab shouldnt always be stuck at the bottom. it shoudl be its own tab (separate from the git tab) (History is a view of its own in the activity bar now, after Files, like every other view. The "below the files" setting is gone, and an old one in the settings file is ignored.)

- [ ] (NOT YET) should we add support for plugins more generally?

- [x] add support for color themeing like the peacock vs code plugin (Each book can have its own colour, as Peacock gives a folder: Settings ▸ This book ▸ Colour (or the palette's Choose a Colour for This Book…, Surprise Me with a Colour). The window wears it on the title bar, the activity bar and the status bar, in Peacock's own shades, so a glance tells one book's window from another's. It's saved in the book's .typst-studio.json, and a book whose .vscode/settings.json has a Peacock colour wears that one until it has its own.)

- [x] the text box in the header title bar thing is too small. we need to make it bigger. match VS.code size. (It's VS Code's size now: 22 pt tall, 38% of the window wide up to 600 pt, 12 pt text, with VS Code's hairline border. And like VS Code's, the title bar doesn't zoom out: below 100% its search box and pane toggles keep their 100% size (at 75% the box was 16 pt tall and 9 pt text), and above 100% they grow.)

- [x] when selecting chapters from the file palette modal, we show titles but not chapter numbers. We should include numbers ("17. Title of Chapter 17") (Go to File (⌘P) shows a chapter as "17. Its Heading", and typing the number finds it. The numbers are the book's: a prologue or preface whose heading isn't numbered gets none and doesn't push the rest up one, and the chat names chapters the same way. Headings written as #heading(numbering: none)[Prologue] show as their titles now too.)

- [x] when you hover on the left side panel icons, show help text so people know what they mean? (Hovering an icon in the activity bar shows a card beside it, as VS Code does: the view's name, a line on what it's for, and how things stand ("2 comments open", "3 files not committed"). It comes after a moment, then at once as you move down the icons, and on keyboard focus; it zooms with everything else, unlike the native tooltips it replaces.)

- [x] left side panel icons seem to have a lot of overlap. can we rethink and make sure these are teh best icons for the jobs ? (Each view has its own shape now: pages for Files, one comment for Review (the chat bubble that looked like it went with Conversations), a clock turning back for History, branches for Source control, </> for Code examples, ticked boxes for To do. Counts are small badges in each icon's empty corner, cut out with a ring, instead of covering a third of it. The views that are always there come first (Files, Review, History) and the ones that come and go after them, so icons don't move when a To do appears. And icons that appeared mid-session no longer fade in like a chat line (they could stay invisible).)

- [x] can we create a tutorial of some sort for first-time users? (A tour: nine short steps that dim the window but for one part at a time, with a card beside it saying what it's for: the files, the views down the side, the editor, the preview, the assistant, the search box, the status bar. It starts by itself the first time someone opens a book (when it's the only book they've opened), once; Help ▸ Take the Tour runs it again. → or ⏎ next, ← back, Esc leaves.)

- [x] in history, "What changed" is a button, which is a weird button to have. can you rethink the history panel and try to design something beautiful? (History is a timeline now: a rail from Now down to when history started, a node for each version coloured by who made it (your edits grey, the assistant's a purple ✦ as in the editor, a version you named an amber diamond, a restore a blue ↺), and each version's words, time, size and a five-block bar of what it added and removed. A click on a version shows what it changed in a tab: no What changed button. Its files and quiet actions (Compare with now, Undo these changes, Restore this version) fold out under it, and Name this version is on the Now node.)

- [x] in the diff viewer from "what changed", the "restore file" button is way too big and weird. this needs fixing. (A file's actions in What changed are quiet words with icons on one line: Open, Side by side, Restore. They never wrap into tall blocks; when the tab is narrow they move under the file's name, and the name comes before its folder so it isn't the part cut off. The single-file diff's Restore is the same.)

- [x] hovering over items in the todo list built from TODO: comments changes vertical height... thats never ok , it makes click targets complicated. can you rethink the todo tab? (Rows keep their shape under the pointer now: hover only changes colours, and Ask (✦) takes the line number's place in the same box. The circle at the left is Done (it takes the // TODO out; ⌘Z puts it back), dashed for a TODO that can only be removed in the editor. TODOs sit under their chapter's name, "3. On Relative Growings", with the file beside it.)

- [x] im confused by the conversations tab. isnt that not quite the right way to view this? shiouldnt ai stuff stay on the right panel? perhaps we should get rid of that? (Gone: the assistant's tasks are only in the assistant pane now, in its task menu (New task ▾), which also has the old view's right-click Mark Done and Open Again. View ▸ Assistant Tasks and the palette's Show Assistant Tasks open that menu, bringing the pane back if it was hidden, and while it's hidden a task that needs you puts an amber dot on its toggle in the title bar.)

- [x] add a search tab (Search is in the activity bar after Files, and Edit ▸ Find in Book… (⇧⌘F) opens it with the editor's selection in the box. It searches every chapter and text file as you type (open ones as they are in the editor), by words or a pattern, matching case or whole words if you like. Results sit under each chapter's name in reading order; a click opens the chapter with the match selected, and they follow the text as you edit. Replace All asks first, and History keeps the book as it was.)

- [x] what other left-side tab icons are missing? (Contents, the one a book missed most: the chapters in reading order, numbered as the book numbers them, each with its sections and about how many words, the place the cursor is under lit, a click to go there (View ▸ Contents too). With Search, the bar is Files, Contents, Search, Review, History, then Source control, Code examples and To do when the book has them. Left out on purpose: Problems (the status bar's error count goes to each one), a per-file Outline (the path bar above the editor has it), and VS Code's Run and Extensions, which a book doesn't need. A references view (labels, citations and where they're used) could come next.)

- [x] contents tab on the left doesnt seem to work if the chapters are inside src/chapters/chXX_name.typ.. no idea whats goingon but the contents tab is empty says 0 chapters 604 words, when i have a 700page book w 25 chapters... (The folder wasn't it: your main file includes its chapters in code, #book-chapter(include "chapters/…") and include "…" inside #{ … }, and the book only looked for #include "…" lines. It reads includes however they're written now, but not in comments, strings or raw text. What's included with heading numbers turned off around it (your preface, acknowledgments and afterword) isn't numbered, so What is a vector? is chapter 1 and the count is of numbered chapters: 25 chapters, about 189,260 words. The chat's names for your chapters, "“Determinants” (chapter 13)", come from the same list, so they work now too.)

- [x] can we make ai chatbot empty state better? its a bit black and white, busy, i want it to be elegant and clean and beautiful (A new task opens on a welcome in the middle of the pane: the assistant's sparkle on a soft glow of the editor's blue and purple, Good morning, afternoon or evening in a serif, and a line saying every change is marked and can be undone. Under it, your TODOs (with the chapter's name and line) and four things to try, each with an icon in the colour of what it does (blue explains, green proofreads, purple writes, Typst's teal for Typst questions) and a send arrow on hover. The style guide's offer is a quiet card below them, "Teach it your voice", with one button and the rest as links, instead of the four-button block above everything; once a conversation starts it's the bar under the header as before. The list of tips is one tip, a different one each new task. In light and dark.)

- [x] when im looking a ta diff, the preview doesnt jump around to show me how that rendered. can we make diffs tie to the preview the same way the actual chapter file does ? (It does now: in What changed (History's, Source control's, or one file's), a click or an arrow key in the diff scrolls the preview there, with the ripple, just as the cursor does in a chapter. Either side works, and an older version too: the line is found where it is in the book now, so a line changed since goes to what replaced it, and a removed one to where it was. In Words, a click on a passage goes to its first change.)

- [x] when i open the contents tab, it should scroll to the thing im currently inside (e.g., if im working on ch17, it should scroll to the spot in ch17 that im editing) (It does: opening Contents scrolls the list so the section the cursor is in (lit, as before) sits in the middle, or the chapter's row when its sections are folded. That's on picking the view and on showing the sidebar again with Contents in it. While it's open it stays where you scroll it.)

- [x] formatting on save should remove duplicate newlines that shouldnt be there. (It does: typstyle leaves up to two blank lines in a row in your text, so formatting now goes on to leave one at most, wherever there were more, and none at the start or end of the file. Typst renders any number of blank lines as one paragraph break, so the book looks the same. Raw text (`…`) and /_ comments _/ keep theirs as written. Format Document (⇧⌥F) does the same, and ⌘Z takes it off with the rest of the formatting.)

- [x] when i have to click "always allow", the first click never seems to wrok and i have to do it twice. (Fixed: it wasn't the card, it was the window. When Foreword isn't the window in front (you're in another app while the assistant works, or another Foreword window is), macOS gives the first click to the window just to bring it forward, and the page never got it. Any button did that; "Always allow" is where you'd come back to click. Now the click brings the window forward and presses the button, in the preview too. Checked with real clicks from behind a second window: before, the first click on "Always allow …" only raised the window and the second opened it; now the first does.)

- [x] do we have a light theme? if not, add it and add to settings? (There was one, but only when the Mac itself was set to Light. Now it's a choice of yours: Settings ▸ General ▸ Appearance ▸ Theme, As the Mac is (as before), Light or Dark, and in the palette, Use the Light Theme / Use the Dark Theme / Light or Dark as the Mac Is. It's the whole window: the editor's colours, the chat, every pane and the window's own buttons, at once, and it opens that way from the start. It's in the settings file as "theme", and the assistant can change it too.)

- [x] in option mode, can we have 2 tabs (one is the raw text, the other is the preview of how it'll render)? (Yes: Text and Preview, at the top of the options, beside "Pick one to replace …". Preview sets each option as it would print, as wide as its card so it wraps like a paragraph, emphasis and maths included, so you can compare the three as text. A reference to something elsewhere in the book (@ch-vectors) shows in grey, as the chapter preview does; an option that uses something only your book defines (a #sidenote of your own) says so and shows its text. Use this and Copy work the same in both, and the next options open in the one you used last.)

- [x] when i click inside the preview, if the target is already inside the scrolled area, we dont scroll the text view at all, we just move the cursor. id like the text position to match , or at the very elast, scroll to adjust so that its near the top of the screen, say 10% from the top? (The text position matches now: a click in the preview scrolls the editor so the line you clicked is level with where you clicked, whether it was in view or not, so your eye stays where it was, with the ripple on the word. On a long wrapped line it's the row the word is on. If it can't tell where the click was, the line goes 10% from the top. Near the start of a file it can only go as high as the file lets it.)

- [x] in the git view, the file names are cut off artificially short , lots more space but we're not using it. please chekc ? (They were: each row kept room for its Open File and Stage buttons even while they were hidden, plus gaps around an empty folder and a spacer, about 80 px of nothing, so at the narrowest sidebar a name got 32 px ("ch1…"). Now, as in VS Code, the buttons take room only on the row you point at, and the name has the rest: "ch1-vectors.typ" whole at the narrowest. The folder after it shows where there's room (cut short with …) and gives way before the name does, never as a sliver.)

- [x] when im trying to resize the split between text and preview, its really hard to grab the line. i often end up scrolling either teh text or the preview. make the grabbable area a bit bigger. (while we're at it, do what vs.code does with colors and make those dividers match the header color them. look at vs.code for an example here. (Each divider between the panes is a 4 px band in the title bar's colour now, as in your VS Code screenshot. With a book colour, the colour runs down from the title bar between the panes, and the divider you point at lights up in the activity bar's lighter shade, as Peacock's does. With no colour it's the title bar's grey, edged by the panes' borders. A divider now takes a press 6 px either side of its band; before, it was a 1 px line with about 4 px either side. On the preview's side the preview has the mouse, so there you grab the band itself. The text scrolling was a real bug: the editor's scrollbar sits right against the divider, and a press there moved the divider and also jumped the text to where you pressed. Now the divider keeps that press to itself. Beside a hidden pane there's no band (otherwise you'd see two side by side with the preview hidden), but you can still drag the pane back out from the edge.)

- [x] in the ai chatbox, the agent often replies with typst content (formula blocks, formatting, etc). can we give them a `typst block or something as a response in the prompt so that we can render this stuff? its really hard to understand whats going on without it. (The chat already drew $…$ formulas and showed what a `typst block makes, and the assistant was already told to use both. The trouble was your book's notation: its formulas use the book's own functions ($#mmat("R")_90^2$, $#vect("v")_1$, #trythis), and the chat set each one on its own, where those don't exist, so most showed as code. Now every formula and Typst block in the chat is set with what the book's files import, as the book sets it: #mmat comes out bold and upright, and #trythis is your purple Try this box. The same goes for review comments, What changed and Options ▸ Preview. An equation on lines of its own ($ … $) is drawn as one, centred, instead of as lines of code. A ```typst block wraps at the chat's width like a paragraph (it was one long line, squeezed to fit) and is set once it's all there. And the assistant is told its formulas are drawn in the book's notation.)

- [x] for our stock prompts, id rather not show the specific wording or prompt and instead show the action the user requested. it can be offputting to see how the sausage is made under the hood. can you make it so that for all the actions we take that lead to priompts (liek write it, or do what we discussed, etc) that we should it like its a tool call of sorts without just displaying the full prompt for that action? (Your message shows what you asked for now, as a step with its dot and colour, and the brief goes to the assistant out of sight. Write it says "Write it · what we agreed", Go ahead "make the changes we talked about", Explain This "Explain this passage · in plain words"; Fix This Error shows the error under it, a TODO the TODO, Fix with assistant each comment as you wrote it, and your answers to its questions each question with what you said. The same goes for Resolve with your assistant, a pick of the two ways on (in that mode's colour), the style guide's Draft, Redraft, Interview me and Revise, Ask the assistant to fix them (failing code examples), Ask it to edit instead and the Try asking starters. What you selected still shows as its chip, and your own messages show as you wrote them. It's the same in a conversation you open again later, in an earlier turn folded to a line, in a message waiting its turn (with no Edit: there's nothing of yours in it), in History's name for what the turn changed ("Agent: Write it", where it was the brief's first words), and in a task's name when Codex or Claude Code names it after its first message.)

- [x] i have ch17 open on my book. when i click the contents tab, im scrolled all the way to the top. ch17 and its stuff isnt shown on the screen at all andi have to scroll for a long time to make it visible. lets be certain the current chapter is visible when we open the tab or when we switch focus on files ? (Opening it did scroll to the lit row, but most of ch17 is under === subsections, which Contents doesn't list, so nothing was lit and it stayed at the top. Now the lit row is the section you're in (Complex eigenvalues for a line in Conjugate coordinates in the eigenbasis), and opening Contents puts ch17's row near the top with its sections under it, or the lit section in the middle when the chapter is too long to show whole. Bringing another file to the front while Contents shows scrolls to that one the same way. If the place is already on screen the list doesn't move, so clicking a row in it doesn't jump the list.)

- [x] if i click "use this" from the options agent, but ive since moved my cursor, it looks like it injects the text in the wrong place (where my cursor is now). the options agent needs to keep track of the text its swapping out. it needs to be resilient to cursors moving around, selections changing, and even text being added earlier or later, or changing the text that we asked for options about. if it cannot safely apply an option, we need to either allow the user to dangerously apply it (overwrite their work perhaps?) or ask them if thye want to re-evaluate given the changes that were made since the run started. (Two things went wrong. The passage was found again only by where it had been and its words, so after a line was added above it, or when the passage was just a cursor, the option could land somewhere else. And a follow-up in Options mode with nothing selected, like "shorter", was taken to be about wherever the cursor was when you sent it, so its options went in there. Now the passage is followed from the moment you ask: moving the cursor, selecting something else, writing above, below or right beside it, or switching files doesn't move it, and Use this puts the option where the passage is now. A follow-up with nothing selected is about the same passage as it is now, and so is a message that waits its turn. Picking another option, from this reply or an earlier one about the same passage, swaps out the one in use, and so does picking again after ⌘Z. If you've changed the passage yourself since asking, Use this changes nothing: under the option it shows your changes and offers New options for it as it is (three new ones, written from your version), Replace mine anyway (in red; ⌘Z brings yours back, and if you change it again before clicking, it shows you the new changes instead of overwriting them), or Cancel. If you deleted the passage, it offers Put it where it was.)
