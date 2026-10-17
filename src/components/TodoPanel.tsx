import { studio } from '../app/studio';
import { useStore } from '../lib/store';

/** TODOs left in the book; open one, hand it to the assistant, or mark it done. */
export function TodoPanel() {
  const todos = useStore(studio.store, (s) => s.todos);
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
      {files.map((path) => (
        <div key={path}>
          <div className="code-file-name">{path}</div>
          {todos
            .filter((t) => t.path === path)
            .map((t) => (
              <div key={`${t.path}:${t.line}`} className="todo-row" role="button" tabIndex={0} title={`Line ${t.line}`} onClick={() => void studio.openAt(t.path, t.line)}>
                <span className="todo-box">☐</span>
                <span className="todo-text">{t.text}</span>
                <span className="todo-line">{t.line}</span>
                <span className="todo-actions">
                  <button
                    className="link"
                    disabled={!ready}
                    title="Ask the assistant to do this, then remove the TODO"
                    onClick={(e) => {
                      e.stopPropagation();
                      void studio.askTodo(t);
                    }}
                  >
                    Ask
                  </button>
                  {(t.kind === 'line-comment' || t.kind === 'inline-comment') && (
                    <button
                      className="link"
                      title="Remove the TODO comment (⌘Z in the editor undoes it)"
                      onClick={(e) => {
                        e.stopPropagation();
                        void studio.todoDone(t);
                      }}
                    >
                      Done
                    </button>
                  )}
                </span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
