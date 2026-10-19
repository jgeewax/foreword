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

- [x] allow export to epub, mobi, etc (Book ▸ Export EPUB…: reflowing text for prose, fixed layout (every page as typeset) for picture books, papers and math-heavy books or when reflowing fails, or your pick; it says which and what didn’t carry over. Kindle takes EPUB now; MOBI is gone. Every sample’s EPUB passes epubcheck.)

- [x] interview style writing guide (ask me questions and we'll build a writing style guide) (Interview me, on the style bar (first choice while the book is short) and in the palette: a few rounds of questions about the book in the question panel, then the guide from your answers.)

- [x] writing style guide templates to pick from , also include these in the same docs that we let people try out (Start from a template (and Writing Style Guide Templates… in the palette): Classic fiction, Friendly textbook, Picture book, Research paper, Rules and reference, Programming book and Blank, one suggested for the book; each shows its sample’s guide beside it, and each sample’s guide names its template.)

- [x] history tab shouldnt always be stuck at the bottom. it shoudl be its own tab (separate from the git tab) (History is a view of its own in the activity bar now, after Files, like every other view. The "below the files" setting is gone, and an old one in the settings file is ignored.)

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
