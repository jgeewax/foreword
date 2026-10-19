// The command palette (⇧⌘P, or ">" typed in Go to File), as VS Code's:
// everything the app does, found by name. Each command is filed under its
// menu in the menu bar (File, Edit, View, Book…), or under the pane it comes
// from when it isn't in one (Source Control, Preview, Code). It shows its
// shortcut, and it's listed only when it applies: Save with a file in front,
// Stop while the assistant works, Push with something to push.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { errorMessage, ipc } from '../lib/ipc';
import { wordMatch } from '../lib/fuzzy';
import { baseName, tildePath } from '../lib/paths';
import { AGENT_MODES, modeConfig } from '../services/agent/modes';
import { uncommitted } from './source-control';
import type { Studio } from './studio';

export type Command = {
  /** Stable (recently used commands are remembered by it): the menu bar item's id, when it has one. */
  id: string;
  /** Its menu in the menu bar, else the pane it's from. */
  category: string;
  title: string;
  /** Shown after the title, quieter: the folder of a recent book, what a mode does. */
  detail?: string;
  /** Its shortcut, as the menus write it (a chord's keys apart: "⌘K ⌘W"). */
  keys?: string;
  /** Other words it's found by: "reload" finds Revert File. */
  keywords?: string[];
  /** Whether it applies now; it isn't listed otherwise. */
  when?: () => boolean;
  run: () => unknown;
};

/** "File: Save": what the palette shows and matches. */
export const commandLabel = (c: Pick<Command, 'category' | 'title'>) => `${c.category}: ${c.title}`;

type Spec = Omit<Command, 'category'> & {
  /** It works without a book open (the welcome screen). */
  anywhere?: boolean;
};

