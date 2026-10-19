import { useEffect, useRef, useState } from 'react';
import { pendingQuestion, studio } from '../app/studio';
import { useStore } from '../lib/store';

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

/** How full the conversation is, against the model's context window. */
export function ContextMeter() {
  const tokens = useStore(studio.store, (s) => s.agent.contextTokens);
  const window_ = useStore(studio.store, (s) => s.agent.models.find((m) => m.providerID === s.agent.model?.providerID && m.id === s.agent.model?.id)?.contextWindow ?? null);
  if (!tokens) return null;
  const share = window_ ? Math.min(1, tokens / window_) : null;
  const tone = share == null ? '' : share > 0.8 ? 'bad' : share > 0.55 ? 'warn' : '';
  return (
    <span className={`context-meter ${tone}`} title={`This conversation uses about ${k(tokens)} tokens${window_ ? ` of the model's ${k(window_)}` : ''}. Long conversations get slower and less focused: start a new task or compact it.`}>
      {share != null && (
        <svg className="context-ring" width="16" height="16" viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="7.5" />
          <circle className="context-ring-used" cx="10" cy="10" r="7.5" strokeDasharray={`${Math.max(0.5, share * 47.1)} 47.2`} transform="rotate(-90 10 10)" />
        </svg>
      )}
      {k(tokens)}
    </span>
  );
}

type Task = ReturnType<typeof studio.store.get>['agent']['tasks'][number];

/** The book's tasks (conversations) in groups: at work or waiting, open, done; and each one's state in words. */
export function useTaskGroups() {
  const agent = useStore(studio.store, (s) => s.agent);
  // In progress: the shown one while it runs, and any at work or waiting in the background.
  const busy = (id: string) => (id === agent.sessionId ? agent.running : !!agent.background[id]);
  const status = (t: Task): { icon: React.ReactNode; text: string; tone: string } => {
    if (t.sessionId === agent.sessionId) return agent.running ? { icon: <span className="tool-spinner" />, text: 'working', tone: 'busy' } : { icon: '●', text: '', tone: 'current' };
    const bg = agent.background[t.sessionId];
    if (bg?.attention) return { icon: '!', text: bg.attention === 'question' ? 'has a question' : 'asks permission', tone: 'attention' };
    if (bg?.running) return { icon: <span className="tool-spinner" />, text: bg.label, tone: 'busy' };
    if (bg?.unread) return { icon: '●', text: bg.failed ? 'stopped' : 'new reply', tone: bg.failed ? 'failed' : 'unread' };
    return { icon: t.status === 'done' ? '✓' : '○', text: '', tone: '' };
  };
  return {
    agent,
    status,
    inProgress: agent.tasks.filter((t) => busy(t.sessionId)),
    open: agent.tasks.filter((t) => t.status === 'open' && !busy(t.sessionId)),
    done: agent.tasks.filter((t) => t.status === 'done' && !busy(t.sessionId)),
  };
}

/** One task in a list: its state, title and when it last changed. */
export function TaskRow({ task, status, current, onPick, onContextMenu }: { task: Task; status: ReturnType<ReturnType<typeof useTaskGroups>['status']>; current: boolean; onPick: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button className={`task-row${current ? ' current' : ''}${task.status === 'done' ? ' done' : ''} ${status.tone}`} onClick={onPick} onContextMenu={onContextMenu}>
      <span className="task-status">{status.icon}</span>
      <span className="task-title">
        {task.title}
        {status.text && <span className="task-doing">{status.text}</span>}
      </span>
      <span className="task-when">{ago(task.updated)}</span>
    </button>
  );
}

/** The shown task's state, as a dot by its title: at work, needs you, didn't finish, or done for now. */
function useTaskDot(): string {
  return useStore(studio.store, (s) => {
    const a = s.agent;
    if (!a.sessionId && !a.items.length) return '';
    if (pendingQuestion(a) || a.activity?.phase === 'asking' || a.items.some((it) => it.kind === 'permission' && (it.state === 'pending' || it.state === 'sending'))) return 'ask';
    if (a.running) return 'busy';
    const since = a.items.map((it) => it.kind).lastIndexOf('user');
    if (a.items.slice(since + 1).some((it) => it.kind === 'notice' && it.tone === 'error')) return 'fail';
    return 'idle';
  });
}

/** The current task, and a list of the book's other tasks (conversations). */
export function TaskMenu() {
  const { agent, status, inProgress, open: openTasks, done: doneTasks } = useTaskGroups();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = agent.tasks.find((t) => t.sessionId === agent.sessionId);
  const dot = useTaskDot();

  useEffect(() => {
    if (!open) return;
    void studio.loadTasks();
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const row = (t: Task) => (
    <TaskRow
      key={t.sessionId}
      task={t}
      status={status(t)}
      current={t.sessionId === agent.sessionId}
      onPick={() => {
        setOpen(false);
        void studio.switchTask(t.sessionId);
      }}
    />
  );
  // On the trigger: how many others are at work, and whether any needs the author.
  const others = Object.values(agent.background);
  const working = others.filter((b) => b.running).length;
  const waiting = others.filter((b) => b.attention || b.unread).length;

  return (
    <div className="task-menu" ref={rootRef}>
      <button className="task-trigger" aria-haspopup="menu" aria-expanded={open} title="Tasks: one conversation per goal" onClick={() => setOpen((o) => !o)}>
        {/* A blank conversation's label is a placeholder, greyed out, not a third "New task" button. */}
        {dot && <span className={`task-dot ${dot}`} title={dot === 'ask' ? 'Needs you' : dot === 'busy' ? 'At work' : dot === 'fail' ? 'The last turn didn’t finish' : 'Ready'} />}
        <span className={`task-trigger-title${agent.sessionId ? '' : ' muted'}`}>{agent.sessionId ? (agent.title ?? current?.title ?? 'Task') : 'New task'}</span>
        {current?.status === 'done' && <span className="task-done-badge">done</span>}
        {working > 0 && (
          <span className="task-count busy" title={`${working} other task${working > 1 ? 's' : ''} at work`}>
            <span className="tool-spinner" /> {working}
          </span>
        )}
        {waiting > 0 && (
          <span className="task-count attention" title={`${waiting} other task${waiting > 1 ? 's need' : ' needs'} you (a question, a permission or a new reply)`}>
            {waiting}
          </span>
        )}
        <span className="model-trigger-chevron">▾</span>
      </button>
      {open && (
        // For switching: New task, Done and the context meter are in the header already.
        <div className="task-popover" role="menu">
          {inProgress.length > 0 && <div className="task-section">In progress</div>}
          {inProgress.map(row)}
          {openTasks.length > 0 && <div className="task-section">Open</div>}
          {openTasks.map(row)}
          {doneTasks.length > 0 && <div className="task-section">Done</div>}
          {doneTasks.map(row)}
          {!agent.tasks.length && <div className="task-empty muted">No conversations yet.</div>}
          {agent.sessionId && (
            <div className="task-popover-footer">
              <button
                className="small"
                disabled={agent.running || agent.compacting}
                title="Summarize this conversation so far to free up the context window"
                onClick={() => {
                  setOpen(false);
                  void studio.compactTask();
                }}
              >
                {agent.compacting ? 'Compacting…' : 'Compact'}
              </button>
              <span className="muted">Summarize this conversation to free up room</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
