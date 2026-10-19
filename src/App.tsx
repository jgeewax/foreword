import { useCallback, useEffect, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { studio } from './app/studio';
import { AgentPane } from './components/AgentPane';
import { StatusBar, TitleBar, Toast, Welcome } from './components/Chrome';
import { EditorPane } from './components/EditorPane';
import { ActivityBar, Explorer, type View } from './components/Explorer';
import { PreviewPane } from './components/PreviewPane';
import { CoverDialog } from './components/CoverDialog';
import { StyleTemplatesDialog } from './components/StyleTemplatesDialog';
import { NewBookDialog } from './components/NewBookDialog';
import { PrintDialog } from './components/PrintDialog';
import { QuickOpen } from './components/QuickOpen';
import { PromptDialog } from './components/PromptDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { UpdateDialog } from './components/UpdateDialog';
import { AboutDialog } from './components/AboutDialog';
import { useStore } from './lib/store';
import { chordCommand, editorChordAction, isChordStart, tabKeyCommand } from './lib/tab-keys';
import { zoomActionForKey } from './lib/zoom';

const notifyLayout = () => {
  window.dispatchEvent(new Event('studio-layout'));
};

function Workbench() {
  const explorer = usePanelRef();
  const preview = usePanelRef();
  const agent = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'studio-panes', storage: localStorage });

  // Which panes are showing (for the title bar's toggles).
  const [visible, setVisible] = useState({ explorer: true, preview: true, agent: true });
  const readVisible = useCallback(() => {
    setVisible({ explorer: !explorer.current?.isCollapsed(), preview: !preview.current?.isCollapsed(), agent: !agent.current?.isCollapsed() });
  }, [explorer, preview, agent]);
  useEffect(() => {
    const t = setTimeout(readVisible, 0);
    return () => clearTimeout(t);
  }, [readVisible]);

  const toggle = (pane: 'explorer' | 'preview' | 'agent') => {
    const p = { explorer, preview, agent }[pane].current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
    readVisible();
  };

  useEffect(
    () =>
      studio.events.on('show-agent-pane', () => {
        if (agent.current?.isCollapsed()) agent.current.expand();
      }),
    [],
  );
  // The menu bar's View → Toggle Sidebar / Preview / Assistant.
  useEffect(() => studio.events.on('toggle-pane', (pane) => toggle(pane)), []);
  useEffect(
    () =>
      studio.events.on('show-explorer', () => {
        if (explorer.current?.isCollapsed()) explorer.current.expand();
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

  // The activity bar: the open view's icon closes the sidebar; any icon opens it there.
  const pickView = (view: View, current: View) => {
    const p = explorer.current;
    if (!p) return;
    if (!p.isCollapsed() && view === current) p.collapse();
    else {
      studio.showSidebar(view);
      if (p.isCollapsed()) p.expand();
    }
    readVisible();
  };

  return (
    <div className="app">
      <TitleBar panes={{ visible, onToggle: toggle }} />
      <div className="workbench">
        <ActivityBar open={visible.explorer} onPick={pickView} />
        <Group
          className="panes"
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChange={notifyLayout}
          onLayoutChanged={(layout, meta) => {
            onLayoutChanged(layout, meta);
            notifyLayout();
            readVisible();
          }}
        >
          <Panel id="explorer" panelRef={explorer} defaultSize="17%" minSize="180px" collapsible>
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
      </div>
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
    let chordUntil = 0;
    const onZoomKey = (e: KeyboardEvent) => {
      // Tab shortcuts (see lib/tab-keys.ts). Every ⌘K chord is read here, in the editor too
      // (so the ⌘W of ⌘K ⌘W isn't taken for "close tab"); the editor's own go on to it.
      if (studio.state.workspace) {
        const inEditor = !!(e.target as HTMLElement | null)?.closest?.('.monaco-editor');
        if (chordUntil > performance.now() && !['Meta', 'Shift', 'Alt', 'Control'].includes(e.key)) {
          chordUntil = 0;
          e.preventDefault();
          e.stopPropagation();
          const chord = chordCommand(e);
          if (chord) studio.tabCommand(chord);
          else {
            const action = inEditor ? editorChordAction(e) : null;
            if (action) studio.editor?.trigger('keyboard', action, null);
          }
          return;
        }
        if (isChordStart(e)) {
          e.preventDefault();
          e.stopPropagation();
          chordUntil = performance.now() + 1500;
          return;
        }
        const command = tabKeyCommand(e);
        if (command) {
          e.preventDefault();
          e.stopPropagation();
          studio.tabCommand(command);
          return;
        }
      }
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.code === 'KeyP' && studio.state.workspace) {
        e.preventDefault();
        e.stopPropagation();
        studio.openQuickOpen();
        return;
      }
      // The command palette: ⇧⌘P, or F1 as in VS Code (taken before Monaco's own F1 palette).
      if ((e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.code === 'KeyP') || (e.key === 'F1' && !e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        studio.openCommandPalette();
        return;
      }
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
      if (e.metaKey && e.altKey && !e.shiftKey && !e.ctrlKey && e.code === 'KeyE' && studio.state.workspace) {
        e.preventDefault();
        e.stopPropagation();
        void studio.openExportedPdf();
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
  const updateDialog = useStore(studio.store, (s) => s.updateDialog);
  const aboutOpen = useStore(studio.store, (s) => s.aboutOpen);
  const newBookOpen = useStore(studio.store, (s) => s.newBookOpen);
  const coverDialogOpen = useStore(studio.store, (s) => s.coverDialogOpen);
  const styleTemplatesOpen = useStore(studio.store, (s) => s.styleTemplatesOpen);
  const printOpen = useStore(studio.store, (s) => s.print.open);
  const quickOpen = useStore(studio.store, (s) => s.quickOpen);
  // Typst source outside the editor (What changed's words) is set like the editor.
  const editorFontSize = useStore(studio.store, (s) => s.settings.editorFontSize);
  useEffect(() => document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`), [editorFontSize]);
  // The assistant's marks in the editor, in the colours chosen in Settings ▸ Assistant.
  const aiEditColor = useStore(studio.store, (s) => s.settings.aiEditColor);
  const aiReadColor = useStore(studio.store, (s) => s.settings.aiReadColor);
  useEffect(() => {
    document.documentElement.style.setProperty('--ai-edit', aiEditColor);
    document.documentElement.style.setProperty('--ai-read', aiReadColor);
  }, [aiEditColor, aiReadColor]);
  return (
    <>
      {workspace ? <Workbench key={workspace} /> : <Welcome />}
      {settingsOpen && <SettingsDialog />}
      {newBookOpen && <NewBookDialog />}
      {coverDialogOpen && <CoverDialog />}
      {styleTemplatesOpen && <StyleTemplatesDialog />}
      {printOpen && <PrintDialog />}
      {quickOpen && <QuickOpen />}
      {updateDialog && <UpdateDialog />}
      {aboutOpen && <AboutDialog />}
      <PromptDialog />
    </>
  );
}
