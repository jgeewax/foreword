import { useEffect, useRef } from 'react';
import { studio } from '../app/studio';
import { monaco } from '../editor/monaco';
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
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void studio.save());
    editor.addAction({
      id: 'studio.askAgent',
      label: 'Ask Agent About Selection',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0,
      run: () => void studio.attachSelection(),
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
