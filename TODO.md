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

- [x] make the loading spinners and text more interesting to feel less slow. e.g., waiting on the model "Claude is thinking..." or "Codex is thinking...", and better animations, something more entertaining so that we dont feel liek this is taking SO LONG because it really can be slow.

- [x] in option mode, when i pick an option (use this), it shoudl prmpt me to see if the task is done

- [x] hisotry left panel is a bit confusing because i dont know what ot expect when i click on stuff. its not obvious that it would expand and collapse. lets use visual indicators in that panel to make it more obvious
