import { useEffect, useRef } from 'react';
import { studio } from '../app/studio';
import { monaco } from '../editor/monaco';
import { cellStatus } from '../code/cells';
import { onContextMenu, showContextMenu } from '../lib/context-menu';
import { useStore } from '../lib/store';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function EditorPane() {
  const tabs = useStore(studio.store, (s) => s.tabs);
  const active = useStore(studio.store, (s) => s.active);
  const dirty = useStore(studio.store, (s) => s.dirty);
  const conflict = useStore(studio.store, (s) => (s.active ? s.conflicts[s.active] : undefined));
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = monaco.editor.create(hostRef.current!, {
      model: null,
      automaticLayout: true,
      wordWrap: 'on',
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 20,
      fontFamily: '"SF Mono", Menlo, Monaco, monospace',
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      unicodeHighlight: { ambiguousCharacters: false },
      padding: { top: 8 },
      fixedOverflowWidgets: true,
      // Our own native menu instead of Monaco's HTML one (see onContextMenu below).
      contextmenu: false,
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void studio.save());
    editor.addAction({
      id: 'studio.askAgent',
      label: 'Ask Agent About Selection',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
      run: () => void studio.attachSelection(),
    });
    editor.onContextMenu((e) => {
      e.event.preventDefault();
      e.event.stopPropagation();
      const pos = e.target.position;
      const sel = editor.getSelection();
      // Right-clicking outside the selection moves the cursor there, as in other editors.
      if (pos && sel && !sel.containsPosition(pos)) editor.setPosition(pos);
      editor.focus();
      const hasSelection = !editor.getSelection()?.isEmpty();
      const error = pos ? studio.errorAt(pos.lineNumber, pos.column) : null;
      void showContextMenu([
        error && { label: 'Fix This Error with the Assistant', action: () => void studio.fixProblem(error) },
        'separator',
        { label: hasSelection ? 'Ask the Assistant About This' : 'Ask the Assistant Here', accelerator: 'CmdOrCtrl+I', action: () => void studio.attachSelection() },
        hasSelection && { label: 'Get Three Versions…', action: () => void studio.optionsForSelection() },
        hasSelection && { label: 'Explain This', action: () => void studio.explainSelection() },
        'separator',
        'cut',
        'copy',
        'paste',
        'separator',
        'selectAll',
        'separator',
        { label: 'Show in Preview', action: () => void studio.syncPreviewToCursor() },
        { label: 'Typst Basics', action: () => studio.openGuide() },
      ]);
    });
    // ▶ Run above each code example, with its status.
    const runCommand = monaco.editor.registerCommand('studio.runCodeExample', (_accessor, name: string) => void studio.code.run([name]));
    const lensChanged = new monaco.Emitter<monaco.languages.CodeLensProvider>();
    const lenses = monaco.languages.registerCodeLensProvider('typst', {
      onDidChange: lensChanged.event,
      provideCodeLenses: (model) => {
        const path = studio.state.active;
        if (!path || model !== editor.getModel() || !model.getValue().includes('#run(')) return { lenses: [], dispose() {} };
        const { cells, outputs, running } = studio.state.code;
        return {
          lenses: cells
            .filter((c) => c.path === path)
            .flatMap((c) => {
              const range = new monaco.Range(c.line, 1, c.line, 1);
              const status = running.includes(c.name) ? 'running…' : { 'not-run': 'not run yet', ok: '✓ ok', outdated: '⚠ out of date', failed: '✗ failed', mismatch: '✗ wrong output' }[cellStatus(c, outputs[c.name])];
              return [
                { range, command: { id: 'studio.runCodeExample', title: `▶ Run ${c.name}`, arguments: [c.name] } },
                { range, command: { id: '', title: status } },
              ];
            }),
          dispose() {},
        };
      },
    });
    let lastCode = studio.state.code;
    const offLens = studio.store.subscribe(() => {
      if (studio.state.code !== lastCode) {
        lastCode = studio.state.code;
        lensChanged.fire(undefined as never);
      }
    });
    editor.onKeyDown((e) => {
      const ts = e.browserEvent.timeStamp;
      studio.perf.keyDown(ts > 1e12 ? ts : performance.timeOrigin + ts);
    });
    editor.onDidChangeCursorPosition((e) => studio.setCursor(e.position.lineNumber, e.position.column));
    studio.attachEditor(editor);
    const off = studio.events.on('focus-editor', () => editor.focus());
    return () => {
      off();
      offLens();
      lenses.dispose();
      runCommand.dispose();
      studio.editor = null;
      editor.dispose();
    };
  }, []);

  return (
    <section className="pane editor-pane">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <div
            key={t}
            role="tab"
            aria-selected={t === active}
            className={`tab${t === active ? ' active' : ''}`}
            title={t}
            onContextMenu={onContextMenu(() => {
              const i = tabs.indexOf(t);
              return [
                { label: 'Close', accelerator: 'CmdOrCtrl+W', action: () => void studio.closeTab(t) },
                { label: 'Close Others', enabled: tabs.length > 1, action: () => void studio.closeTabs(tabs.filter((x) => x !== t)) },
                { label: 'Close Tabs to the Right', enabled: i < tabs.length - 1, action: () => void studio.closeTabs(tabs.slice(i + 1)) },
                { label: 'Close All', action: () => void studio.closeTabs([...tabs]) },
                'separator',
                { label: 'Reveal in Finder', action: () => void studio.reveal(t) },
                { label: 'Copy Path', action: () => studio.copy(studio.absolutePath(t), 'Path copied') },
                { label: 'Copy Relative Path', action: () => studio.copy(t, 'Path copied') },
              ];
            })}
            onMouseDown={(e) => {
              if (e.button === 1) void studio.closeTab(t);
              else studio.activate(t);
            }}
          >
            <span className="tab-name">{basename(t)}</span>
            <button
              className={`tab-close${dirty[t] ? ' dirty' : ''}`}
              aria-label={`Close ${t}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void studio.closeTab(t)}
            >
              <span className="dot">●</span>
              <span className="x">×</span>
            </button>
          </div>
        ))}
      </div>
      {conflict && active && (
        <div className="banner warn">
          <span>{conflict}</span>
          <button onClick={() => void studio.reloadFromDisk(active)}>Reload from disk</button>
          <button onClick={() => void studio.save(active, { overwrite: true })}>Keep my version</button>
        </div>
      )}
      <div className="editor-host" ref={hostRef} />
      {!active && <div className="empty-hint">Open a file from the explorer.</div>}
    </section>
  );
}
