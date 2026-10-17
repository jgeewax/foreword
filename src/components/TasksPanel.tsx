import { useEffect } from 'react';
import { studio } from '../app/studio';
import { onContextMenu } from '../lib/context-menu';
import { TaskRow, useTaskGroups } from './TaskMenu';

/**
 * The sidebar's Conversations view: every task (one conversation per goal),
 * at work or waiting first, then open, then done. A click opens one in the
 * assistant pane; right-click marks it done or opens it again.
 */
export function TasksPanel() {
  const { agent, status, inProgress, open, done } = useTaskGroups();
  useEffect(() => void studio.loadTasks(), []);
  const row = (t: (typeof agent.tasks)[number]) => (
    <TaskRow
      key={t.sessionId}
      task={t}
      status={status(t)}
      current={t.sessionId === agent.sessionId}
      onPick={() => {
        studio.events.emit('show-agent-pane');
        void studio.switchTask(t.sessionId);
      }}
      onContextMenu={onContextMenu(() => [
        { label: 'Open', action: () => void studio.switchTask(t.sessionId) },
        t.status === 'done'
          ? { label: 'Open Again (Not Done)', action: () => studio.reopenTask(t.sessionId) }
          : { label: 'Mark Done', enabled: !(t.sessionId === agent.sessionId && agent.running), action: () => void studio.markTaskDone(t.sessionId) },
      ])}
    />
  );
  return (
    <div className="tasks-panel">
      {inProgress.length > 0 && <div className="task-section">At work or waiting for you · {inProgress.length}</div>}
      {inProgress.map(row)}
      {open.length > 0 && <div className="task-section">Open · {open.length}</div>}
      {open.map(row)}
      {done.length > 0 && <div className="task-section">Done · {done.length}</div>}
      {done.map(row)}
      {!agent.tasks.length && <div className="history-empty muted">No conversations yet. Ask the assistant something to start one.</div>}
    </div>
  );
}
