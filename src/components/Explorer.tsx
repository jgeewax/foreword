import { useMemo, useState } from 'react';
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

/** The sidebar's views as a column of icons on its left edge, each with room for its own title. */
/**
 * The sidebar's views, as icons on the window's left edge. It stays when the
 * sidebar is closed, as in VS Code: the open view's icon closes the sidebar,
 * any icon opens it at that view.
 */
export function ActivityBar({ open, onPick }: { open: boolean; onPick: (view: View, current: View) => void }) {
  const current = useSidebarView();
  const { hasCode, todoCount, hasReview, reviewOpen, hasGit, gitChanged } = useViews();
  const items: { id: View; icon: IconName; label: string; badge?: number }[] = [
    { id: 'files', icon: 'files', label: 'Files' },
    { id: 'history', icon: 'history', label: 'History: saved versions of the book' },
    ...(hasGit
      ? [{ id: 'git' as const, icon: 'branch' as const, label: `Source control: ${gitChanged ? `${gitChanged} file${gitChanged === 1 ? '' : 's'} not committed` : 'everything committed'}`, badge: gitChanged || undefined }]
      : []),
    ...(hasCode ? [{ id: 'code' as const, icon: 'code' as const, label: 'Code examples' }] : []),
    ...(todoCount > 0 ? [{ id: 'todos' as const, icon: 'todos' as const, label: `To do: ${todoCount} left in the book`, badge: todoCount }] : []),
    ...(hasReview ? [{ id: 'review' as const, icon: 'comments' as const, label: `Review: ${reviewOpen} open comment${reviewOpen === 1 ? '' : 's'}`, badge: reviewOpen || undefined }] : []),
  ];
  const guideOpen = useStore(studio.store, (s) => s.guideOpen);
  return (
    <div className="activity-bar">
      <nav className="activity-views" role="tablist" aria-label="Sidebar" aria-orientation="vertical">
        {items.map((it) => (
          <button
            key={it.id}
            role="tab"
            aria-selected={open && current === it.id}
            aria-label={it.label}
            title={open && current === it.id ? `${it.label} (click to hide the sidebar)` : it.label}
            className={`chrome-icon activity${open && current === it.id ? ' on' : ''}`}
            onClick={() => onPick(it.id, current)}
          >
            <Icon name={it.icon} />
            {it.badge ? <span className="activity-badge">{it.badge > 99 ? '99+' : it.badge}</span> : null}
          </button>
        ))}
      </nav>
      {/* At the bottom, as VS Code's Manage: what isn't a view. */}
      <div className="activity-bottom">
        <button
          className={`chrome-icon${guideOpen ? ' on' : ''}`}
          title="Typst basics: how to write in Typst"
          aria-label="Typst basics"
          aria-pressed={guideOpen}
          onClick={() => (guideOpen ? studio.closeGuide() : studio.openGuide())}
        >
          <Icon name="help" />
        </button>
        <button className="chrome-icon" title="Settings (⌘,)" aria-label="Settings" onClick={() => studio.openSettings()}>
          <Icon name="settings" />
        </button>
      </div>
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