/** Every command the palette knows, whether or not it applies now (see `available`). */
export function paletteCommands(studio: Studio): Command[] {
  const s = () => studio.state;
  const book = () => !!s().workspace;
  /** The file in front (not a tab that isn't a file). */
  const front = () => (s().viewTab ? null : s().active);
  const file = () => !!front();
  const typ = () => !!front()?.endsWith('.typ');
  const selection = () => file() && !(studio.editor?.getSelection()?.isEmpty() ?? true);
  const agentReady = () => s().agent.status === 'ready';
  const idle = () => agentReady() && !s().agent.running;
  const repo = () => s().git.repo;
  const gitIdle = () => !!repo() && !s().git.busy;
  const errors = () => s().problems.errors > 0;
  const hasCode = () => s().code.cells.length > 0 || s().code.setUp;

  /** A menu bar item: it does what the menu does. */
  const menu = (id: string, title: string, more: Omit<Spec, 'id' | 'title' | 'run'> = {}): Spec => ({ id, title, ...more, run: () => studio.menuCommand(id) });
  /** One of the editor's own actions (Monaco's), on the file in front. */
  const editor = (id: string, title: string, keys?: string, keywords?: string[]): Spec => ({ id, title, keys, keywords, when: file, run: () => studio.editorAction(id) });

  const groups: [string, Spec[]][] = [
    [
      'File',
      [
        menu('new-book', 'New Book…', { keys: '⇧⌘N', anywhere: true }),
        { id: 'open-sample', title: 'Open a Sample Book…', keywords: ['example', 'demo'], anywhere: true, run: () => studio.openNewBook('sample') },
        menu('new-chapter', 'New Chapter…', { keys: '⌥⌘N' }),
        menu('new-file', 'New File…', { keys: '⌘N' }),
        { id: 'new-folder', title: 'New Folder…', run: () => studio.newFolder() },
        { id: 'new-window', title: 'New Window', keys: '⌥⇧⌘N', anywhere: true, run: () => ipc.windowNew() },
        menu('open-book', 'Open Book…', { keys: '⌘O', keywords: ['open folder', 'project'], anywhere: true }),
        ...s()
          .recent.filter((r) => r !== s().workspace?.root)
          .map(
            // Found by the book's folder name; its whole path would match almost anything.
            (r): Spec => ({ id: `open-recent:${r}`, title: `Open Recent: ${baseName(r)}`, detail: tildePath(r), anywhere: true, run: () => studio.openWorkspace(r) }),
          ),
        menu('go-to-file', 'Go to File…', { keys: '⌘P', keywords: ['quick open', 'chapter'] }),
        menu('save', 'Save', { keys: '⌘S', when: file }),
        menu('save-all', 'Save All', { keys: '⌥⌘S', when: () => Object.values(s().dirty).some(Boolean) }),
        { id: 'save-without-formatting', title: 'Save Without Formatting', when: typ, run: () => studio.save(front(), { format: false }) },
        {
          id: 'revert-file',
          title: 'Revert File',
          keywords: ['reload from disk', 'discard changes', 'revert to saved'],
          when: () => !!front() && (!!s().dirty[front()!] || !!s().conflicts[front()!]),
          run: () => studio.revertFile(),
        },
        menu('close-tab', 'Close Tab', { keys: '⌘W', when: () => s().tabs.length > 0 }),
        menu('reopen-tab', 'Reopen Closed Tab', { keys: '⇧⌘T' }),
        { id: 'close-other-tabs', title: 'Close Other Tabs', keys: '⌥⌘T', when: () => s().tabs.length > 1, run: () => studio.closeOtherTabs() },
        { id: 'close-saved-tabs', title: 'Close Saved Tabs', keys: '⌘K U', when: () => s().tabs.some((t) => !s().dirty[t]), run: () => studio.closeSavedTabs() },
        { id: 'close-all-tabs', title: 'Close All Tabs', keys: '⌘K W', when: () => s().tabs.length > 0, run: () => studio.closeAllTabs() },
        { id: 'copy-path', title: 'Copy Path', keys: '⌘K P', when: file, run: () => studio.copy(studio.absolutePath(front()!), 'Path copied') },
        { id: 'copy-relative-path', title: 'Copy Relative Path', when: file, run: () => studio.copy(front()!, 'Path copied') },
        { id: 'reveal-in-finder', title: 'Reveal in Finder', keys: '⌘K R', when: file, run: () => studio.reveal(front()!) },
        { id: 'reveal-book', title: 'Reveal Book Folder in Finder', run: () => studio.reveal('') },
        { id: 'rename-file', title: 'Rename File…', when: file, run: () => studio.renamePath(front()!) },
        { id: 'duplicate-file', title: 'Duplicate File', when: file, run: () => studio.duplicate(front()!) },
        { id: 'trash-file', title: 'Move File to Trash…', keywords: ['delete'], when: file, run: () => studio.trashPath(front()!) },
        { id: 'use-as-main', title: 'Use as Main File', keywords: ['entry point'], when: () => typ() && front() !== s().workspace?.entry, run: () => studio.setEntryPoint(front()!) },
        { id: 'file-history', title: 'History of This File', when: file, run: () => studio.showFileHistory(front()!) },
        { id: 'refresh-files', title: 'Refresh Files', run: () => studio.refreshFiles() },
      ],
    ],
    [
      'Edit',
      [
        menu('find', 'Find', { keys: '⌘F', when: file }),
        menu('replace', 'Find and Replace', { keys: '⌥⌘F', when: file }),
        menu('format-document', 'Format Document', { keys: '⌥⇧F', keywords: ['typstyle', 'tidy'], when: typ }),
        menu('add-comment', 'Add Comment…', { keys: '⌥⌘M', keywords: ['review'], when: selection }),
        editor('editor.action.gotoLine', 'Go to Line…', '⌃G'),
        { id: 'next-error', title: 'Go to Next Error', keywords: ['problem'], when: errors, run: () => studio.nextProblem() },
        { id: 'fix-error', title: 'Fix Next Error with the Assistant', keywords: ['problem'], when: () => errors() && idle(), run: () => studio.fixProblem() },
        editor('editor.action.commentLine', 'Toggle Line Comment', '⌘/'),
        editor('editor.action.blockComment', 'Toggle Block Comment', '⌥⇧A'),
        editor('editor.foldAll', 'Fold All', '⌘K ⌘0', ['collapse']),
        editor('editor.unfoldAll', 'Unfold All', '⌘K ⌘J', ['expand']),
        editor('editor.action.trimTrailingWhitespace', 'Trim Trailing Whitespace', '⌘K ⌘X'),
        editor('editor.action.transformToUppercase', 'Transform to Uppercase'),
        editor('editor.action.transformToLowercase', 'Transform to Lowercase'),
        editor('editor.action.transformToTitlecase', 'Transform to Title Case'),
        editor('editor.action.sortLinesAscending', 'Sort Lines Ascending'),
        editor('editor.action.sortLinesDescending', 'Sort Lines Descending'),
        editor('editor.action.joinLines', 'Join Lines', '⌃J'),
        editor('editor.action.deleteLines', 'Delete Line', '⇧⌘K'),
        editor('editor.action.copyLinesDownAction', 'Copy Line Down', '⌥⇧↓', ['duplicate line']),
        editor('editor.action.moveLinesUpAction', 'Move Line Up', '⌥↑'),
        editor('editor.action.moveLinesDownAction', 'Move Line Down', '⌥↓'),
        editor('editor.action.selectHighlights', 'Select All Occurrences', '⇧⌘L', ['multiple cursors']),
        editor('editor.action.insertCursorAtEndOfEachLineSelected', 'Add Cursors to Line Ends', '⌥⇧I', ['multiple cursors']),
        editor('editor.action.smartSelect.expand', 'Expand Selection', '⌃⇧⌘→'),
        editor('editor.action.smartSelect.shrink', 'Shrink Selection', '⌃⇧⌘←'),
      ],
    ],
    [
      'View',
      [
        menu('toggle-sidebar', 'Toggle Sidebar', { keys: '⌘B' }),
        menu('toggle-preview', 'Toggle Preview', { keys: '⌥⌘P' }),
        menu('toggle-assistant', 'Toggle Assistant', { keys: '⌥⌘B', keywords: ['chat'] }),
        menu('show-files', 'Show Files', { keywords: ['explorer', 'sidebar'] }),
        menu('show-review', 'Show Review', { keywords: ['comments'] }),
        menu('show-history', 'Show History', { keywords: ['versions'] }),
        menu('show-tasks', 'Show Conversations', { keywords: ['tasks', 'chats'] }),
        menu('show-git', 'Show Source Control', { keywords: ['git'], when: () => !!repo() }),
        { id: 'show-code', title: 'Show Code Examples', when: hasCode, run: () => studio.revealSidebar('code') },
        { id: 'show-todos', title: 'Show TODOs', keywords: ['to do'], when: () => s().todos.length > 0, run: () => studio.revealSidebar('todos') },
        menu('show-in-preview', 'Show in Preview', { keywords: ['sync', 'jump'], when: typ }),
        menu('zoom-in', 'Zoom In', { keys: '⌘=', keywords: ['bigger', 'larger'], anywhere: true }),
        menu('zoom-out', 'Zoom Out', { keys: '⌘-', keywords: ['smaller'], anywhere: true }),
        menu('zoom-reset', 'Actual Size', { keys: '⌘0', keywords: ['reset zoom', '100%'], anywhere: true }),
        {
          id: 'full-screen',
          title: 'Toggle Full Screen',
          keys: '⌃⌘F',
          anywhere: true,
          run: async () => {
            const w = getCurrentWindow();
            await w.setFullscreen(!(await w.isFullscreen()));
          },
        },
      ],
    ],
    [
      'Book',
      [
        menu('export-pdf', 'Export PDF…', { keys: '⇧⌘E' }),
        menu('open-pdf', 'Open Exported PDF', { keys: '⌥⌘E' }),
        menu('print-mixam', 'Print with Mixam…', { keywords: ['printer'] }),
        menu('design-cover', 'Design Cover…'),
        menu('style-guide', 'Writing Style Guide'),
        { id: 'redraft-style-guide', title: 'Redraft Writing Style Guide…', keywords: ['style guide', 're-run', 'again'], when: () => s().styleGuide.exists && idle(), run: () => studio.redraftStyleGuide() },
        menu('name-version', 'Name This Version…', { keywords: ['history', 'milestone'], when: () => s().history.status === 'ready' }),
        menu('setup-code', 'Runnable Code Examples…'),
        menu('add-makefile', 'Add a Makefile…'),
        menu('book-settings', 'Book Settings…', { keywords: ['page size', 'fonts'] }),
      ],
    ],
    [
      'Preview',
      [
        { id: 'restart-preview', title: 'Restart Preview', keywords: ['reload preview', 'refresh', 'tinymist'], run: () => studio.restartTypst() },
        { id: 'preview-cover', title: 'Show the Cover', when: () => studio.hasCover() && s().previewTarget === 'book', run: () => studio.setPreviewTarget('cover') },
        { id: 'preview-book', title: 'Show the Book', when: () => s().previewTarget === 'cover', run: () => studio.setPreviewTarget('book') },
        { id: 'update-cover', title: 'Update Cover from Book', keywords: ['spine'], when: () => studio.hasCover(), run: () => studio.updateCoverFromBook() },
        { id: 'export-cover', title: 'Export Cover', when: () => studio.hasCover() && !s().exporting, run: () => studio.exportCover() },
      ],
    ],
    [
      'Assistant',
      [
        menu('new-task', 'New Task', { keywords: ['new conversation', 'chat'] }),
        menu('task-done', 'Task Done', { when: () => !!s().agent.sessionId && !s().agent.running }),
        menu('ask-selection', 'Ask About Selection', { keys: '⌘I', when: file }),
        { id: 'explain-selection', title: 'Explain the Selection', when: () => selection() && idle(), run: () => studio.explainSelection() },
        { id: 'options-for-selection', title: 'Three Versions of the Selection…', keywords: ['options', 'rewrite'], when: () => selection() && agentReady(), run: () => studio.optionsForSelection() },
        menu('fix-comments', 'Fix Review Comments', { when: () => idle() && s().review.comments.some((c) => c.status === 'open') }),
        menu('stop', 'Stop', { when: () => s().agent.running }),
        { id: 'resume', title: 'Resume', keywords: ['continue'], when: () => s().agent.stopped && !s().agent.running && !!s().agent.sessionId, run: () => studio.resume() },
        { id: 'compact', title: 'Compact the Conversation', keywords: ['summarize', 'context'], when: () => idle() && !!s().agent.sessionId, run: () => studio.compactTask() },
        ...AGENT_MODES.map(
          (mode): Spec => ({
            id: `mode-${mode}`,
            title: `Switch to ${modeConfig(mode).label} Mode`,
            detail: modeConfig(mode).description,
            when: () => agentReady() && s().agent.mode !== mode,
            run: () => studio.setMode(mode),
          }),
        ),
        {
          id: 'focus-composer',
          title: 'Write to the Assistant',
          keywords: ['message box', 'focus chat'],
          run: () => {
            studio.events.emit('show-agent-pane');
            studio.events.emit('focus-composer');
          },
        },
        { id: 'restart-assistant', title: 'Start the Assistant Again', keywords: ['opencode', 'reconnect'], when: () => s().agent.status === 'error', run: () => studio.startAgent() },
        menu('permissions', 'Permissions…'),
      ],
    ],
    ['Review', [{ id: 'clear-resolved', title: 'Clear Resolved Comments', when: () => s().review.comments.some((c) => c.status === 'resolved'), run: () => studio.clearResolved() }]],
    [
      'Source Control',
      [
        {
          id: 'git-commit',
          title: 'Commit…',
          keywords: ['git'],
          when: () => gitIdle() && uncommitted(repo()) > 0,
          run: async () => {
            const staged = (repo()?.staged.length ?? 0) > 0;
            const message = await studio.prompt({ title: staged ? 'Commit the staged changes' : 'Commit every change in the book', label: 'Message', okLabel: 'Commit' });
            if (message?.trim()) await studio.git.commit(message);
          },
        },
        { id: 'git-stage-all', title: 'Stage All Changes', keywords: ['git add'], when: () => gitIdle() && (repo()?.files.length ?? 0) > 0, run: () => studio.git.stage(['.']) },
        { id: 'git-unstage-all', title: 'Unstage All Changes', when: () => gitIdle() && (repo()?.staged.length ?? 0) > 0, run: () => studio.git.unstage(['.']) },
        { id: 'git-changes', title: 'What Changed', keywords: ['diff', 'git'], when: () => (repo()?.files.length ?? 0) > 0, run: () => studio.git.showWorking() },
        { id: 'git-pull', title: 'Pull', keywords: ['git'], when: () => gitIdle() && !!repo()?.upstream, run: () => studio.git.pull() },
        { id: 'git-push', title: 'Push', keywords: ['git'], when: () => gitIdle() && (!repo()!.upstream || repo()!.ahead > 0), run: () => studio.git.push() },
        { id: 'git-refresh', title: 'Refresh', keywords: ['git status'], when: () => !!repo(), run: () => studio.git.refresh() },
        { id: 'git-copy-branch', title: 'Copy Branch Name', when: () => !!repo()?.branch, run: () => studio.copy(repo()!.branch!, 'Branch name copied') },
      ],
    ],
    [
      'Code',
      [
        { id: 'code-run-all', title: 'Run All Code Examples', when: () => s().code.cells.length > 0, run: () => studio.code.runAll() },
        { id: 'code-run-stale', title: 'Run Code Examples Not Up to Date', when: () => s().code.cells.length > 0, run: () => studio.code.runAll({ onlyStale: true }) },
      ],
    ],
    [
      'Settings',
      [
        menu('settings', 'Open Settings', { keys: '⌘,', keywords: ['preferences'], anywhere: true }),
        { id: 'settings-editor', title: 'Editor Settings', keywords: ['text size', 'font', 'word wrap', 'rulers', 'column', 'marks', 'colour', 'color', 'preferences'], anywhere: true, run: () => studio.openSettings('editor') },
        { id: 'about', title: 'About Typst Studio', keywords: ['version', 'credits'], anywhere: true, run: () => studio.openAbout() },
        { id: 'check-updates', title: 'Check for Updates', keywords: ['update', 'upgrade', 'new version'], anywhere: true, run: () => void studio.checkForUpdates({ dialog: true }) },
        { id: 'settings-assistant', title: 'Assistant Settings', keywords: ['claude', 'codex', 'gemini', 'antigravity', 'opencode', 'sign in', 'preferences'], anywhere: true, run: () => studio.openSettings('assistant') },
        { id: 'settings-tools', title: 'Tools (Tinymist, Git)', keywords: ['preferences'], anywhere: true, run: () => studio.openSettings('tools') },
        { id: 'settings-file', title: 'Open the Settings File', keywords: ['json', 'config'], anywhere: true, run: () => studio.openConfigFile() },
        {
          id: 'toggle-format-on-save',
          title: `Turn Format on Save ${s().settings.formatOnSave ? 'Off' : 'On'}`,
          keywords: ['typstyle'],
          anywhere: true,
          run: () => {
            const on = !s().settings.formatOnSave;
            studio.updateSettings({ formatOnSave: on });
            studio.toast(on ? 'Typst files are formatted when saved.' : 'Typst files are saved as written.');
          },
        },
      ],
    ],
    ['Help', [menu('typst-guide', 'Typst Basics', { keywords: ['help', 'syntax', 'markup', 'guide'], anywhere: true })]],
    [
      'Window',
      [
        menu('prev-tab', 'Show Previous Tab', { keys: '⌃⇧⇥', when: () => s().tabs.length > 1 }),
        menu('next-tab', 'Show Next Tab', { keys: '⌃⇥', when: () => s().tabs.length > 1 }),
        { id: 'reload-window', title: 'Reload Window', keywords: ['refresh', 'restart'], anywhere: true, run: () => studio.reloadWindow() },
        { id: 'close-window', title: 'Close Window', keys: '⇧⌘W', anywhere: true, run: () => getCurrentWindow().close() },
      ],
    ],
  ];
  return groups.flatMap(([category, specs]) =>
    specs.map(({ anywhere, when, ...c }): Command => ({ ...c, category, when: anywhere ? when : () => book() && (when?.() ?? true) })),
  );
}

