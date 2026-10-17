import { useEffect, useRef, useState } from 'react';
import { studio } from '../app/studio';
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
        <span className="context-bar">
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
      )}
      {k(tokens)}
      {window_ ? ` / ${k(window_)}` : ''}
    </span>
  );
}

/** The current task, and a list of the book's other tasks (conversations). */
export function TaskMenu() {
  const agent = useStore(studio.store, (s) => s.agent);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = agent.tasks.find((t) => t.sessionId === agent.sessionId);

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

  const openTasks = agent.tasks.filter((t) => t.status === 'open');
  const doneTasks = agent.tasks.filter((t) => t.status === 'done');
  const row = (t: (typeof agent.tasks)[number]) => (
    <button
      key={t.sessionId}
      className={`task-row${t.sessionId === agent.sessionId ? ' current' : ''}${t.status === 'done' ? ' done' : ''}`}
      disabled={agent.running}
      onClick={() => {
        setOpen(false);
        void studio.switchTask(t.sessionId);
      }}
    >
      <span className="task-status">{t.status === 'done' ? '✓' : t.sessionId === agent.sessionId ? '●' : '○'}</span>
      <span className="task-title">{t.title}</span>
      <span className="task-when">{ago(t.updated)}</span>
    </button>
  );

  return (
    <div className="task-menu" ref={rootRef}>
      <button className="task-trigger" aria-haspopup="menu" aria-expanded={open} title="Tasks: one conversation per goal" onClick={() => setOpen((o) => !o)}>
        <span className="task-trigger-title">{agent.sessionId ? (agent.title ?? current?.title ?? 'Task') : 'New task'}</span>
        {current?.status === 'done' && <span className="task-done-badge">done</span>}
        <span className="model-trigger-chevron">▾</span>
      </button>
      {open && (
        <div className="task-popover" role="menu">
          <div className="task-popover-actions">
            <button
              className="primary"
              disabled={agent.running}
              onClick={() => {
                setOpen(false);
                studio.newSession();
              }}
            >
              New task
            </button>
            {agent.sessionId && (
              <button
                disabled={agent.running || agent.compacting}
                title="Summarize this conversation so far to free up the context window"
                onClick={() => {
                  setOpen(false);
                  void studio.compactTask();
                }}
              >
                {agent.compacting ? 'Compacting…' : 'Compact'}
              </button>
            )}
            <span className="spacer" />
            <ContextMeter />
          </div>
          {openTasks.length > 0 && <div className="task-section">Open</div>}
          {openTasks.map(row)}
          {doneTasks.length > 0 && <div className="task-section">Done</div>}
          {doneTasks.map(row)}
          {!agent.tasks.length && <div className="task-empty muted">No conversations yet.</div>}
        </div>
      )}
    </div>
  );
}
