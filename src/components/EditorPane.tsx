import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommentCard, CommentComposer } from './CommentCard';
import { studio } from '../app/studio';
import { monaco } from '../editor/monaco';
import { cellStatus } from '../code/cells';
import { locate } from '../app/review';
import { editMarks, readMarks, type EditMark } from '../app/ai-marks';
import { onContextMenu, showContextMenu } from '../lib/context-menu';
import { Icon } from './icons';
import { useStore } from '../lib/store';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Text shown inside a Markdown hover, as written (no formatting). */
const md = (s: string) => s.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
const quote = (s: string, limit = 700) => {
  const t = s.length > limit ? `${s.slice(0, limit)}…` : s;
  return t
    .split('\n')
    .map((l) => `> ${md(l) || ' '}`)
    .join('\n');
};
const when = (t: number) => new Date(t * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** The hover on the line number of a line the assistant changed. */
function editHover(m: EditMark): monaco.IMarkdownString {
  const link = `[What changed](command:studio.showVersionChanges?${encodeURIComponent(JSON.stringify([m.versionId]))})`;
  const head = m.removal ? '**✦ The assistant removed text here**' : m.old ? '**✦ Changed by the assistant**' : '**✦ Added by the assistant**';
  const body = m.old ? `\n\n${m.removal ? 'Removed:' : 'Before:'}\n\n${quote(m.old)}` : '';
  return { value: `${head} · ${md(m.label.replace(/^Agent: /, ''))} · ${when(m.time)}${body}\n\n${link}`, isTrusted: { enabledCommands: ['studio.showVersionChanges'] } };
}

/** Reports its content's height (a comment card in a view zone sizes the zone with it). */
function Measured({ onHeight, children }: { onHeight: (h: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(Math.ceil(el.getBoundingClientRect().height) + 10);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);
  return (
    <div ref={ref} className="comment-zone-inner">
      {children}
    </div>
  );
}

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
      const path = studio.state.active;
      const model = editor.getModel();
      const mark =
        pos && path && model && studio.state.settings.markAiEdits
          ? editMarks(studio.aiEditsFor(path), model.getValue()).find((m) => m.from <= pos.lineNumber && pos.lineNumber <= m.to)
          : undefined;
      // What's under the pointer first, then the selection, then editing. File- and
      // book-level commands live in the menu bar and the tab's menu.
      void showContextMenu([
        error && { label: 'Fix This Error with the Assistant', action: () => void studio.fixProblem(error) },
        mark && { label: 'What the Assistant Changed Here', action: () => void studio.showVersionChanges(mark.versionId) },
        'separator',
        hasSelection && { label: 'Ask the Assistant About This', accelerator: 'CmdOrCtrl+I', action: () => void studio.attachSelection() },
        hasSelection && { label: 'Explain This', action: () => void studio.explainSelection() },
        hasSelection && { label: 'Three Versions to Pick From…', action: () => void studio.optionsForSelection() },
        hasSelection && { label: 'Add Comment…', accelerator: 'CmdOrCtrl+Alt+M', action: () => void studio.addComment() },
        'separator',
        'cut',
        'copy',
        'paste',
        'separator',
        !!path && { label: 'Show in Preview', action: () => void studio.syncPreviewToCursor() },
      ]);
    });
    // The assistant's marks: lines it changed and lines it read, in the gutter.
    const showVersion = monaco.editor.registerCommand('studio.showVersionChanges', (_accessor, id: string) => void studio.showVersionChanges(id));
    const aiMarks = editor.createDecorationsCollection();
    const paintAi = () => {
      const path = studio.state.active;
      const model = editor.getModel();
      if (!path || !model) return aiMarks.clear();
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];
      if (studio.state.settings.markAiEdits) {
        for (const m of editMarks(studio.aiEditsFor(path), model.getValue())) {
          decorations.push({
            range: new monaco.Range(m.from, 1, m.to, 1),
            options: {
              isWholeLine: true,
              className: m.removal ? undefined : 'ai-edit-bg',
              linesDecorationsClassName: m.removal ? 'ai-edit-removal' : 'ai-edit-line',
              linesDecorationsTooltip: m.removal ? 'The assistant removed text here (hover the line number)' : 'Changed by the assistant (hover the line number)',
              lineNumberHoverMessage: editHover(m),
              overviewRuler: { color: '#a371f7', position: monaco.editor.OverviewRulerLane.Left },
            },
          });
        }
      }
      if (studio.state.settings.markAiReads) {
        for (const r of readMarks(studio.aiReadsFor(path), model.getValue())) {
          decorations.push({
            range: new monaco.Range(r.from, 1, r.to, 1),
            options: {
              isWholeLine: true,
              linesDecorationsClassName: 'ai-read-line',
              linesDecorationsTooltip: `The assistant read these lines in this conversation (lines ${r.from}–${r.to} now)`,
              overviewRuler: { color: 'rgba(88, 166, 255, 0.35)', position: monaco.editor.OverviewRulerLane.Center },
            },
          });
        }
      }
      aiMarks.set(decorations);
    };
    let aiTimer: number | undefined;
    let lastAi = [studio.state.aiMarks, studio.state.settings.markAiEdits, studio.state.settings.markAiReads] as const;
    const offAi = studio.store.subscribe(() => {
      const next = [studio.state.aiMarks, studio.state.settings.markAiEdits, studio.state.settings.markAiReads] as const;
      if (next.every((v, i) => v === lastAi[i])) return;
      lastAi = next;
      paintAi();
    });
    editor.onDidChangeModel(() => {
      paintAi();
      if (studio.state.active) void studio.loadAiEdits(studio.state.active);
    });
    editor.onDidChangeModelContent(() => {
      clearTimeout(aiTimer);
      aiTimer = window.setTimeout(paintAi, 300);
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
    // Review comments: their passages highlighted, and a card under each (open, or changed
    // and waiting to be checked), in a view zone. The comment being written is one too.
    const commentMarks = editor.createDecorationsCollection();
    // `line` is where we put it: Monaco's own tracking of zones isn't reliable when a file reloads from disk.
    type Zone = { zoneId: string; root: Root; fit: (h: number) => void; zone: monaco.editor.IViewZone; line: number };
    const zones = new Map<string, Zone>();
    const clearZones = () => {
      editor.changeViewZones((a) => {
        for (const z of zones.values()) a.removeZone(z.zoneId);
      });
      for (const z of zones.values()) queueMicrotask(() => z.root.unmount());
      zones.clear();
    };
    const syncComments = () => {
      const path = studio.state.active;
      const model = editor.getModel();
      const want = new Map<string, { line: number; node: ReactNode }>();
      const marks: monaco.editor.IModelDeltaDecoration[] = [];
      if (path && model) {
        const text = model.getValue();
        for (const c of studio.state.review.comments) {
          if (c.path !== path || c.status === 'resolved') continue;
          let range: monaco.Range | null = null;
          // A changed passage: the card goes under the whole new text (to check it).
          const after = c.status === 'addressed' ? c.outcome?.change?.after : undefined;
          const i = after ? text.indexOf(after) : -1;
          if (after && i >= 0) range = monaco.Range.fromPositions(model.getPositionAt(i), model.getPositionAt(i + after.length));
          else {
            const at = locate(text, c);
            if (at) range = monaco.Range.fromPositions(model.getPositionAt(at[0]), model.getPositionAt(at[1]));
          }
          if (!range) continue;
          marks.push({ range, options: { inlineClassName: c.status === 'addressed' ? 'review-highlight changed' : 'review-highlight', linesDecorationsClassName: 'review-line' } });
          want.set(c.id, { line: range.endLineNumber, node: <CommentCard comment={c} /> });
        }
        const draft = studio.state.review.draft;
        if (draft && draft.path === path) {
          const range = monaco.Range.fromPositions(model.getPositionAt(draft.start), model.getPositionAt(draft.end));
          marks.push({ range, options: { inlineClassName: 'review-highlight draft' } });
          want.set('draft', { line: range.endLineNumber, node: <CommentComposer quote={model.getValueInRange(range)} /> });
        }
      }
      commentMarks.set(marks);
      editor.changeViewZones((a) => {
        for (const [key, z] of zones) {
          if (want.has(key)) continue;
          a.removeZone(z.zoneId);
          queueMicrotask(() => z.root.unmount());
          zones.delete(key);
        }
        for (const [key, w] of want) {
          const existing = zones.get(key);
          if (existing) {
            if (existing.line !== w.line) {
              // Moved: the same node (and the card's state) at its new line.
              a.removeZone(existing.zoneId);
              existing.zone.afterLineNumber = w.line;
              existing.zoneId = a.addZone(existing.zone);
              existing.line = w.line;
            }
            existing.root.render(<Measured onHeight={existing.fit}>{w.node}</Measured>);
            continue;
          }
          const domNode = document.createElement('div');
          domNode.className = 'comment-zone';
          const zone: monaco.editor.IViewZone = { afterLineNumber: w.line, heightInPx: 96, domNode };
          const root = createRoot(domNode);
          const entry: Zone = { zoneId: a.addZone(zone), root, fit: () => {}, zone, line: w.line };
          // The zone takes the card's height.
          entry.fit = (h: number) => {
            if (Math.abs((zone.heightInPx ?? 0) - h) < 1) return;
            zone.heightInPx = h;
            editor.changeViewZones((b) => b.layoutZone(entry.zoneId));
          };
          const fit = entry.fit;
          zones.set(key, entry);
          root.render(<Measured onHeight={fit}>{w.node}</Measured>);
        }
      });
    };
    let lastReview = studio.state.review;
    const offReview = studio.store.subscribe(() => {
      if (studio.state.review === lastReview) return;
      lastReview = studio.state.review;
      syncComments();
    });
    editor.onDidChangeModel(() => {
      clearZones();
      syncComments();
    });
    let commentTimer: number | undefined;
    editor.onDidChangeModelContent(() => {
      clearTimeout(commentTimer);
      commentTimer = window.setTimeout(syncComments, 400);
    });
    // A small "Comment" bubble by a selection (after a moment): ⌥⌘M and right-click work too.
    const commentButton = document.createElement('button');
    commentButton.className = 'comment-widget';
    commentButton.textContent = 'Comment';
    commentButton.title = 'Comment on the selection (⌥⌘M)';
    commentButton.onmousedown = (e) => e.preventDefault();
    commentButton.onclick = () => void studio.addComment();
    let widgetAt: monaco.IPosition | null = null;
    let widgetTimer: number | undefined;
    const commentWidget: monaco.editor.IContentWidget = {
      getId: () => 'studio.comment',
      getDomNode: () => commentButton,
      getPosition: () => (widgetAt ? { position: widgetAt, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW] } : null),
    };
    editor.addContentWidget(commentWidget);
    editor.onDidChangeCursorSelection((e) => {
      clearTimeout(widgetTimer);
      widgetAt = null;
      editor.layoutContentWidget(commentWidget);
      if (e.selection.isEmpty()) return;
      widgetTimer = window.setTimeout(() => {
        const sel = editor.getSelection();
        widgetAt = sel && !sel.isEmpty() && !studio.state.review.draft ? sel.getEndPosition() : null;
        editor.layoutContentWidget(commentWidget);
      }, 450);
    });
    editor.addAction({
      id: 'studio.addComment',
      label: 'Add Review Comment',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM],
      run: () => void studio.addComment(),
    });
    editor.onKeyDown((e) => {
      const ts = e.browserEvent.timeStamp;
      studio.perf.keyDown(ts > 1e12 ? ts : performance.timeOrigin + ts);
    });
    // Explicit: a click or an arrow key; anything else (typing, paste, undo) moved it with an edit.
    editor.onDidChangeCursorPosition((e) => studio.setCursor(e.position.lineNumber, e.position.column, e.reason !== monaco.editor.CursorChangeReason.Explicit));
    editor.onDidChangeCursorSelection(() => studio.onEditorSelection());
    editor.onDidChangeModel(() => studio.onEditorSelection());
    studio.attachEditor(editor);
    const off = studio.events.on('focus-editor', () => editor.focus());
    return () => {
      off();
      offAi();
      clearTimeout(aiTimer);
      showVersion.dispose();
      offReview();
      clearTimeout(commentTimer);
      clearTimeout(widgetTimer);
      clearZones();
      editor.removeContentWidget(commentWidget);
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
                { label: 'Close Others', accelerator: 'CmdOrCtrl+Alt+T', enabled: tabs.length > 1, action: () => void studio.closeOtherTabs(t) },
                { label: 'Close Tabs to the Right', enabled: i < tabs.length - 1, action: () => void studio.closeTabs(tabs.slice(i + 1)) },
                { label: 'Close Saved', enabled: tabs.some((x) => !dirty[x]), action: () => void studio.closeSavedTabs() },
                { label: 'Close All', action: () => void studio.closeAllTabs() },
                'separator',
                { label: 'History of This File', action: () => void studio.showFileHistory(t) },
                { label: 'Reveal in Finder', action: () => void studio.reveal(t) },
                { label: 'Copy Path', action: () => studio.copy(studio.absolutePath(t), 'Path copied') },
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
              <span className="x">
                <Icon name="close" size={14} />
              </span>
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
