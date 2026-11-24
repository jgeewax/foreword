import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommentCard, CommentComposer } from './CommentCard';
import { MergeCard } from './MergeCard';
import { studio } from '../app/studio';
import { monaco } from '../editor/monaco';
import { locate } from '../app/review';
import { editMarks } from '../app/ai-marks';
import { commentTags, type TagKind } from '../editor/comment-tags';
import { todoAt } from '../app/todos';
import { nameAt } from '../app/label-refs';
import { attachTodoHover } from './TodoHover';
import { todoMenu } from './todo-menu';
import { attachSelectionBar } from './SelectionBar';
import { languageEntries, proofEntries } from './ProofingHover';
import { showContextMenu } from '../lib/context-menu';
import { keepWidgetsInside } from '../editor/overflow-widgets';

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

/**
 * What writing in a file comes with, in the editor and in a diff's file side
 * (a "what changed" tab of the file as it is now) alike: the right-click menu;
 * ⇧⌥F, ⌘I and ⌥⌘M; tagged comments (// TODO:) coloured, with a TODO's bar;
 * spelling's caret; review comments and merge questions under their passages;
 * and the selection bar. Each acts on the file the editor shows.
 * `visibleTop`, in a diff: it's as tall as its text (the list of files
 * scrolls), so its bars may spill out of it, and this is the page's y its text
 * shows below (under the file's name, stuck at the top). Returns its cleanup.
 */
