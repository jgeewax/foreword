// A TODO's menu (the editor's context menu, the To do list's, the empty chat's
// TODOs), and the other ways to do it on its bar's ▾. A TODO can ask for any
// mode's work: done (a change to the book, so in Write, or in Figures if the
// chat is there), drawn, talked through or answered. The usual way is the
// assistant's button; each other mode is a choice of its own.
import { studio } from '../app/studio';
import { removable, type Todo } from '../app/todos';
import type { MenuEntry } from '../lib/context-menu';
import type { AgentMode } from '../services/agent/modes';

/** In the mode menu's order. Options isn't one: it rewrites a passage, and a TODO's line isn't the passage. */
const WAYS: { mode: AgentMode; label: string }[] = [
  { mode: 'write', label: 'Do It in Write Mode' },
  { mode: 'ask', label: 'Ask About It in Ask Mode' },
  { mode: 'discuss', label: 'Talk It Through in Discuss Mode' },
  { mode: 'figures', label: 'Draw It in Figures Mode' },
];

/** Every mode but the one the assistant's button goes in. `then` runs first (the TODO's bar closes). */
export function otherTodoWays(todo: Todo, then?: () => void): MenuEntry[] {
  const usual = studio.modeForChanges();
  return WAYS.filter((w) => w.mode !== usual).map((w) => ({
    label: w.label,
    action: () => {
      then?.();
      void studio.askTodo(todo, w.mode);
    },
  }));
}

/** Ask the assistant to do it (a FIXME: fix it), the other ways, and Mark as Done. */
export function todoMenu(todo: Todo, fix = false): MenuEntry[] {
  const ready = studio.state.agent.status === 'ready';
  return [
    ready && { label: fix ? 'Fix This with the Assistant' : 'Do This TODO with the Assistant', action: () => void studio.askTodo(todo) },
    ready && { label: 'Other Ways with the Assistant', items: otherTodoWays(todo) },
    removable(todo) && { label: 'Mark as Done', action: () => void studio.todoDone(todo) },
  ];
}
