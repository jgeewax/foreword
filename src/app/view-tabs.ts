// Tabs that aren't files, beside the files' tabs as in VS Code: Typst basics,
// and what changed. Their keys share the tab list with the files' paths
// (`StudioState.tabs`), so ordering, ⌘W, ⌃⇥ and the tab menu treat them alike.

export const GUIDE_TAB = 'view:guide';
/** What changed, in a tab each, as VS Code's diff editors: History's version, one file of it, and Source Control's. */
export const HISTORY_TAB = 'view:history';
export const HISTORY_FILE_TAB = 'view:history-file';
export const GIT_TAB = 'view:git';

/** A tab that shows something other than a file (no file's path starts with "view:"). */
export const isViewTab = (tab: string) => tab.startsWith('view:');

/** The files among `tabs`. */
export const fileTabs = (tabs: string[]) => tabs.filter((t) => !isViewTab(t));
