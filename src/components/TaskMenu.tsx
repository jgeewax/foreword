import { useEffect, useRef, useState } from 'react';
import { activityText, pendingQuestion, studio } from '../app/studio';
import { findInTask, taskLive, whenLabel, needsYou, type Listed, type LiveSource, type TaskLive, type TaskState } from '../app/task-list';
import { describePermission } from '../app/tool-labels';
import { onContextMenu } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { Icon } from './icons';

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

/** How full the conversation is, against the model's context window: '' while there's room, then warn and bad. */
export function useContextUse() {
  const tokens = useStore(studio.store, (s) => s.agent.contextTokens);
  const window_ = useStore(studio.store, (s) => s.agent.models.find((m) => m.providerID === s.agent.model?.providerID && m.id === s.agent.model?.id)?.contextWindow ?? null);
  const share = tokens && window_ ? Math.min(1, tokens / window_) : null;
  const tone = share == null ? '' : share > 0.8 ? 'bad' : share > 0.55 ? 'warn' : '';
  return { tokens, window: window_, share, tone };
}

/** How full the conversation is, against the model's context window. */
export function ContextMeter() {
  const { tokens, window: window_, share, tone } = useContextUse();
  if (!tokens) return null;
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

export type Task = ReturnType<typeof studio.store.get>['agent']['tasks'][number];

/**
 * The book's tasks, each with its state right now: the shown one's from the
 * chat, the others' from their events. Read in slices, so a reply streaming
 * in doesn't redraw the list.
 */
export function useTaskList() {
  const tasks = useStore(studio.store, (s) => s.agent.tasks);
  const sessionId = useStore(studio.store, (s) => s.agent.sessionId);
  const running = useStore(studio.store, (s) => s.agent.running);
  const activity = useStore(studio.store, (s) => activityText(s.agent.activity));
  const background = useStore(studio.store, (s) => s.agent.background);
  const dot = useTaskDot();
  const asking = useStore(studio.store, (s): LiveSource['asking'] => {
    if (pendingQuestion(s.agent) || s.agent.activity?.phase === 'asking') return 'question';
    return s.agent.items.some((it) => it.kind === 'permission' && (it.state === 'pending' || it.state === 'sending')) ? 'permission' : null;
  });
  const asks = useStore(studio.store, (s) => {
    const q = pendingQuestion(s.agent);
    if (q) return q.fields[0]?.title ?? q.fields[0]?.description ?? '';
    const p = s.agent.items.find((it) => it.kind === 'permission' && (it.state === 'pending' || it.state === 'sending'));
    return p?.kind === 'permission' ? describePermission(p.action, p.resources, s.names).what : '';
  });
  const stopped = useStore(studio.store, (s) => s.agent.stopped) || dot === 'fail';
  const src: LiveSource = { sessionId, running, activity, asking, asks: asks || undefined, stopped, background };
  const listed: Listed<Task>[] = tasks.map((task) => ({ task, live: taskLive(task, src) }));
  return { listed, sessionId, running };
}

/** A task's state as a mark: amber for one that needs you, blue at work, red stopped, a ring open, a tick done. */
export function TaskGlyph({ state }: { state: TaskState }) {
  return <span className={`task-glyph g-${state}`} aria-hidden />;
}

/** The state's words for a screen reader, where the mark has none. */
export const STATE_WORDS: Record<TaskState, string> = { question: 'needs you', permission: 'needs you', unread: 'new reply', stopped: 'stopped', working: 'at work', open: 'open', done: 'done' };

/** One task in the pane's menu: its state, title and when it last changed, and what's going on under it. */
function MenuRow({ task, live, current, now, onPick }: { task: Task; live: TaskLive; current: boolean; now: number; onPick: () => void }) {
  return (
    <button
      className={`task-row st-${live.state}${current ? ' current' : ''}`}
      aria-label={`${task.title}, ${STATE_WORDS[live.state]}`}
      onClick={onPick}
      onContextMenu={onContextMenu(() => [
        { label: 'Open', action: () => void studio.switchTask(task.sessionId) },
        task.status === 'done'
          ? { label: 'Open Again (Not Done)', action: () => studio.reopenTask(task.sessionId) }
          : { label: 'Mark Done', enabled: live.state !== 'working', action: () => void studio.markTaskDone(task.sessionId) },
      ])}
    >
      <TaskGlyph state={live.state} />
      <span className="task-row-text">
        <span className="task-row-line">
          <span className="task-title">{task.title}</span>
          <span className="task-when">{whenLabel(task.updated, now)}</span>
        </span>
        {live.note && <span className={`task-note n-${live.state}`}>{live.note}</span>}
      </span>
    </button>
  );
}

/** The shown task's state, as a dot by its title: at work, needs you, didn't finish, or done for now. */
export function useTaskDot(): string {
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

/** Open tasks the menu lists besides the ones that need you or are at work. */
const RECENT = 3;

/**
 * The current task, and a menu for switching: the tasks that need you, those
 * at work, and the last few open ones; type to find any other. The Tasks view
 * in the sidebar has them all.
 */
export function TaskMenu() {
  const { listed, sessionId } = useTaskList();
  const title = useStore(studio.store, (s) => s.agent.title);
  const compacting = useStore(studio.store, (s) => s.agent.compacting);
  const running = useStore(studio.store, (s) => s.agent.running);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const current = listed.find((i) => i.task.sessionId === sessionId);
  const dot = useTaskDot();

  useEffect(() => {
    if (!open) return;
    setQuery('');
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

  const now = Date.now();
  const pick = (id: string) => {
    setOpen(false);
    void studio.switchTask(id);
  };
  const row = (i: Listed<Task>) => <MenuRow key={i.task.sessionId} task={i.task} live={i.live} current={i.task.sessionId === sessionId} now={now} onPick={() => pick(i.task.sessionId)} />;
  const needs = listed.filter((i) => needsYou(i.live));
  const working = listed.filter((i) => i.live.state === 'working');
  const recent = listed.filter((i) => i.live.state === 'open').slice(0, RECENT);
  const found = query.trim() ? listed.filter((i) => findInTask(i.task, query)).slice(0, 12) : null;
  // On the trigger: how many others are at work, and whether any needs the author.
  const others = listed.filter((i) => i.task.sessionId !== sessionId);
  const othersWorking = others.filter((i) => i.live.state === 'working').length;
  const othersWaiting = others.filter((i) => needsYou(i.live)).length;

  return (
    <div className="task-menu" ref={rootRef}>
      <button className="task-trigger" aria-haspopup="menu" aria-expanded={open} title="Tasks: one conversation per goal" onClick={() => setOpen((o) => !o)}>
        {/* A blank conversation's label is a placeholder, greyed out, not a third "New task" button. */}
        {dot && <span className={`task-dot ${dot}`} title={dot === 'ask' ? 'Needs you' : dot === 'busy' ? 'At work' : dot === 'fail' ? 'The last turn didn’t finish' : 'Ready'} />}
        <span className={`task-trigger-title${sessionId ? '' : ' muted'}`}>{sessionId ? (title ?? current?.task.title ?? 'Task') : 'New task'}</span>
        {current?.task.status === 'done' && <span className="task-done-badge">done</span>}
        {othersWorking > 0 && (
          <span className="task-count busy" title={`${othersWorking} other task${othersWorking > 1 ? 's' : ''} at work`}>
            <span className="tool-spinner" /> {othersWorking}
          </span>
        )}
        {othersWaiting > 0 && (
          <span className="task-count attention" title={`${othersWaiting} other task${othersWaiting > 1 ? 's need' : ' needs'} you (a question, a permission or a new reply)`}>
            {othersWaiting}
          </span>
        )}
        <span className="model-trigger-chevron">▾</span>
      </button>
      {open && (
        // For switching: New task, Done and the context meter are on the message box already.
        <div className="task-popover" role="menu">
          <label className="task-find">
            <Icon name="search" size={13} />
            <input autoFocus value={query} placeholder="Find a task" aria-label="Find a task" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {found ? (
            <>
              {found.map(row)}
              {!found.length && <div className="task-empty muted">No task matches “{query.trim()}”.</div>}
            </>
          ) : (
            <>
              {needs.length > 0 && (
                <div className="task-section">
                  Needs you<span className="task-section-count attention">{needs.length}</span>
                </div>
              )}
              {needs.map(row)}
              {working.length > 0 && (
                <div className="task-section">
                  At work<span className="task-section-count busy">{working.length}</span>
                </div>
              )}
              {working.map(row)}
              {recent.length > 0 && <div className="task-section">Recent</div>}
              {recent.map(row)}
              {!listed.length && <div className="task-empty muted">No conversations yet.</div>}
            </>
          )}
          {listed.length > 0 && (
            <button
              className="task-all"
              onClick={() => {
                setOpen(false);
                studio.showTasks();
              }}
            >
              <Icon name="tasks" size={16} />
              All tasks, in the sidebar
              <span className="task-all-count">{listed.length}</span>
            </button>
          )}
          {sessionId && (
            <div className="task-popover-footer">
              <button
                className="small"
                disabled={running || compacting}
                title="Summarize this conversation so far to free up the context window"
                onClick={() => {
                  setOpen(false);
                  void studio.compactTask();
                }}
              >
                {compacting ? 'Compacting…' : 'Compact'}
              </button>
              <span className="muted">Summarize this conversation to free up room</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
