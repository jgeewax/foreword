import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { studio } from '../app/studio';
import { removable, todoAt, type Todo } from '../app/todos';
import { monaco } from '../editor/monaco';
import { Icon } from './icons';

type Found = { todo: Todo; fix: boolean; from: number };

/** What a TODO's bar offers: the To do list's own actions, in its icons. */
function TodoActions({ found, close }: { found: Found; close: () => void }) {
  const { todo, fix } = found;
  const ready = studio.state.agent.status === 'ready';
  const left = studio.state.todos.length;
  const run = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <div className="todo-hover" role="toolbar" aria-label="TODO">
      <button className="todo-hover-ask" disabled={!ready} title={ready ? 'The assistant does it, then takes the TODO out' : 'The assistant isn’t ready yet'} onClick={run(() => void studio.askTodo(todo))}>
        <Icon name="sparkle" size={14} />
        Ask the assistant to {fix ? 'fix' : 'do'} it
      </button>
      {/* The bar stays: the TODO goes, and the next line's comes up under the cursor. */}
      {removable(todo) && (
        <button className="todo-hover-done" title="Take the TODO out (⌘Z puts it back)" onClick={() => void studio.todoDone(todo)}>
          <Icon name="check" size={14} />
          Done
        </button>
      )}
      {left > 1 && (
        <button className="todo-hover-all" title="The book’s TODOs, in the To do list" onClick={run(() => studio.revealSidebar('todos'))}>
          <Icon name="todos" size={14} />
          All {left} TODOs
        </button>
      )}
    </div>
  );
}

type Shown = { found: Found; key: string };

/** The TODO on a line of the open file, and what tells it apart (where it is and what it says). */
function todoOn(model: monaco.editor.ITextModel, line: number, column?: number): Shown | null {
  const path = studio.state.active;
  if (!path || model.getLanguageId() !== 'typst') return null;
  const at = todoAt(model.getLineContent(line), path, line, column);
  return at && { found: { todo: at.todo, fix: at.fix, from: at.from }, key: `${path}:${line}:${at.from}:${at.todo.text}` };
}

const lineOf = (s: Shown) => `${s.found.todo.path}:${s.found.todo.line}`;

/**
 * Actions over a TODO comment, as the selection bar sits under a selection:
 * ask the assistant to do it, mark it done, or see the others. It stays while
 * the cursor is on the TODO's line, and comes up when the pointer rests on
 * one. Returns its cleanup.
 */
export function attachTodoHover(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  const node = document.createElement('div');
  // Clicks keep the editor's focus and selection.
  node.onmousedown = (e) => e.preventDefault();
  const root = createRoot(node);
  /** The TODO the pointer rests on, and the one the cursor is on: the bar shows the first, else the second. */
  let hovered: Shown | null = null;
  let caret: Shown | null = null;
  /** The cursor's TODO line once its bar is closed (Escape, or a button): not again until the cursor leaves it. */
  let dismissed = '';
  let shown: Shown | null = null;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;
  let caretTimer: number | undefined;
  const widget: monaco.editor.IContentWidget = {
    getId: () => 'studio.todoHover',
    getDomNode: () => node,
    getPosition: () =>
      shown ? { position: { lineNumber: shown.found.todo.line, column: shown.found.from }, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW] } : null,
  };
  editor.addContentWidget(widget);
  const bar = () => (shown ? <TodoActions found={shown.found} close={dismiss} /> : null);
  const update = () => {
    const next = hovered ?? (caret && lineOf(caret) !== dismissed ? caret : null);
    if (next?.key === shown?.key) return;
    shown = next;
    // At once, so Monaco measures the bar's height and puts it above the line, not over it.
    flushSync(() => root.render(bar()));
    editor.layoutContentWidget(widget);
  };
  /** The cursor's TODO: with nothing selected (that's the selection bar's), while the editor has the keys. */
  const caretTodo = () => {
    const model = editor.getModel();
    const sel = editor.getSelection();
    return model && sel && sel.isEmpty() && editor.hasTextFocus() ? todoOn(model, sel.positionLineNumber) : null;
  };
  /** Moving onto a TODO's line: after a moment (not at each line the arrow keys pass), or at once (a click). */
  function followCaret(wait = 0) {
    clearTimeout(caretTimer);
    const next = caretTodo();
    if (!next || lineOf(next) !== dismissed) dismissed = '';
    if (next && wait && (!caret || lineOf(caret) !== lineOf(next))) {
      caret = null;
      update();
      caretTimer = window.setTimeout(() => {
        caret = caretTodo();
        update();
      }, wait);
      return;
    }
    caret = next;
    update();
  }
  function dismiss() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    clearTimeout(caretTimer);
    if (caret && shown?.key === caret.key) dismissed = lineOf(caret);
    hovered = null;
    update();
  }
  // A moment's grace, to move from the comment onto the bar.
  const unhoverSoon = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (!hovered) return;
    hideTimer = window.setTimeout(() => {
      hovered = null;
      update();
    }, 250);
  };
  const subs = [
    editor.onMouseMove((e) => {
      // Over the bar itself.
      if (e.target.type === monaco.editor.MouseTargetType.CONTENT_WIDGET && e.target.detail === widget.getId()) return clearTimeout(hideTimer);
      const pos = e.target.position;
      const model = editor.getModel();
      const at = e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT && pos && model ? todoOn(model, pos.lineNumber, pos.column) : null;
      if (!at) return unhoverSoon();
      clearTimeout(hideTimer);
      if (hovered?.key === at.key) return;
      clearTimeout(showTimer);
      // The cursor's own TODO: it shows already.
      if (shown?.key === at.key) return void (hovered = at);
      // As Monaco's own hovers: after the pointer rests, or at once when moving from one TODO to the next.
      showTimer = window.setTimeout(() => {
        hovered = at;
        update();
      }, hovered ? 0 : 350);
    }),
    editor.onMouseLeave(unhoverSoon),
    // Typing takes away the pointer's bar, as Monaco's hovers go; Escape closes the cursor's too.
    editor.onKeyDown((e) => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      hovered = null;
      if (e.keyCode === monaco.KeyCode.Escape) dismiss();
      else update();
    }),
    editor.onDidChangeCursorSelection((e) => followCaret(e.source === 'mouse' ? 0 : 150)),
    editor.onDidFocusEditorText(() => followCaret()),
    editor.onDidBlurEditorText(() => followCaret()),
    editor.onDidChangeModelContent(() => {
      hovered = null;
      followCaret();
    }),
    editor.onDidChangeModel(() => {
      hovered = null;
      followCaret();
    }),
  ];
  node.onmouseenter = () => clearTimeout(hideTimer);
  node.onmouseleave = unhoverSoon;
  // The assistant getting ready, or the count changing, while it shows.
  const offStore = studio.store.subscribe(() => shown && root.render(bar()));
  followCaret();
  return () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    clearTimeout(caretTimer);
    hovered = caret = null;
    update();
    for (const s of subs) s.dispose();
    offStore();
    editor.removeContentWidget(widget);
    queueMicrotask(() => root.unmount());
  };
}
