// Tabs that aren't files, beside the files' tabs as in VS Code: Typst basics,
// and what changed. Their keys share the tab list with the files' paths
// (`StudioState.tabs`), so ordering, ⌘W, ⌃⇥ and the tab menu treat them alike.

export const GUIDE_TAB = 'view:guide';

/** A tab that shows something other than a file (no file's path starts with "view:"). */
export const isViewTab = (tab: string) => tab.startsWith('view:');

/** The files among `tabs`. */
export const fileTabs = (tabs: string[]) => tabs.filter((t) => !isViewTab(t));
