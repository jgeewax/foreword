import type { KeyboardEvent, MouseEvent } from 'react';
import { studio } from '../app/studio';
import { numberedTitle } from '../app/tool-labels';
import type { Todo } from '../app/todos';
import { useStore } from '../lib/store';
import { Icon } from './icons';

/** Whether Done can take the TODO out by itself: a `// TODO` comment, not a block comment or a #todo call. */
const removable = (t: Todo) => t.kind === 'line-comment' || t.kind === 'inline-comment';

/** A button inside a row: its click is its own, not the row's. */
const own = (run: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  run();
};

/**
 * TODOs left in the book, under their chapters. Every row keeps its shape
 * under the pointer: the circle marks it done, and Ask takes the line
 * number's place on hover, in the same box, so nothing moves or reflows.
 */
export function TodoPanel() {
  const todos = useStore(studio.store, (s) => s.todos);
  const names = useStore(studio.store, (s) => s.names);
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready' && !s.agent.running);
  if (!todos.length) {
    return (
      <div className="todo-panel empty muted">
        No TODOs. Write <code>// TODO: …</code> in a chapter to leave yourself a note; it shows up here and in the chat’s suggestions.
      </div>
    );
  }
  const files = [...new Set(todos.map((t) => t.path))];
  return (
    <div className="todo-panel">
      {files.map((path) => {
        const items = todos.filter((t) => t.path === path);
        const title = numberedTitle(path, names);
        const slash = path.lastIndexOf('/');
        return (
          <section key={path} className="todo-file">
            {/* The chapter as the author knows it, its file beside it (the pane's title has the count). */}
            <div className="todo-file-head" title={path}>
              <span className="todo-file-title">{title ?? path.slice(slash + 1)}</span>
              <span className="todo-file-path">{title ? path.slice(slash + 1) : path.slice(0, Math.max(0, slash))}</span>
            </div>
            {items.map((t) => {
              const go = () => void studio.openAt(t.path, t.line);
              return (
                <div
                  key={`${t.path}:${t.line}`}
                  className="todo-row"
                  role="button"
                  tabIndex={0}
                  title={`Go to line ${t.line}`}
                  onClick={go}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                    e.preventDefault();
                    go();
                  }}
                >
                  {removable(t) ? (
                    <button className="todo-check" title="Done: take the TODO comment out (⌘Z in the editor puts it back)" aria-label="Done" onClick={own(() => void studio.todoDone(t))}>
                      <Icon name="check" size={11} />
                    </button>
                  ) : (
                    <span className="todo-check fixed" title="Take this one out in the editor: it isn’t a // TODO comment" />
                  )}
                  <span className="todo-text">{t.text}</span>
                  <span className="todo-end">
                    <span className="todo-line">{t.line}</span>
                    <button className="todo-ask" disabled={!ready} title="Ask the assistant to do this, then remove the TODO" aria-label="Ask the assistant" onClick={own(() => void studio.askTodo(t))}>
                      <Icon name="sparkle" size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
