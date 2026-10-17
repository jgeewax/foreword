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

  // In progress: the shown one while it runs, and any at work or waiting in the background.
  const busy = (id: string) => (id === agent.sessionId ? agent.running : !!agent.background[id]);
  const inProgress = agent.tasks.filter((t) => busy(t.sessionId));
  const openTasks = agent.tasks.filter((t) => t.status === 'open' && !busy(t.sessionId));
  const doneTasks = agent.tasks.filter((t) => t.status === 'done' && !busy(t.sessionId));
  const status = (t: (typeof agent.tasks)[number]) => {
    if (t.sessionId === agent.sessionId) return agent.running ? { icon: <span className="tool-spinner" />, text: 'working', tone: 'busy' } : { icon: '●', text: '', tone: 'current' };
    const bg = agent.background[t.sessionId];
    if (bg?.attention) return { icon: '!', text: bg.attention === 'question' ? 'has a question' : 'asks permission', tone: 'attention' };
    if (bg?.running) return { icon: <span className="tool-spinner" />, text: bg.label, tone: 'busy' };
    if (bg?.unread) return { icon: '●', text: bg.failed ? 'stopped' : 'new reply', tone: bg.failed ? 'failed' : 'unread' };
    return { icon: t.status === 'done' ? '✓' : '○', text: '', tone: '' };
  };
  const row = (t: (typeof agent.tasks)[number]) => {
    const st = status(t);
    return (
      <button
        key={t.sessionId}
        className={`task-row${t.sessionId === agent.sessionId ? ' current' : ''}${t.status === 'done' ? ' done' : ''} ${st.tone}`}
        onClick={() => {
          setOpen(false);
          void studio.switchTask(t.sessionId);
        }}
      >
        <span className="task-status">{st.icon}</span>
        <span className="task-title">
          {t.title}
          {st.text && <span className="task-doing">{st.text}</span>}
        </span>
        <span className="task-when">{ago(t.updated)}</span>
      </button>
    );
  };
  // On the trigger: how many others are at work, and whether any needs the author.
  const others = Object.values(agent.background);
  const working = others.filter((b) => b.running).length;
  const waiting = others.filter((b) => b.attention || b.unread).length;

  return (
    <div className="task-menu" ref={rootRef}>
      <button className="task-trigger" aria-haspopup="menu" aria-expanded={open} title="Tasks: one conversation per goal" onClick={() => setOpen((o) => !o)}>
        <span className="task-trigger-title">{agent.sessionId ? (agent.title ?? current?.title ?? 'Task') : 'New task'}</span>
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
        <div className="task-popover" role="menu">
          <div className="task-popover-actions">
            <button
              className="primary"
              title={agent.running ? 'This one carries on in the background' : undefined}
              onClick={() => {
                setOpen(false);
                studio.newSession();
              }}
            >
              New task
            </button>
            {agent.sessionId && current?.status !== 'done' && (
              <button
                disabled={agent.running}
                title="Mark this task done (a named version in History), and start a new one"
                onClick={() => {
                  setOpen(false);
                  void studio.finishTask();
                }}
              >
                Mark done
              </button>
            )}
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
          {inProgress.length > 0 && <div className="task-section">In progress</div>}
          {inProgress.map(row)}
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
