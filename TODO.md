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

- [ ] icons still feel weird and awkward. (look at top right as well as close icon for settings page at 67% zoom to see how weird things look)

- [x] when looking at what changed, the zindexs are wrong. preview shows up ONTOP of the what changed modal

- [x] cmd k , w should kill all tabs, but it doesnt.

- [x] can we make comments be grouped by file?

- [ ] the icons in the file view to expand directories is TINY at 67%, far tinier than they should be... use vs.code icons for comparison...

- [ ] the "selected" blue box with dashes doesnt look very pretty. can we make this more elegant and useful and less odd?

- [ ] cmd + p for file browser ?

- [ ] update prompt to try to encourage consistent style ? specifically for figures? in this case, cetz diagrams i suppose?

- [ ] im confused where change istory is stored? is this living in a git repository? can i work backwards ? see deltas? that seems like a good idea, no?

- [ ] the menu system seems crowded and silly. we need to rethink and revamp the menus.

- [x] after asking a question, i have no way to resolve teh task and mark it as done... is there a way to do this im missing? if not we need to make sure thats doable?

- [ ] slash commands int he ai chatbxo to change modes, etc

- [ ] ability to resume. if i click stop, change models, i want to resuem and start again... i need to be able to resume (if the box is empty and we aborted the request)
