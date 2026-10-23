import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommentCard, CommentComposer } from './CommentCard';
import { MergeCard } from './MergeCard';
import { studio } from '../app/studio';
import { editorTextOptions, editorWrapOptions, monaco } from '../editor/monaco';
import { cellStatus } from '../code/cells';
import { locate } from '../app/review';
import { editMarks, readMarks, type EditMark } from '../app/ai-marks';
import { commentTags, type TagKind } from '../editor/comment-tags';
import { removable, todoAt } from '../app/todos';
import { attachTodoHover } from './TodoHover';
import { attachSelectionBar } from './SelectionBar';
import { headings, type Heading } from '../editor/outline';
import { onContextMenu, showContextMenu } from '../lib/context-menu';
import { GIT_TAB, GUIDE_TAB, HISTORY_FILE_TAB, HISTORY_TAB, isViewTab } from '../app/view-tabs';
import { Breadcrumbs } from './Breadcrumbs';
import { GitChanges } from './GitChanges';
import { HistoryChanges } from './HistoryChanges';
import { HistoryDiff } from './HistoryDiff';
import { FileIcon, Icon, type IconName } from './icons';
import { TypstGuide } from './TypstGuide';
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

/** A tab that isn't a file: its name, icon and tooltip. */
function useViewTabLabel(): (key: string) => { name: string; icon: IconName; title: string } {
  const changes = useStore(studio.store, (s) => s.history.changes);
  const diff = useStore(studio.store, (s) => s.history.diff);
  const git = useStore(studio.store, (s) => s.git.view);
  return (key) => {
    if (key === HISTORY_TAB && changes) {
      const name = changes.mode === 'now' ? `Since “${changes.version.label}”` : changes.version.label;
      return { name, icon: 'history', title: `What changed: ${name}` };
    }
    if (key === HISTORY_FILE_TAB && diff) return { name: `${basename(diff.path)} (${diff.version.label})`, icon: 'history', title: `${diff.path}: what changed in “${diff.version.label}”` };
    if (key === GIT_TAB && git) return { name: git.title, icon: 'branch', title: `${git.title} · ${git.subtitle}` };
    return { name: 'Typst basics', icon: 'help', title: 'Typst basics' };
  };
}

