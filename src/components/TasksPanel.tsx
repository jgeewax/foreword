import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ASSISTANT_NAMES } from '../app/settings';
import { studio } from '../app/studio';
import { findInTask, isQuiet, needsYou, taskMeta, taskSections, whenLabel, type Listed, type TaskMatch, type TaskSection } from '../app/task-list';
import { chapterNumber, numberedTitle, type BookNames } from '../app/tool-labels';
import { modeConfig } from '../services/agent/modes';
import { onContextMenu } from '../lib/context-menu';
import { Store, useStore } from '../lib/store';
import { FileIcon, Icon } from './icons';
import { STATE_WORDS, TaskGlyph, useTaskList, type Task } from './TaskMenu';

// What the view shows, shared with its title bar's buttons and kept while
// another view is in front: the folded sections, the months shown, the task
// folded out, the search, and the tasks selected.
type ViewState = {
  closed: ReadonlySet<string>;
  months: ReadonlySet<string>;
  open: string | null;
  query: string;
  /** Only the tasks that changed the file in the editor. */
  here: boolean;
  selected: ReadonlySet<string>;
  anchor: string | null;
};
const view = new Store<ViewState>({ closed: new Set(), months: new Set(), open: null, query: '', here: false, selected: new Set(), anchor: null });

const SECTIONS = ['needs', 'work', 'open', 'done'];

/** ⏎ or space on a row that acts as a button. */
const onActivate = (run: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  run();
};

