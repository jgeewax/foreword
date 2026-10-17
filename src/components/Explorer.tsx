import { useMemo, useState } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { buildTree, type Node } from '../lib/tree';
import { HistoryPanel } from './HistoryPanel';

export function Explorer() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const view = useStore(studio.store, (s) => s.sidebar);
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
    <section className="pane explorer">
      <header className="pane-header">
        <div className="sidebar-tabs" role="tablist">
          <button role="tab" aria-selected={view === 'files'} className={view === 'files' ? 'active' : ''} title="Files" onClick={() => studio.showSidebar('files')}>
            {ws?.name ?? 'Files'}
          </button>
          <button role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'active' : ''} title="Saved versions of the book" onClick={() => studio.showSidebar('history')}>
            History
          </button>
        </div>
        {view === 'files' && (
          <button className="icon" title="Refresh" onClick={() => void studio.refreshFiles()}>
            ↻
          </button>
        )}
      </header>
      {view === 'files' ? <div className="tree">{render(tree, 0)}</div> : <HistoryPanel />}
    </section>
  );
}
