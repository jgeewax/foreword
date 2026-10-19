import { useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { uncommitted } from '../app/source-control';
import { studio } from '../app/studio';
import { onContextMenu, showContextMenu, type MenuEntry } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { buildTree, type Node } from '../lib/tree';
import { CodePanel } from './CodePanel';
import { TodoPanel } from './TodoPanel';
import { ReviewPanel } from './ReviewPanel';
import { SourceControlPanel } from './SourceControlPanel';
import { HistoryPanel } from './HistoryPanel';
import { Icon, type IconName } from './icons';

function FileTree() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const active = useStore(studio.store, (s) => s.active);
  const dirty = useStore(studio.store, (s) => s.dirty);
  const tree = useMemo(() => buildTree(ws?.files ?? []), [ws?.files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>();
    for (const f of [ws?.entry, ...studio.state.tabs]) {
      if (!f) continue;
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('/'));
    }
    return open;
  });

  const toggle = (path: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const render = (nodes: Node[], depth: number) =>
    nodes.map((n) => (
      <div key={n.path}>
        <div
          className={`tree-row${n.path === active ? ' active' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={n.path}
          onClick={() => (n.dir ? toggle(n.path) : void studio.openFile(n.path))}
          onContextMenu={onContextMenu((): MenuEntry[] => {
            const folder = n.dir ? n.path : n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
            // Open, make something new here, change this item, then where it is.
            return [
              !n.dir && { label: /\.pdf$/i.test(n.path) ? 'Open in Preview' : 'Open', action: () => void studio.openFile(n.path) },
              'separator',
              (n.path === 'chapters' || n.path.startsWith('chapters/')) && { label: 'New Chapter…', accelerator: 'CmdOrCtrl+Alt+N', action: () => void studio.newChapter() },
              { label: 'New File…', action: () => void studio.newFile(folder) },
              { label: 'New Folder…', action: () => void studio.newFolder(folder) },
              'separator',
              { label: 'Rename…', action: () => void studio.renamePath(n.path) },
              !n.dir && { label: 'Duplicate', action: () => void studio.duplicate(n.path) },
              { label: 'Move to Trash…', action: () => void studio.trashPath(n.path) },
              'separator',
              !n.dir && n.path.endsWith('.typ') && n.path !== ws?.entry && { label: 'Use as Main File', action: () => void studio.setEntryPoint(n.path) },
              !n.dir && { label: 'History of This File', action: () => void studio.showFileHistory(n.path) },
              'separator',
              { label: 'Reveal in Finder', action: () => void studio.reveal(n.path) },
              { label: 'Copy Path', action: () => studio.copy(studio.absolutePath(n.path), 'Path copied') },
              { label: 'Copy Relative Path', action: () => studio.copy(n.path, 'Path copied') },
            ];
          })}
        >
          <span className={`twisty${n.dir && expanded.has(n.path) ? ' open' : ''}`}>{n.dir && <Icon name="chevronRight" size={16} />}</span>
          <span className={n.dir ? 'dir' : 'file'}>{n.name}</span>
          {n.path === ws?.entry && <span className="badge">main</span>}
          {dirty[n.path] && <span className="dirty-dot">●</span>}
        </div>
        {n.dir && expanded.has(n.path) && render(n.children, depth + 1)}
      </div>
    ));

  return (
    <div
      className="tree"
      // Book-level commands (cover, runnable code, Makefile) are in the menu bar's Book menu.
      onContextMenu={onContextMenu(() => [
        { label: 'New Chapter…', accelerator: 'CmdOrCtrl+Alt+N', action: () => void studio.newChapter() },
        { label: 'New File…', accelerator: 'CmdOrCtrl+N', action: () => void studio.newFile('') },
        { label: 'New Folder…', action: () => void studio.newFolder('') },
        'separator',
        { label: 'Refresh', action: () => void studio.refreshFiles() },
        { label: 'Reveal Book Folder in Finder', action: () => void studio.reveal('') },
      ])}
    >
      {render(tree, 0)}
    </div>
  );
}

const NewChapterButton = () => (
  <button className="icon" title="New chapter (⌥⌘N)" aria-label="New chapter" onClick={() => void studio.newChapter()}>
    ＋
  </button>
);

const RefreshButton = () => (
  <button className="icon" title="Refresh" onClick={() => void studio.refreshFiles()}>
    ↻
  </button>
);

/** Source Control's title bar, as VS Code's: Refresh, and the rest under ⋯. */
function SourceControlActions() {
  const repo = useStore(studio.store, (s) => s.git.repo);
  const busy = useStore(studio.store, (s) => !!s.git.busy);
  return (
    <>
      <button className="icon pane-action" title="Check again (commits made elsewhere)" aria-label="Refresh" onClick={() => void studio.git.refresh()}>
        <Icon name="refresh" size={16} />
      </button>
      <button
        className="icon pane-action"
        title="More actions"
        aria-label="More actions"
        disabled={!repo}
        onClick={() =>
          repo &&
          void showContextMenu([
            !!repo.upstream && { label: 'Pull', enabled: !busy, action: () => void studio.git.pull() },
            { label: 'Push', enabled: !busy && (!repo.upstream || repo.ahead > 0), action: () => void studio.git.push() },
            'separator',
            { label: 'What Changed', enabled: repo.files.length > 0, action: () => void studio.git.showWorking() },
            !!repo.branch && { label: 'Copy Branch Name', action: () => studio.copy(repo.branch!, 'Branch name copied') },
          ])
        }
      >
        <Icon name="more" size={16} />
      </button>
    </>
  );
}

export type View = 'files' | 'history' | 'code' | 'todos' | 'review' | 'git';

/** What the sidebar can show right now (Code, To do and Review only when they have something). */
function useViews() {
  const hasCode = useStore(studio.store, (s) => s.code.cells.length > 0 || s.code.setUp);
  const todoCount = useStore(studio.store, (s) => s.todos.length);
  // Review is always there: it's where comments are written about and checked.
  const hasReview = true;
  const reviewOpen = useStore(studio.store, (s) => s.review.comments.filter((c) => c.status === 'open').length);
  // Source Control, when the book is in a Git repository: how many files changed since the last commit.
  const hasGit = useStore(studio.store, (s) => !!s.git.repo);
  const gitChanged = useStore(studio.store, (s) => uncommitted(s.git.repo));
  const branch = useStore(studio.store, (s) => s.git.repo?.branch ?? null);
  return { hasCode, todoCount, hasReview, reviewOpen, hasGit, gitChanged, branch };
}

/** What an activity bar icon's hover card says: its name, what it's for, and how things stand. */
type Tip = { name: string; about: string; note?: string; keys?: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The hover card beside an activity bar icon, as VS Code's: it comes after
 * a moment, at once when moving from icon to icon, and on keyboard focus.
 * It's in the page (not a native tooltip), so it zooms with everything else.
 */
function useViewTips() {
  const [shown, setShown] = useState<{ id: string; tip: Tip; top: number; left: number } | null>(null);
  const timer = useRef(0);
  // When a card last closed: the next icon's comes at once if that was a moment ago.
  const closed = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (id: string, tip: Tip, el: HTMLElement, now = false) => {
    clearTimeout(timer.current);
    const open = () => {
      const r = el.getBoundingClientRect();
      setShown({ id, tip, top: r.top + r.height / 2, left: r.right + 6 });
    };
    if (now || shown || Date.now() - closed.current < 400) open();
    else timer.current = window.setTimeout(open, 450);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (shown) closed.current = Date.now();
    setShown(null);
  };
  // Hover, keyboard focus, and a click (which does what the card says) closes it.
  const props = (id: string, tip: Tip) => ({
    'aria-describedby': shown?.id === id ? 'view-tip' : undefined,
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => show(id, tip, e.currentTarget),
    onMouseLeave: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => e.currentTarget.matches(':focus-visible') && show(id, tip, e.currentTarget, true),
    onBlur: hide,
    onMouseDown: hide,
  });
  // In the page's top layer, over the sidebar and the editor beside the bar.
  const card =
    shown &&
    createPortal(
      <div className="view-tip" id="view-tip" role="tooltip" style={{ top: shown.top, left: shown.left }}>
        <div className="view-tip-name">
          {shown.tip.name}
          {shown.tip.keys && <kbd>{shown.tip.keys}</kbd>}
        </div>
        <div className="view-tip-about">{shown.tip.about}</div>
        {shown.tip.note && <div className="view-tip-note">{shown.tip.note}</div>}
      </div>,
      document.body,
    );
  return { props, card };
}

/**
 * The sidebar's views, as icons on the window's left edge. It stays when the
 * sidebar is closed, as in VS Code: the open view's icon closes the sidebar,
 * any icon opens it at that view. Hovering one says what it's for.
 */
export function ActivityBar({ open, onPick }: { open: boolean; onPick: (view: View, current: View) => void }) {
  const current = useSidebarView();
  const { hasCode, todoCount, hasReview, reviewOpen, hasGit, gitChanged } = useViews();
  // The views that are always there first, so they never move: the book's files, its
  // review comments, its history. Then those that come and go, the most fleeting last.
  const items: { id: View; icon: IconName; label: string; badge?: number; tip: Tip }[] = [
    { id: 'files', icon: 'files', label: 'Files', tip: { name: 'Files', about: 'The book’s chapters, pictures and other files. Right-click one to rename it, add a chapter, and more.' } },
    ...(hasReview
      ? [
          {
            id: 'review' as const,
            icon: 'comments' as const,
            label: `Review: ${reviewOpen} open comment${reviewOpen === 1 ? '' : 's'}`,
            badge: reviewOpen || undefined,
            tip: { name: 'Review', about: 'Comments on passages of the text, for you or the assistant to work through, and the assistant’s changes to check.', note: reviewOpen ? `${plural(reviewOpen, 'comment')} open` : 'No open comments. Select some text and press ⌥⌘M to add one.' },
          },
        ]
      : []),
    { id: 'history', icon: 'history', label: 'History: saved versions of the book', tip: { name: 'History', about: 'Versions of the book, saved as you work and around every change the assistant makes. See what changed, or go back to any of them.' } },
    ...(hasGit
      ? [
          {
            id: 'git' as const,
            icon: 'branch' as const,
            label: `Source control: ${gitChanged ? `${gitChanged} file${gitChanged === 1 ? '' : 's'} not committed` : 'everything committed'}`,
            badge: gitChanged || undefined,
            tip: { name: 'Source control', about: 'The book’s own Git repository: what changed since the last commit, and commit, pull and push.', note: gitChanged ? `${plural(gitChanged, 'file')} not committed` : 'Everything is committed' },
          },
        ]
      : []),
    ...(hasCode ? [{ id: 'code' as const, icon: 'code' as const, label: 'Code examples', tip: { name: 'Code examples', about: 'The book’s runnable code, and what it printed. Run one, or all of them.' } }] : []),
    ...(todoCount > 0
      ? [
          {
            id: 'todos' as const,
            icon: 'todos' as const,
            label: `To do: ${todoCount} left in the book`,
            badge: todoCount,
            tip: { name: 'To do', about: 'Notes you left yourself in the text with // TODO:. Tick one off, or hand it to the assistant.', note: `${todoCount} left in the book` },
          },
        ]
      : []),
  ];
  const guideOpen = useStore(studio.store, (s) => s.guideOpen);
  const tips = useViewTips();
  return (
    <div className="activity-bar">
      <nav className="activity-views" role="tablist" aria-label="Sidebar" aria-orientation="vertical">
        {items.map((it) => {
          const on = open && current === it.id;
          return (
            <button
              key={it.id}
              role="tab"
              aria-selected={on}
              aria-label={it.label}
              className={`chrome-icon activity-view${on ? ' on' : ''}`}
              onClick={() => onPick(it.id, current)}
              {...tips.props(it.id, on ? { ...it.tip, note: [it.tip.note, 'Click to hide the sidebar.'].filter(Boolean).join(' · ') } : it.tip)}
            >
              <Icon name={it.icon} />
              {it.badge ? <span className="activity-badge">{it.badge > 99 ? '99+' : it.badge}</span> : null}
            </button>
          );
        })}
      </nav>
      {/* At the bottom, as VS Code's Manage: what isn't a view. */}
      <div className="activity-bottom">
        <button
          className={`chrome-icon${guideOpen ? ' on' : ''}`}
          aria-label="Typst basics"
          aria-pressed={guideOpen}
          onClick={() => (guideOpen ? studio.closeGuide() : studio.openGuide())}
          {...tips.props('guide', { name: 'Typst basics', about: 'How to write in Typst: headings, emphasis, lists, maths, pictures and references. About five minutes.' })}
        >
          <Icon name="help" />
        </button>
        <button className="chrome-icon" aria-label="Settings" onClick={() => studio.openSettings()} {...tips.props('settings', { name: 'Settings', keys: '⌘,', about: 'Typst Studio’s settings, and this book’s: the editor, the assistant, permissions, fonts and more.' })}>
          <Icon name="settings" />
        </button>
      </div>
      {tips.card}
    </div>
  );
}

/** A view's header: its full title and its actions. */
function ViewHeader({ view }: { view: View }) {
  const ws = useStore(studio.store, (s) => s.workspace);
  const { todoCount, reviewOpen } = useViews();
  const title =
    view === 'files'
      ? (ws?.name ?? 'Files')
      : view === 'history'
        ? 'History'
        : view === 'code'
          ? 'Code examples'
          : view === 'todos'
            ? `To do · ${todoCount}`
            : view === 'git'
              ? 'Source control'
              : `Review · ${reviewOpen} open`;
  return (
    <header className="pane-header">
      <span className="pane-title" title={title}>
        {title}
      </span>
      <span className="spacer" />
      {view === 'files' && (
        <>
          <NewChapterButton />
          <RefreshButton />
        </>
      )}
      {view === 'git' && <SourceControlActions />}
    </header>
  );
}

function ViewBody({ view }: { view: View }) {
  return view === 'files' ? (
    <FileTree />
  ) : view === 'history' ? (
    <HistoryPanel />
  ) : view === 'code' ? (
    <CodePanel />
  ) : view === 'todos' ? (
    <TodoPanel />
  ) : view === 'git' ? (
    <SourceControlPanel />
  ) : (
    <ReviewPanel />
  );
}

/** The sidebar's view: a view with nothing in it falls back to the files. */
function useSidebarView(): View {
  const sidebar = useStore(studio.store, (s) => s.sidebar);
  const { hasCode, todoCount, hasReview, hasGit } = useViews();
  const available =
    sidebar === 'files' || sidebar === 'history' || (sidebar === 'git' && hasGit) || (sidebar === 'code' && hasCode) || (sidebar === 'todos' && todoCount > 0) || (sidebar === 'review' && hasReview);
  return available ? sidebar : 'files';
}

export function Explorer() {
  const view = useSidebarView();
  return (
    <section className="pane explorer">
      <div className="explorer-main">
        <ViewHeader view={view} />
        <ViewBody view={view} />
      </div>
    </section>
  );
}
