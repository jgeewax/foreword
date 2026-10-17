import { useEffect } from 'react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { studio } from './app/studio';
import { AgentPane } from './components/AgentPane';
import { StatusBar, Toast, Toolbar, Welcome } from './components/Chrome';
import { EditorPane } from './components/EditorPane';
import { Explorer } from './components/Explorer';
import { PreviewPane } from './components/PreviewPane';
import { CoverDialog } from './components/CoverDialog';
import { HistoryDiff } from './components/HistoryDiff';
import { NewBookDialog } from './components/NewBookDialog';
import { PromptDialog } from './components/PromptDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { useStore } from './lib/store';
import { zoomActionForKey } from './lib/zoom';

const notifyLayout = () => {
  window.dispatchEvent(new Event('studio-layout'));
};

function Workbench() {
  const explorer = usePanelRef();
  const preview = usePanelRef();
  const agent = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'studio-panes', storage: localStorage });

  const toggle = (pane: 'explorer' | 'preview' | 'agent') => {
    const p = { explorer, preview, agent }[pane].current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };

  useEffect(
    () =>
      studio.events.on('show-agent-pane', () => {
        if (agent.current?.isCollapsed()) agent.current.expand();
      }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        void studio.chooseWorkspace();
      } else if (key === 'b' && !e.shiftKey) {
        e.preventDefault();
        toggle('explorer');
      } else if (key === 's' && !e.shiftKey) {
        e.preventDefault();
        void studio.save();
      } else if (key === 'i' && !e.shiftKey && !(e.target as HTMLElement)?.closest?.('.monaco-editor')) {
        e.preventDefault();
        void studio.attachSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar onToggle={toggle} />
      <Group
        className="panes"
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChange={notifyLayout}
        onLayoutChanged={(layout, meta) => {
          onLayoutChanged(layout, meta);
          notifyLayout();
        }}
      >
        <Panel id="explorer" panelRef={explorer} defaultSize="15%" minSize="140px" collapsible>
          <Explorer />
        </Panel>
        <Separator className="separator" />
        <Panel id="editor" defaultSize="32%" minSize="320px">
          <EditorPane />
        </Panel>
        <Separator className="separator" />
        <Panel id="preview" panelRef={preview} defaultSize="28%" minSize="200px" collapsible>
          <PreviewPane />
        </Panel>
        <Separator className="separator" />
        <Panel id="agent" panelRef={agent} defaultSize="25%" minSize="260px" collapsible>
          <AgentPane />
        </Panel>
      </Group>
      <StatusBar />
      <Toast />
    </div>
  );
}

export function App() {
  const workspace = useStore(studio.store, (s) => s.workspace?.root);
  useEffect(() => {
    // Capture phase, so zoom keys win over Monaco; preventDefault also stops the
    // native View-menu shortcut from applying the same press twice.
    const onZoomKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        void studio.exportPdf();
        return;
      }
      if (e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey && e.key.toLowerCase() === 'n' && studio.state.workspace) {
        e.preventDefault();
        e.stopPropagation();
        void studio.newFile();
        return;
      }
      if (e.metaKey && e.altKey && !e.shiftKey && !e.ctrlKey && e.code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        void studio.newChapter();
        return;
      }
      if (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        e.stopPropagation();
        studio.openNewBook();
        return;
      }
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key === ',') {
        e.preventDefault();
        e.stopPropagation();
        studio.openSettings();
        return;
      }
      const action = zoomActionForKey(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      void studio.zoom(action, 'key');
    };
    window.addEventListener('keydown', onZoomKey, true);
    return () => window.removeEventListener('keydown', onZoomKey, true);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!workspace && e.metaKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void studio.chooseWorkspace();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspace]);
  const settingsOpen = useStore(studio.store, (s) => s.settingsOpen);
  const newBookOpen = useStore(studio.store, (s) => s.newBookOpen);
  const coverDialogOpen = useStore(studio.store, (s) => s.coverDialogOpen);
  return (
    <>
      {workspace ? <Workbench key={workspace} /> : <Welcome />}
      {settingsOpen && <SettingsDialog />}
      {newBookOpen && <NewBookDialog />}
      {coverDialogOpen && <CoverDialog />}
      <PromptDialog />
      <HistoryDiff />
    </>
  );
}
