import { useMemo, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { studio } from '../app/studio';
import { onContextMenu, type MenuEntry } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { buildTree, type Node } from '../lib/tree';
import { CodePanel } from './CodePanel';
import { HistoryPanel } from './HistoryPanel';

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
            return [
              !n.dir && { label: 'Open', action: () => void studio.openFile(n.path) },
              n.dir && { label: expanded.has(n.path) ? 'Collapse' : 'Expand', action: () => toggle(n.path) },
              'separator',
              { label: 'New File…', action: () => void studio.newFile(folder) },
              { label: 'New Folder…', action: () => void studio.newFolder(folder) },
              (n.path === 'chapters' || n.path.startsWith('chapters/')) && { label: 'New Chapter…', accelerator: 'CmdOrCtrl+Alt+N', action: () => void studio.newChapter() },
              'separator',
              { label: 'Rename…', action: () => void studio.renamePath(n.path) },
              !n.dir && { label: 'Duplicate', action: () => void studio.duplicate(n.path) },
              !n.dir && n.path.endsWith('.typ') && n.path !== ws?.entry && { label: 'Use as Main File', action: () => void studio.setEntryPoint(n.path) },
              { label: 'Move to Trash…', action: () => void studio.trashPath(n.path) },
              'separator',
              { label: 'Reveal in Finder', action: () => void studio.reveal(n.path) },
              { label: 'Copy Path', action: () => studio.copy(studio.absolutePath(n.path), 'Path copied') },
              { label: 'Copy Relative Path', action: () => studio.copy(n.path, 'Path copied') },
            ];
          })}
        >
          <span className="twisty">{n.dir ? (expanded.has(n.path) ? '▾' : '▸') : ''}</span>
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
      onContextMenu={onContextMenu(() => [
        { label: 'New Chapter…', accelerator: 'CmdOrCtrl+Alt+N', action: () => void studio.newChapter() },
        { label: 'New File…', accelerator: 'CmdOrCtrl+N', action: () => void studio.newFile('') },
        { label: 'New Folder…', action: () => void studio.newFolder('') },
        !studio.state.code.setUp && { label: 'Set Up Runnable Code…', action: () => void studio.code.setUp().then(() => studio.showSidebar('code')) },
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

/** Files and History stacked, with a draggable divider. */
function Stacked() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const view = useStore(studio.store, (s) => s.sidebar);
  const hasCode = useStore(studio.store, (s) => s.code.cells.length > 0 || s.code.setUp);
  const showCode = hasCode && view === 'code';
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'studio-sidebar', storage: localStorage });
  return (
    <Group className="sidebar-stack" orientation="vertical" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <Panel id="files" minSize="60px">
        <div className="sidebar-section">
          <header className="pane-header">
            {hasCode ? (
              <div className="sidebar-tabs" role="tablist">
                <button role="tab" aria-selected={!showCode} className={!showCode ? 'active' : ''} onClick={() => studio.showSidebar('files')}>
                  {ws?.name ?? 'Files'}
                </button>
                <button role="tab" aria-selected={showCode} className={showCode ? 'active' : ''} onClick={() => studio.showSidebar('code')}>
                  Code
                </button>
              </div>
            ) : (
              <span className="pane-title">{ws?.name ?? 'Files'}</span>
            )}
            <span className="spacer" />
            {!showCode && (
              <>
                <NewChapterButton />
                <RefreshButton />
              </>
            )}
          </header>
          {showCode ? <CodePanel /> : <FileTree />}
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

export function Explorer() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const view = useStore(studio.store, (s) => s.sidebar);
  const placement = useStore(studio.store, (s) => s.settings.historyPlacement);
  const hasCode = useStore(studio.store, (s) => s.code.cells.length > 0 || s.code.setUp);
  if (placement === 'below') {
    return (
      <section className="pane explorer">
        <Stacked />
      </section>
    );
  }
  return (
    <section className="pane explorer">
      <header className="pane-header">
        <div className="sidebar-tabs" role="tablist">
          <button role="tab" aria-selected={view === 'files'} className={view === 'files' ? 'active' : ''} title="Files" onClick={() => studio.showSidebar('files')}>
            {ws?.name ?? 'Files'}
          </button>
          <button role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'active' : ''} title="Saved versions of the book" onClick={() => studio.showSidebar('history')}>
            History
          </button>
          {hasCode && (
            <button role="tab" aria-selected={view === 'code'} className={view === 'code' ? 'active' : ''} title="Runnable code examples" onClick={() => studio.showSidebar('code')}>
              Code
            </button>
          )}
        </div>
        {view === 'files' ? (
          <>
            <NewChapterButton />
            <RefreshButton />
          </>
        ) : view === 'history' ? (
          <PlacementButton to="below" />
        ) : null}
      </header>
      {view === 'files' ? <FileTree /> : view === 'history' ? <HistoryPanel /> : <CodePanel />}
    </section>
  );
}