export function EditorPane() {
  const tabs = useStore(studio.store, (s) => s.tabs);
  const active = useStore(studio.store, (s) => s.active);
  const viewTab = useStore(studio.store, (s) => s.viewTab);
  const dirty = useStore(studio.store, (s) => s.dirty);
  const conflict = useStore(studio.store, (s) => (s.active ? s.conflicts[s.active] : undefined));
  const hostRef = useRef<HTMLDivElement>(null);
  // The tab in front: a file's (the editor), or one that isn't a file, shown in the editor's place.
  const front = viewTab ?? active;
  const viewTabLabel = useViewTabLabel();
  // The file's headings, for the path bar.
  const [outline, setOutline] = useState<Heading[]>([]);

  useEffect(() => {
    const editor = monaco.editor.create(hostRef.current!, {
      model: null,
      automaticLayout: true,
      minimap: { enabled: false },
      ...editorTextOptions(studio.state.settings.editorFontSize),
      ...editorWrapOptions(studio.state.settings),
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
      id: 'studio.formatDocument',
      label: 'Format Document',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: () => void studio.formatDocument(),
    });
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
      const todo = pos && path && model ? todoAt(model.getLineContent(pos.lineNumber), path, pos.lineNumber) : null;
      const ready = studio.state.agent.status === 'ready';
      // What's under the pointer first, then the selection, then editing. File- and
      // book-level commands live in the menu bar and the tab's menu.
      void showContextMenu([
        error && { label: 'Fix This Error with the Assistant', action: () => void studio.fixProblem(error) },
        todo && ready && { label: todo.fix ? 'Fix This with the Assistant' : 'Do This TODO with the Assistant', action: () => void studio.askTodo(todo.todo) },
        todo && removable(todo.todo) && { label: 'Mark as Done', action: () => void studio.todoDone(todo.todo) },
        mark && { label: 'What the Assistant Changed Here', action: () => void studio.showVersionChanges(mark.versionId) },
        'separator',
        hasSelection && { label: 'Ask the Assistant About This', accelerator: 'CmdOrCtrl+I', action: () => void studio.attachSelection() },
        hasSelection && ready && { label: 'Revise…', action: () => studio.events.emit('selection-card', 'revise') },
        hasSelection && ready && { label: 'Three Options to Pick From…', action: () => studio.events.emit('selection-card', 'options') },
        hasSelection && { label: 'Explain This', action: () => void studio.explainSelection() },
        hasSelection && { label: 'Add Comment…', accelerator: 'CmdOrCtrl+Alt+M', action: () => void studio.addComment() },
        'separator',
        'cut',
        'copy',
        'paste',
        'separator',
        !!path?.endsWith('.typ') && { label: 'Format Document', accelerator: 'Shift+Alt+F', action: () => void studio.formatDocument() },
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
              overviewRuler: { color: studio.state.settings.aiEditColor, position: monaco.editor.OverviewRulerLane.Left },
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
              overviewRuler: { color: `${studio.state.settings.aiReadColor}59`, position: monaco.editor.OverviewRulerLane.Center },
            },
          });
        }
      }
      aiMarks.set(decorations);
    };
    let aiTimer: number | undefined;
    const aiState = () => {
      const { aiMarks: marks, settings: s } = studio.state;
      return [marks, s.markAiEdits, s.markAiReads, s.aiEditColor, s.aiReadColor] as const;
    };
    let lastAi = aiState();
    const offAi = studio.store.subscribe(() => {
      const next = aiState();
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
    // Tagged comments (// TODO:, // NOTE:): the tag as a coloured label, the line tinted; TODO and FIXME in the scrollbar.
    const tagMarks = editor.createDecorationsCollection();
    const tagRuler: Partial<Record<TagKind, string>> = { todo: '#d29922', fix: '#e5534b' };
    const paintTags = () => {
      const model = editor.getModel();
      if (!model || model.getLanguageId() !== 'typst') return tagMarks.clear();
      tagMarks.set(
        commentTags(model.getLinesContent()).flatMap((t): monaco.editor.IModelDeltaDecoration[] => [
          {
            range: new monaco.Range(t.line, 1, t.line, 1),
            options: {
              isWholeLine: true,
              className: `ctag-line ctag-${t.kind}`,
              overviewRuler: tagRuler[t.kind] ? { color: tagRuler[t.kind]!, position: monaco.editor.OverviewRulerLane.Right } : undefined,
            },
          },
          { range: new monaco.Range(t.line, t.slashes[0], t.line, t.slashes[1]), options: { inlineClassName: 'ctag-slashes' } },
          { range: new monaco.Range(t.line, t.tag[0], t.line, t.tag[1]), options: { inlineClassName: `ctag-label ctag-${t.kind}` } },
          { range: new monaco.Range(t.line, t.tag[1], t.line, t.end), options: { inlineClassName: `ctag-text ctag-${t.kind}` } },
        ]),
      );
    };
    let tagTimer: number | undefined;
    editor.onDidChangeModel(paintTags);
    editor.onDidChangeModelContent(() => {
      clearTimeout(tagTimer);
      tagTimer = window.setTimeout(paintTags, 120);
    });
    paintTags();
    // Resting the pointer on a TODO comment: ask the assistant to do it, mark it done, or see the others.
    const offTodoHover = attachTodoHover(editor);
    // The headings, for the path bar (the cursor's own line comes from the store).
    const readOutline = () => {
      const model = editor.getModel();
      setOutline(model ? headings(model.getLinesContent(), model.getLanguageId()) : []);
    };
    let outlineTimer: number | undefined;
    editor.onDidChangeModel(readOutline);
    editor.onDidChangeModelContent(() => {
      clearTimeout(outlineTimer);
      outlineTimer = window.setTimeout(readOutline, 300);
    });
    readOutline();
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
    // Go to Definition: holding ⌘ underlines a name defined in the book (#key-idea, @fig-1) or a path to one of its
    // files (#include "chapters/one.typ", image("a.png")), and ⌘-click goes there.
    const definitionProvider = monaco.languages.registerDefinitionProvider('typst', {
      provideDefinition: (model, position) => studio.definitionsAt(model, position),
    });
    // Monaco only moves within the file it shows; a definition in another file opens in its tab.
    const definitionOpener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, uri, at) => (uri.toString() === editor.getModel()?.uri.toString() ? false : studio.openDefinition(uri, at)),
    });
    // Review comments: their passages highlighted, and a card under each (open, or changed
    // and waiting to be checked), in a view zone. The comment being written is one too, and
    // so is each passage a merge with the file on disk asks about (documents.ts).
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
        for (const q of studio.state.questions[path] ?? []) {
          const range = studio.docs?.questionRange(path, q.id);
          if (!range) continue;
          // A passage of whole lines ends at the start of the next: the card goes under its last line.
          const line = range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? range.endLineNumber - 1 : range.endLineNumber;
          want.set(q.id, { line, node: <MergeCard path={path} question={q} /> });
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
    let lastQuestions = studio.state.questions;
    const offReview = studio.store.subscribe(() => {
      if (studio.state.review === lastReview && studio.state.questions === lastQuestions) return;
      lastReview = studio.state.review;
      lastQuestions = studio.state.questions;
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
    // Under a selection (after a moment): Revise, Options, Explain, Comment and Ask in chat.
    const offSelectionBar = attachSelectionBar(editor);
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
    // The text size, wrapping and rulers (Settings ▸ Editor).
    let lastSize = studio.state.settings.editorFontSize;
    const wrapState = () => {
      const s = studio.state.settings;
      return [s.wordWrap, s.wordWrapColumn, s.rulers.join()] as const;
    };
    let lastWrap = wrapState();
    const offSize = studio.store.subscribe(() => {
      const size = studio.state.settings.editorFontSize;
      if (size !== lastSize) {
        lastSize = size;
        editor.updateOptions(editorTextOptions(size));
      }
      const wrap = wrapState();
      if (wrap.every((v, i) => v === lastWrap[i])) return;
      lastWrap = wrap;
      editor.updateOptions(editorWrapOptions(studio.state.settings));
    });
    return () => {
      off();
      offSize();
      offAi();
      clearTimeout(aiTimer);
      clearTimeout(outlineTimer);
      showVersion.dispose();
      offTodoHover();
      offReview();
      clearTimeout(commentTimer);
      offSelectionBar();
      clearZones();
      offLens();
      lenses.dispose();
      runCommand.dispose();
      definitionProvider.dispose();
      definitionOpener.dispose();
      studio.editor = null;
      editor.dispose();
    };
  }, []);

  return (
    <section className="pane editor-pane">
      <div className="tabs" role="tablist">
        {tabs.map((t) => {
          const view = isViewTab(t) ? viewTabLabel(t) : null;
          const name = view ? view.name : basename(t);
          return (
            <div
              key={t}
              role="tab"
              aria-selected={t === front}
              className={`tab${t === front ? ' active' : ''}`}
              title={view ? view.title : t}
              onContextMenu={onContextMenu(() => {
                const i = tabs.indexOf(t);
                return [
                  { label: 'Close', accelerator: 'CmdOrCtrl+W', action: () => void studio.closeTab(t) },
                  { label: 'Close Others', accelerator: 'CmdOrCtrl+Alt+T', enabled: tabs.length > 1, action: () => void studio.closeOtherTabs(t) },
                  { label: 'Close Tabs to the Right', enabled: i < tabs.length - 1, action: () => void studio.closeTabs(tabs.slice(i + 1)) },
                  { label: 'Close Saved', enabled: tabs.some((x) => !dirty[x]), action: () => void studio.closeSavedTabs() },
                  { label: 'Close All', action: () => void studio.closeAllTabs() },
                  !view && 'separator',
                  !view && { label: 'History of This File', action: () => void studio.showFileHistory(t) },
                  !view && { label: 'Reveal in Finder', action: () => void studio.reveal(t) },
                  !view && { label: 'Copy Path', action: () => studio.copy(studio.absolutePath(t), 'Path copied') },
                ];
              })}
              onMouseDown={(e) => {
                // A file's tab gives the editor the focus; the click mustn't take it back.
                if (!view) e.preventDefault();
                if (e.button === 1) void studio.closeTab(t);
                else studio.activate(t);
              }}
            >
              {view ? (
                <span className="file-icon ft-view" aria-hidden>
                  <Icon name={view.icon} size={15} />
                </span>
              ) : (
                <FileIcon path={t} />
              )}
              <span className="tab-name">{name}</span>
              <button
                className={`tab-close${dirty[t] ? ' dirty' : ''}`}
                aria-label={`Close ${name}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void studio.closeTab(t)}
              >
                <span className="dot">●</span>
                <span className="x">
                  <Icon name="close" size={14} />
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {active && !viewTab && <Breadcrumbs path={active} outline={outline} />}
      {conflict && active && !viewTab && (
        <div className="banner warn">
          <span>{conflict}</span>
          <button onClick={() => void studio.save(active, { overwrite: true })}>Save it again</button>
        </div>
      )}
      {/* Hidden, not unmounted, behind a tab that isn't a file: it keeps its place in the file. */}
      <div className="editor-host" ref={hostRef} hidden={!!viewTab} />
      {viewTab === GUIDE_TAB && <TypstGuide />}
      {viewTab === HISTORY_TAB && <HistoryChanges />}
      {viewTab === HISTORY_FILE_TAB && <HistoryDiff />}
      {viewTab === GIT_TAB && <GitChanges />}
      {!front && <div className="empty-hint">Open a file from the explorer.</div>}
    </section>
  );
}