export function attachEditorTools(editor: monaco.editor.IStandaloneCodeEditor, { visibleTop, inTodoTab = false }: { visibleTop?: () => number; inTodoTab?: boolean } = {}): () => void {
  const pathOf = () => studio.fileOf(editor.getModel());
  const actions = [
    editor.addAction({
      id: 'studio.formatDocument',
      label: 'Format Document',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: () => void studio.formatDocument(pathOf()),
    }),
    editor.addAction({
      id: 'studio.askAgent',
      label: 'Add Selection to Chat',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
      run: () => void studio.attachSelection(),
    }),
    editor.addAction({
      id: 'studio.addComment',
      label: 'Add Review Comment',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM],
      run: () => void studio.addComment(),
    }),
  ];
  const subs: monaco.IDisposable[] = [];
  subs.push(
    editor.onContextMenu((e) => {
      e.event.preventDefault();
      e.event.stopPropagation();
      const pos = e.target.position;
      const sel = editor.getSelection();
      // Right-clicking outside the selection moves the cursor there, as in other editors.
      if (pos && sel && !sel.containsPosition(pos)) editor.setPosition(pos);
      editor.focus();
      const hasSelection = !editor.getSelection()?.isEmpty();
      const path = pathOf();
      const error = pos && path ? studio.errorAt(pos.lineNumber, pos.column, path) : null;
      const model = editor.getModel();
      const mark =
        pos && path && model && studio.state.settings.markAiEdits
          ? editMarks(studio.aiEditsFor(path), model.getValue()).find((m) => m.from <= pos.lineNumber && pos.lineNumber <= m.to)
          : undefined;
      const todo = pos && path && model ? todoAt(model.getLineContent(pos.lineNumber), path, pos.lineNumber) : null;
      // A label or a reference to one (`<intro>`, `@intro`): where it's defined, where it's named, a new name for it.
      const label = pos && model && path?.endsWith('.typ') && /[@<"]/.test(model.getLineContent(pos.lineNumber)) ? nameAt(model.getValue(), model.getOffsetAt(pos)) : null;
      // By id: Go to Definition and Peek References are Monaco's newer actions, which getAction doesn't find.
      const run = (id: string) => () => editor.trigger('menu', id, null);
      const ready = studio.state.agent.status === 'ready';
      // What's under the pointer first, then the selection, then editing. File- and
      // book-level commands live in the menu bar and the tab's menu.
      void showContextMenu([
        // A misspelling's suggestions first, as TextEdit and Word put them.
        ...(model ? proofEntries(model, pos) : []),
        error && { label: 'Fix This Error with the Assistant', action: () => void studio.fixProblem(error) },
        ...(todo ? todoMenu(todo.todo, todo.fix) : []),
        mark && { label: 'What the Assistant Changed Here', action: () => void studio.showVersionChanges(mark.versionId) },
        mark && !!path && ready && { label: 'Ask About This Change…', action: () => void studio.askAboutChange(mark.versionId, path, mark.from) },
        'separator',
        label && label.kind !== 'label' && { label: 'Go to Definition', accelerator: 'F12', action: run('editor.action.revealDefinition') },
        label && { label: 'Find All References', accelerator: 'Shift+F12', action: run('editor.action.referenceSearch.trigger') },
        label && { label: 'Rename Label…', accelerator: 'F2', action: run('editor.action.rename') },
        'separator',
        hasSelection && { label: 'Add to Chat', accelerator: 'CmdOrCtrl+I', action: () => void studio.attachSelection() },
        hasSelection && ready && { label: 'Revise…', action: () => studio.events.emit('selection-card', 'revise') },
        hasSelection && ready && { label: 'Options to Pick From…', action: () => studio.events.emit('selection-card', 'options') },
        hasSelection && ready && { label: 'Ask About This…', action: () => studio.events.emit('selection-card', 'ask') },
        hasSelection && ready && { label: 'Review This…', action: () => studio.events.emit('selection-card', 'review') },
        hasSelection && { label: 'Add Comment…', accelerator: 'CmdOrCtrl+Alt+M', action: () => void studio.addComment() },
        hasSelection && !!path?.endsWith('.typ') && { label: 'Move to a New File…', action: () => void studio.moveSelectionToFile() },
        hasSelection && !!path?.endsWith('.typ') && { label: 'Set Language', items: languageEntries() },
        'separator',
        'cut',
        'copy',
        'paste',
        'separator',
        !!path?.endsWith('.typ') && { label: 'Format Document', accelerator: 'Shift+Alt+F', action: () => void studio.formatDocument(path) },
        !!path && { label: 'Show in Preview', action: () => void studio.syncPreviewToCursor() },
      ]);
    }),
  );
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
  subs.push(
    editor.onDidChangeModel(paintTags),
    editor.onDidChangeModelContent(() => {
      clearTimeout(tagTimer);
      tagTimer = window.setTimeout(paintTags, 120);
    }),
  );
  paintTags();
  // The cursor on a TODO comment, or the pointer resting on one: ask the assistant to do it, mark it done, or see the others.
  const offTodoHover = attachTodoHover(editor, { visibleTop, inTab: inTodoTab });
  // Spelling: the caret that holds back the word being typed (the hover and ⌘. are the file's, in ProofingHover).
  const offProofing = studio.proofing.attach(editor);
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
    const path = pathOf();
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
  let commentTimer: number | undefined;
  subs.push(
    editor.onDidChangeModel(() => {
      clearZones();
      syncComments();
    }),
    editor.onDidChangeModelContent(() => {
      clearTimeout(commentTimer);
      commentTimer = window.setTimeout(syncComments, 400);
    }),
  );
  syncComments();
  // Under a selection (after a moment): Revise, Options, Ask, Comment and Add to chat.
  const offSelectionBar = attachSelectionBar(editor, { overflow: !!visibleTop });
  // In a diff, what spills out of it stays within its width, short of the preview (the editor's are fixed: EditorPane).
  const offWidgets = visibleTop ? keepWidgetsInside(editor) : () => {};
  // The chat's live selection follows the selection where the author is writing.
  subs.push(
    editor.onDidChangeCursorSelection(() => studio.onEditorSelection()),
    editor.onDidChangeModel(() => studio.onEditorSelection()),
  );
  return () => {
    for (const s of [...subs, ...actions]) s.dispose();
    clearTimeout(tagTimer);
    clearTimeout(commentTimer);
    offTodoHover();
    offProofing();
    offReview();
    offSelectionBar();
    offWidgets();
    clearZones();
    tagMarks.clear();
    commentMarks.clear();
  };
}
