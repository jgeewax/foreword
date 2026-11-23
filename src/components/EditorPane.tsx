import { useEffect, useRef, useState } from 'react';
import { studio } from '../app/studio';
import { editorTextOptions, editorWrapOptions, monaco } from '../editor/monaco';
import { cellStatus } from '../code/cells';
import { editMarks, readMarks, type EditMark } from '../app/ai-marks';
import { attachEditorTools } from './editor-tools';
import { registerProofing } from './ProofingHover';
import { headings, type Heading } from '../editor/outline';
import { keepWidgetsInside } from '../editor/overflow-widgets';
import { labelUrisInBook } from '../editor/uri-labels';
import { onContextMenu } from '../lib/context-menu';
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
      // Our own native menu instead of Monaco's HTML one (editor-tools.tsx).
      contextmenu: false,
      // Spelling's fixes are on ⌘., the hover and the right-click menu: no bulb in the margin.
      lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void studio.save());
    // The menu, the keys, TODOs, spelling, comments and the selection bar: a diff's file side has them too.
    const offTools = attachEditorTools(editor);
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
    // Spelling's hover and ⌘., in any editor of an open file.
    const offProofing = registerProofing();
    // Its hover and suggestions stop at its right edge, short of the preview (a native view drawn over the page).
    const offWidgets = keepWidgetsInside(editor);
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
      // In any editor of the file: a diff's file side has them too.
      provideCodeLenses: (model) => {
        const path = studio.fileOf(model);
        if (!path || !model.getValue().includes('#run(')) return { lenses: [], dispose() {} };
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
    // Rename Label (F2, Monaco's box over the name) and Find All References (⇧F12, its peek): a label and
    // the references to it, in the whole book. The rename is made in the book's files by renameLabel, as
    // Replace All makes its changes (saved, with History's version from before): none for Monaco to make.
    const renameProvider = monaco.languages.registerRenameProvider('typst', {
      resolveRenameLocation: (model, position) => studio.renameLocation(model, position),
      provideRenameEdits: async (model, position, newName) => {
        await studio.renameLabel(model, position, newName);
        return { edits: [] };
      },
    });
    const referenceProvider = monaco.languages.registerReferenceProvider('typst', {
      provideReferences: (model, position, context) => studio.labelReferences(model, position, context.includeDeclaration),
    });
    // The peek names each file by its place in the book ("chapters"), not its whole path on the Mac.
    const offUriLabels = labelUrisInBook(() => studio.state.workspace?.root);
    // ⇧F12 is Peek References: always the peek, the label with every reference. Monaco's own ⇧F12 (Go to
    // References) leaves the label out when it has one reference, and then just goes to that one: where the cursor is.
    const referenceKeys = monaco.editor.addKeybindingRules([
      { keybinding: monaco.KeyMod.Shift | monaco.KeyCode.F12, command: '-editor.action.goToReferences' },
      {
        keybinding: monaco.KeyMod.Shift | monaco.KeyCode.F12,
        command: 'editor.action.referenceSearch.trigger',
        when: 'editorHasReferenceProvider && editorTextFocus && !inReferenceSearchEditor && !isInEmbeddedEditor',
      },
    ]);
    // Monaco only moves within the file it shows (the editor's, a diff's file side); a definition in another file opens in its tab.
    const definitionOpener = monaco.editor.registerEditorOpener({
      openCodeEditor: (source, uri, at) => (uri.toString() === source.getModel()?.uri.toString() ? false : studio.openDefinition(uri, at)),
    });
    editor.onKeyDown((e) => {
      const ts = e.browserEvent.timeStamp;
      studio.perf.keyDown(ts > 1e12 ? ts : performance.timeOrigin + ts);
    });
    // Explicit: a click or an arrow key; anything else (typing, paste, undo) moved it with an edit.
    editor.onDidChangeCursorPosition((e) => studio.setCursor(e.position.lineNumber, e.position.column, e.reason !== monaco.editor.CursorChangeReason.Explicit));
    studio.attachEditor(editor);
    // Back to where the author was writing (a diff's file side, behind a tab that isn't a file).
    const off = studio.events.on('focus-editor', () => studio.writer()?.editor.focus());
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
      offTools();
      offProofing();
      offWidgets();
      offLens();
      lenses.dispose();
      runCommand.dispose();
      definitionProvider.dispose();
      renameProvider.dispose();
      referenceProvider.dispose();
      referenceKeys.dispose();
      offUriLabels();
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
                  !view && studio.canShowInPreview(t) && { label: 'Show in Preview', action: () => void studio.showFileInPreview(t) },
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
                // A "what changed" tab has the ● too while a file it edits is unsaved.
                className={`tab-close${dirty[t] || (view && studio.viewTabDirty(t)) ? ' dirty' : ''}`}
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
