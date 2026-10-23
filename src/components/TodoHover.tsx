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
      {removable(todo) && (
        <button className="todo-hover-done" title="Take the TODO out (⌘Z puts it back)" onClick={run(() => void studio.todoDone(todo))}>
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

/**
 * Actions over a TODO comment while the pointer rests on it, as the Comment
 * bubble sits by a selection: ask the assistant to do it, mark it done, or
 * see the others. Returns its cleanup.
 */
export function attachTodoHover(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  const node = document.createElement('div');
  // Clicks keep the editor's focus and selection.
  node.onmousedown = (e) => e.preventDefault();
  const root = createRoot(node);
  let shown: { found: Found; key: string } | null = null;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;
  const widget: monaco.editor.IContentWidget = {
    getId: () => 'studio.todoHover',
    getDomNode: () => node,
    getPosition: () =>
      shown ? { position: { lineNumber: shown.found.todo.line, column: shown.found.from }, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW] } : null,
  };
  editor.addContentWidget(widget);
  const bar = () => (shown ? <TodoActions found={shown.found} close={hide} /> : null);
  // At once, so Monaco measures the bar's height and puts it above the line, not over it.
  const render = () => flushSync(() => root.render(bar()));
  const show = (found: Found, key: string) => {
    shown = { found, key };
    render();
    editor.layoutContentWidget(widget);
  };
  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (!shown) return;
    shown = null;
    render();
    editor.layoutContentWidget(widget);
  }
  // A moment's grace, to move from the comment onto the bar.
  const hideSoon = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, 250);
  };
  const subs = [
    editor.onMouseMove((e) => {
      const pos = e.target.position;
      const model = editor.getModel();
      const path = studio.state.active;
      const at =
        e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT && pos && model && path && model.getLanguageId() === 'typst'
          ? todoAt(model.getLineContent(pos.lineNumber), path, pos.lineNumber, pos.column)
          : null;
      if (!at) return hideSoon();
      clearTimeout(hideTimer);
      const key = `${path}:${at.todo.line}:${at.todo.text}`;
      if (shown?.key === key) return;
      clearTimeout(showTimer);
      // As Monaco's own hovers: after the pointer rests, or at once when moving from one TODO to the next.
      showTimer = window.setTimeout(() => show({ todo: at.todo, fix: at.fix, from: at.from }, key), shown ? 0 : 350);
    }),
    editor.onMouseLeave(hideSoon),
    editor.onKeyDown(hide),
    editor.onDidChangeModelContent(hide),
    editor.onDidChangeModel(hide),
  ];
  node.onmouseenter = () => clearTimeout(hideTimer);
  node.onmouseleave = hideSoon;
  // The assistant getting ready, or the count changing, while it shows.
  const offStore = studio.store.subscribe(() => shown && root.render(bar()));
  return () => {
    hide();
    for (const s of subs) s.dispose();
    offStore();
    editor.removeContentWidget(widget);
    queueMicrotask(() => root.unmount());
  };
}