/** The commands that apply now. */
export const available = (commands: Command[]) => commands.filter((c) => c.when?.() ?? true);

export type CommandRow = {
  command: Command;
  /** commandLabel(command), and where the query matched in it (none for a keyword match). */
  label: string;
  positions: number[];
  /** One of the recently used commands. */
  recent: boolean;
};

/**
 * The palette's list. With nothing typed: the recently used commands (newest
 * first), then the rest by name. Otherwise those that match (the starts of
 * words, see `wordMatch`), best first, matched as "File: Save", as "Save"
 * alone, or by a keyword (which ranks a little lower); recently used ones a
 * little higher.
 */
export function rankCommands(commands: Command[], query: string, recent: string[]): CommandRow[] {
  const q = query.trim();
  const isRecent = new Set(recent);
  const row = (command: Command, positions: number[] = []): CommandRow => ({ command, label: commandLabel(command), positions, recent: isRecent.has(command.id) });
  if (!q) {
    const byId = new Map(commands.map((c) => [c.id, c]));
    const first = recent.map((id) => byId.get(id)).filter((c): c is Command => !!c);
    const rest = commands.filter((c) => !isRecent.has(c.id)).sort((a, b) => commandLabel(a).localeCompare(commandLabel(b)));
    return [...first, ...rest].map((c) => row(c));
  }
  const out: { row: CommandRow; score: number }[] = [];
  for (const c of commands) {
    const prefix = c.category.length + 2;
    const candidates = [
      wordMatch(q, commandLabel(c)),
      ((m) => m && { score: m.score, positions: m.positions.map((p) => p + prefix) })(wordMatch(q, c.title)),
      ...(c.keywords ?? []).map((k) => ((m) => m && { score: m.score - 4, positions: [] })(wordMatch(q, k))),
    ].filter((m) => !!m);
    if (!candidates.length) continue;
    const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
    out.push({ row: row(c, best.positions), score: best.score + (isRecent.has(c.id) ? 3 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.row);
}

const RECENT_KEY = 'studio.recentCommands';
const RECENT_MAX = 8;

/** The recently used commands' ids, newest first (this machine's, like VS Code's). */
export function recentCommands(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const withRecent = (recent: string[], id: string) => [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX);

/** Run a command from the palette: the palette closes first, and a failure is shown, not thrown. */
export function runCommand(studio: Studio, command: Command) {
  studio.closeQuickOpen();
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(withRecent(recentCommands(), command.id)));
  } catch {}
  void (async () => {
    try {
      await command.run();
    } catch (e) {
      studio.toast(errorMessage(e), 'error');
    }
  })();
}