const toggled = (set: ReadonlySet<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/** The Tasks title bar's buttons: a new task, and fold every section or open them again. */
export function TasksActions() {
  const closed = useStore(view, (s) => s.closed);
  const all = SECTIONS.every((k) => closed.has(k));
  return (
    <>
      <button className="icon pane-action" title="New task (⌘T)" aria-label="New task" onClick={() => studio.newTask()}>
        <Icon name="plus" size={16} />
      </button>
      <button className="icon pane-action" title={all ? 'Expand all' : 'Collapse all'} aria-label={all ? 'Expand all' : 'Collapse all'} onClick={() => view.set({ closed: new Set(all ? [] : SECTIONS) })}>
        <Icon name={all ? 'expandAll' : 'collapseAll'} size={16} />
      </button>
    </>
  );
}

/** Quiet tasks the author said "Not now" to, per book: the offer comes back only for others. */
const tidyKey = (root: string) => `studio.tasksTidy:${root}`;
function readTidied(root: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(tidyKey(root)) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function writeTidied(root: string, ids: string[]) {
  try {
    localStorage.setItem(tidyKey(root), JSON.stringify(ids));
  } catch {}
}

/** A file a task changed, as the author knows it: "4. The Carew Murder Case", or its name. */
const fileLabel = (path: string, names: BookNames) => numberedTitle(path, names) ?? path.slice(path.lastIndexOf('/') + 1);

/** Where a search matched, when it isn't the title: "You asked: “…the fog…”". */
function Snippet({ match }: { match: TaskMatch }) {
  return (
    <span className="tasks-note">
      {match.where === 'asked' ? 'You asked' : 'It said'}: “{match.before}
      <mark>{match.match}</mark>
      {match.after}”
    </span>
  );
}

/** Under the task folded out: what the author asked, what it changed (each file opens its change), and what you can do with it. */
function TaskDetail({ task, names, busy }: { task: Task; names: BookNames; busy: boolean }) {
  const assistant = useStore(studio.store, (s) => ASSISTANT_NAMES[s.settings.assistant]);
  const files = Object.entries(task.files ?? {});
  const noted = !!task.mode || files.length > 0;
  const facts = [task.mode && modeConfig(task.mode).label, assistant, task.turns && `${task.turns} message${task.turns === 1 ? '' : 's'}`, task.tokens && `${Math.round(task.tokens / 1000)}k tokens`].filter(Boolean);
  return (
    <div className="tasks-detail">
      {task.asked && (
        <>
          <div className="tasks-detail-label">You asked</div>
          <div className="tasks-asked">{task.asked}</div>
        </>
      )}
      <div className="tasks-detail-label">Changed</div>
      {files.map(([path, f]) => {
        const show = () => void studio.showTaskChange(f.version, path);
        return (
          <div key={path} className="history-file" role="button" tabIndex={0} title={`What it changed in ${path}, side by side`} onClick={show} onKeyDown={onActivate(show)}>
            <FileIcon path={path} />
            <span className="history-path tasks-file">{fileLabel(path, names)}</span>
            <span className="history-counts">
              <span className="add-n">+{f.added}</span> <span className="del-n">−{f.deleted}</span>
            </span>
          </div>
        );
      })}
      {!files.length && <div className="tasks-none muted">{noted ? 'Nothing in the book.' : 'Not known: the task is from before Foreword kept track.'}</div>}
      <div className="tasks-facts muted">{facts.join(' · ')}</div>
      <div className="history-version-actions">
        {task.status === 'done' ? (
          <button className="change-action" title="Back under Open: it isn't finished" onClick={() => studio.reopenTask(task.sessionId)}>
            <Icon name="undo" size={14} />
            Open again
          </button>
        ) : (
          <button className="change-action" disabled={busy} title={busy ? 'It’s at work: stop it or let it finish first' : 'File it under Done, with a named version in History'} onClick={() => void studio.markTaskDone(task.sessionId)}>
            <Icon name="check" size={14} />
            Mark done
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Tasks: every conversation with the assistant in this book, what needs you
 * first, then what's at work, what's open, and what's done, by day and then
 * by month. A click shows the task in the assistant pane and folds out what
 * it changed here (as a version in History); a click on it again folds it up.
 */
export function TasksPanel() {
  const { listed, sessionId } = useTaskList();
  const names = useStore(studio.store, (s) => s.names);
  const active = useStore(studio.store, (s) => s.active);
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready');
  const root = useStore(studio.store, (s) => s.workspace?.root ?? '');
  const v = useStore(view, (s) => s);
  const [tidied, setTidied] = useState<string[]>(() => readTidied(root));
  useEffect(() => setTidied(readTidied(root)), [root]);
  const now = Date.now();

  // The file in the editor: "This chapter" (or file) lists the tasks that changed it.
  const herePath = active && /\.(typ|md)$/.test(active) ? active : null;
  const hereLabel = herePath && chapterNumber(herePath, names) ? 'This chapter' : 'This file';
  const here = v.here && !!herePath;
  const query = v.query.trim();
  const filtering = !!query || here;
  const matches = new Map<string, TaskMatch>();
  const shown = listed.filter((i) => {
    if (here && !i.task.files?.[herePath!]) return false;
    const m = findInTask(i.task, query);
    if (m) matches.set(i.task.sessionId, m);
    return !!m;
  });
  const sections = taskSections(shown, now);
  // In the order shown, for ⇧-click.
  const order: string[] = [];
  const quiet = listed.filter((i) => isQuiet(i.task, i.live, now)).map((i) => i.task.sessionId);
  const offerTidy = !filtering && quiet.some((id) => !tidied.includes(id));

  const select = (id: string, e: MouseEvent) => {
    if (e.metaKey) return view.set((s) => ({ selected: toggled(s.selected, id), anchor: id }));
    const from = order.indexOf(v.anchor ?? '');
    const to = order.indexOf(id);
    if (from < 0 || to < 0) return view.set({ selected: new Set([id]), anchor: id });
    view.set({ selected: new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1)) });
  };
  const pick = (id: string, e?: MouseEvent) => {
    if (e && (e.metaKey || e.shiftKey)) return select(id, e);
    view.set((s) => ({ selected: new Set(), anchor: id, open: s.open === id && id === sessionId ? null : id }));
    void studio.openTask(id);
  };
  const markSelected = () => {
    void studio.markTasksDone([...v.selected]);
    view.set({ selected: new Set() });
  };

  const row = ({ task, live }: Listed<Task>) => {
    const id = task.sessionId;
    order.push(id);
    const open = v.open === id;
    const selected = v.selected.has(id);
    const match = matches.get(id);
    // Filtered to the file in the editor: what it changed there, and how many other files.
    const meta = taskMeta(task, names);
    const there = here ? task.files?.[herePath!] : undefined;
    const others = here ? Object.keys(task.files ?? {}).length - 1 : 0;
    let second: ReactNode = null;
    if (live.note) second = <span className={`tasks-note n-${live.state}`}>{live.note}</span>;
    else if (match && !match.inTitle && match.match) second = <Snippet match={match} />;
    else if (there)
      second = (
        <span className="tasks-meta">
          {task.mode && `${modeConfig(task.mode).label} · `}
          <span className="add-n">+{there.added}</span> <span className="del-n">−{there.deleted}</span>
          {others > 0 && ` · and ${others} more file${others === 1 ? '' : 's'}`}
        </span>
      );
    else if (meta)
      second = (
        <span className="tasks-meta">
          {meta.text}
          {meta.changed && (
            <>
              <span className="add-n">+{meta.added}</span> <span className="del-n">−{meta.deleted}</span>
            </>
          )}
        </span>
      );
    const busy = live.state === 'working';
    return (
      <div key={id} className={`tasks-item${open ? ' open' : ''}${id === sessionId ? ' shown' : ''}${selected ? ' selected' : ''}`} data-task={id}>
        <div
          className={`tasks-row st-${live.state}${isQuiet(task, live, now) ? ' quiet' : ''}`}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-label={`${task.title}, ${STATE_WORDS[live.state]}${live.note ? `: ${live.note}` : ''}`}
          title={open && id === sessionId ? 'Fold up what it changed' : 'Show it in the assistant pane, and what it changed here'}
          onClick={(e) => pick(id, e)}
          onKeyDown={onActivate(() => pick(id))}
          onContextMenu={onContextMenu(() => {
            const many = selected && v.selected.size > 1;
            return [
              { label: 'Open', action: () => void studio.openTask(id) },
              'separator',
              many
                ? { label: `Mark ${v.selected.size} Done`, action: markSelected }
                : task.status === 'done'
                  ? { label: 'Open Again (Not Done)', action: () => studio.reopenTask(id) }
                  : { label: 'Mark Done', enabled: !busy, action: () => void studio.markTaskDone(id) },
            ];
          })}
        >
          <TaskGlyph state={live.state} />
          <span className="tasks-text">
            <span className="tasks-line">
              <span className="tasks-title">{task.title}</span>
              <span className="tasks-when">{whenLabel(task.updated, now)}</span>
            </span>
            {second}
          </span>
        </div>
        {open && <TaskDetail task={task} names={names} busy={busy} />}
      </div>
    );
  };

  const section = (s: TaskSection<Task>) => {
    const open = filtering || !v.closed.has(s.key);
    return (
      <section key={s.key} className={`tasks-section s-${s.key}`}>
        <button className="tasks-section-head" aria-expanded={open} disabled={filtering} onClick={() => view.set((st) => ({ closed: toggled(st.closed, s.key) }))}>
          <span className={`tasks-twisty${open ? ' open' : ''}`}>
            <Icon name="chevronRight" size={16} />
          </span>
          {s.label}
          <span className={`tasks-count${s.key === 'needs' ? ' attention' : s.key === 'work' ? ' busy' : ''}`}>{s.count}</span>
        </button>
        {open && s.key === 'open' && offerTidy && (
          <div className="tasks-tidy">
            <span>
              {quiet.length} open task{quiet.length === 1 ? ' hasn’t' : 's haven’t'} moved in two weeks or more.
            </span>
            <span className="tasks-tidy-actions">
              <button className="small" onClick={() => void studio.markTasksDone(quiet)}>
                Mark {quiet.length === 1 ? 'it' : 'them'} done
              </button>
              <button className="small" onClick={() => view.set({ selected: new Set(quiet), anchor: quiet[0] })}>
                Select {quiet.length === 1 ? 'it' : 'them'}
              </button>
              <button
                className="small"
                onClick={() => {
                  const next = [...new Set([...tidied, ...quiet])].slice(-500);
                  writeTidied(root, next);
                  setTidied(next);
                }}
              >
                Not now
              </button>
            </span>
          </div>
        )}
        {open &&
          s.groups.map((g) => {
            if (!g.month) return g.label ? [<div key={g.key} className="tasks-day">{g.label}</div>, ...g.items.map(row)] : g.items.map(row);
            const shownMonth = filtering || v.months.has(g.key);
            return (
              <div key={g.key} className="tasks-month">
                <button className="tasks-month-head" aria-expanded={shownMonth} disabled={filtering} onClick={() => view.set((st) => ({ months: toggled(st.months, g.key) }))}>
                  <span className={`tasks-twisty${shownMonth ? ' open' : ''}`}>
                    <Icon name="chevronRight" size={16} />
                  </span>
                  {g.label}
                  <span className="tasks-month-count">{g.items.length}</span>
                </button>
                {shownMonth && g.items.map(row)}
              </div>
            );
          })}
      </section>
    );
  };

  const total = shown.length;
  const hereName = herePath ? fileLabel(herePath, names) : '';
  return (
    <div className="tasks-panel" onKeyDown={(e) => e.key === 'Escape' && v.selected.size > 0 && view.set({ selected: new Set() })}>
      <div className="tasks-search">
        <label className="search-box">
          <input
            value={v.query}
            placeholder="Search tasks"
            aria-label="Search tasks"
            spellCheck={false}
            onChange={(e) => view.set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && v.query) {
                e.preventDefault();
                e.stopPropagation();
                view.set({ query: '' });
              }
            }}
          />
        </label>
        <button
          className={`tasks-here${here ? ' on' : ''}`}
          aria-pressed={here}
          disabled={!herePath}
          title={herePath ? `Only the tasks that changed ${hereName}` : 'Open a chapter to see the tasks that changed it'}
          onClick={() => view.set((s) => ({ here: !s.here }))}
        >
          <Icon name="target" size={13} />
          {hereLabel}
        </button>
      </div>
      {filtering && (
        <div className="tasks-filter muted">
          <span>
            {total} task{total === 1 ? '' : 's'}
            {here && ` changed ${hereName}`}
            {query && ` matching “${query}”`}
          </span>
          <button className="link" onClick={() => view.set({ query: '', here: false })}>
            Show all
          </button>
        </div>
      )}
      <div className="tasks-list">
        {sections.map(section)}
        {!listed.length && (
          <div className="tasks-empty">
            <Icon name="tasks" size={36} />
            {ready ? (
              <>
                <div className="tasks-empty-title">No tasks yet</div>
                <p className="muted">Each conversation with the assistant is a task with one goal. Ask it something and it shows up here, with what it changed in the book.</p>
                <button className="primary" onClick={() => studio.newTask()}>
                  New Task <kbd>⌘T</kbd>
                </button>
              </>
            ) : (
              <p className="muted">The book’s tasks show here once the assistant has started.</p>
            )}
          </div>
        )}
        {listed.length > 0 && filtering && !total && <div className="tasks-empty-line muted">{query ? `No tasks match “${query}”.` : `No task has changed ${hereName} yet.`}</div>}
      </div>
      {v.selected.size > 0 && (
        <div className="tasks-selection">
          <span>{v.selected.size} selected</span>
          <button className="small" onClick={markSelected}>
            Mark done
          </button>
          <button className="small" onClick={() => view.set({ selected: new Set() })}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** For the activity bar: how many tasks need the author, and how many are at work. */
export function useTaskCounts() {
  const { listed } = useTaskList();
  return { needs: listed.filter((i) => needsYou(i.live)).length, working: listed.filter((i) => i.live.state === 'working').length, open: listed.filter((i) => i.live.state === 'open').length };
}

