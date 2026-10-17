import { useMemo, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { studio } from '../app/studio';
import { onContextMenu, type MenuEntry } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { buildTree, type Node } from '../lib/tree';
import { CodePanel } from './CodePanel';
import { TodoPanel } from './TodoPanel';
import { ReviewPanel } from './ReviewPanel';
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

function PlacementButton({ to }: { to: 'tab' | 'below' }) {
  return (
    <button
      className="icon"
      title={to === 'below' ? 'Show History below the files' : 'Show History in its own tab'}
      aria-label={to === 'below' ? 'Show History below the files' : 'Show History in its own tab'}
      onClick={() => {
        studio.updateSettings({ historyPlacement: to });
        if (to === 'tab') studio.showSidebar('history');
      }}
    >
      {to === 'below' ? '⬓' : '⧉'}
    </button>
  );
}

export type View = 'files' | 'history' | 'code' | 'todos' | 'review';

/** What the sidebar can show right now (Code, To do and Review only when they have something). */
function useViews() {
  const hasCode = useStore(studio.store, (s) => s.code.cells.length > 0 || s.code.setUp);
  const todoCount = useStore(studio.store, (s) => s.todos.length);
  // Review is always there: it's where comments are written about and checked.
  const hasReview = true;
  const reviewOpen = useStore(studio.store, (s) => s.review.comments.filter((c) => c.status === 'open').length);
  return { hasCode, todoCount, hasReview, reviewOpen };
}

/** The sidebar's views as a column of icons on its left edge, each with room for its own title. */
/**
 * The sidebar's views, as icons on the window's left edge. It stays when the
 * sidebar is closed, as in VS Code: the open view's icon closes the sidebar,
 * any icon opens it at that view.
 */
export function ActivityBar({ open, onPick }: { open: boolean; onPick: (view: View, current: View) => void }) {
  const { view: current, below } = useSidebarView();
  const { hasCode, todoCount, hasReview, reviewOpen } = useViews();
  const items: { id: View; icon: IconName; label: string; badge?: number }[] = [
    { id: 'files', icon: 'folder', label: 'Files' },
    ...(below ? [] : [{ id: 'history' as const, icon: 'clock' as const, label: 'History: saved versions of the book' }]),
    ...(hasCode ? [{ id: 'code' as const, icon: 'code' as const, label: 'Code examples' }] : []),
    ...(todoCount > 0 ? [{ id: 'todos' as const, icon: 'checklist' as const, label: `To do: ${todoCount} left in the book`, badge: todoCount }] : []),
    ...(hasReview ? [{ id: 'review' as const, icon: 'comment' as const, label: `Review: ${reviewOpen} open comment${reviewOpen === 1 ? '' : 's'}`, badge: reviewOpen || undefined }] : []),
  ];
  return (
    <nav className="activity-bar" role="tablist" aria-label="Sidebar" aria-orientation="vertical">
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
  );
}

/** A view's header: its full title and its actions. */
function ViewHeader({ view, below }: { view: View; below: boolean }) {
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
      {view === 'history' && !below && <PlacementButton to="below" />}
    </header>
  );
}

function ViewBody({ view }: { view: View }) {
  return view === 'files' ? <FileTree /> : view === 'history' ? <HistoryPanel /> : view === 'code' ? <CodePanel /> : view === 'todos' ? <TodoPanel /> : <ReviewPanel />;
}

/** The current view on top and History below, with a draggable divider. */
function Stacked({ view }: { view: View }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'studio-sidebar', storage: localStorage });
  return (
    <Group className="sidebar-stack" orientation="vertical" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <Panel id="files" minSize="60px">
        <div className="sidebar-section">
          <ViewHeader view={view} below />
          <ViewBody view={view} />
        </div>
      </Panel>
      <Separator className="separator separator-h" />
      <Panel id="history" defaultSize="40%" minSize="60px">
        <div className="sidebar-section">
          <header className="pane-header">
            <span className="pane-title">History</span>
            <span className="spacer" />
            <PlacementButton to="tab" />
          </header>
          <HistoryPanel />
        </div>
      </Panel>
    </Group>
  );
}

/** The sidebar's view, and whether History is below the files rather than a view of its own. */
function useSidebarView(): { view: View; below: boolean } {
  const sidebar = useStore(studio.store, (s) => s.sidebar);
  const placement = useStore(studio.store, (s) => s.settings.historyPlacement);
  const { hasCode, todoCount, hasReview } = useViews();
  const below = placement === 'below';
  // A view with nothing in it (or History, when it's shown below) falls back to the files.
  const available = sidebar === 'files' || (sidebar === 'history' && !below) || (sidebar === 'code' && hasCode) || (sidebar === 'todos' && todoCount > 0) || (sidebar === 'review' && hasReview);
  return { view: available ? sidebar : 'files', below };
}

export function Explorer() {
  const { view, below } = useSidebarView();
  return (
    <section className="pane explorer">
      <div className="explorer-main">
        {below ? (
          <Stacked view={view} />
        ) : (
          <>
            <ViewHeader view={view} below={false} />
            <ViewBody view={view} />
          </>
        )}
      </div>
    </section>
  );
}
