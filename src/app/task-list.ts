// The book's tasks as the sidebar's Tasks view and the assistant pane's menu
// list them: each one's state right now, grouped (needs you, at work, open,
// done by day and then by month), what it changed, and finding one.

import type { BackgroundTask } from './studio';
import type { TaskSummary } from './tasks';
import { chapterNumber, type BookNames } from './tool-labels';
import { modeConfig } from '../services/agent/modes';

export type TaskState = 'question' | 'permission' | 'unread' | 'stopped' | 'working' | 'open' | 'done';

/** The states that need the author: a question, a permission, a reply not yet seen, a turn that didn't finish. */
export const NEEDS_YOU: readonly TaskState[] = ['question', 'permission', 'unread', 'stopped'];

/** A task's state, and what's going on in a few words ("Reading “The Storm” (chapter 2)"); no words when nothing is. */
export type TaskLive = { state: TaskState; note: string };

/** The shown conversation, as the chat has it; the others, as their events left them. */
export type LiveSource = {
  sessionId: string | null;
  running: boolean;
  /** What the shown turn is doing, in words. */
  activity: string;
  /** The shown conversation waits on the author. */
  asking: 'question' | 'permission' | null;
  /** The question it asked, or what it asks permission for. */
  asks?: string;
  /** Its last turn didn't finish. */
  stopped: boolean;
  background: Record<string, BackgroundTask>;
};

export function taskLive(task: Pick<TaskSummary, 'sessionId' | 'status'>, src: LiveSource): TaskLive {
  if (task.sessionId === src.sessionId) {
    if (src.asking === 'question') return { state: 'question', note: src.asks ? `Has a question: ${src.asks}` : 'Has a question' };
    if (src.asking === 'permission') return { state: 'permission', note: src.asks ? `Asks to ${src.asks}` : 'Asks permission' };
    if (src.running) return { state: 'working', note: src.activity || 'Working…' };
    if (src.stopped) return { state: 'stopped', note: 'Stopped: the last turn didn’t finish' };
    return { state: task.status, note: '' };
  }
  const bg = src.background[task.sessionId];
  if (bg?.attention) return { state: bg.attention, note: bg.attention === 'question' ? 'Has a question' : 'Asks permission' };
  if (bg?.running) return { state: 'working', note: bg.label || 'Working…' };
  if (bg?.unread) return bg.failed ? { state: 'stopped', note: `Stopped: ${bg.failed}` } : { state: 'unread', note: 'New reply' };
  return { state: task.status, note: '' };
}

export const needsYou = (live: TaskLive) => NEEDS_YOU.includes(live.state);

const DAY = 86_400_000;
const QUIET_DAYS = 14;

const startOfDay = (ms: number, daysBack = 0) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
};

/** When a task last changed, short enough for a sidebar row: "4 min", "3 h", "Yesterday", "Thu", "Oct 19". */
export function whenLabel(ms: number, now: number): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min} min`;
  if (ms >= startOfDay(now)) return `${Math.floor(min / 60)} h`;
  if (ms >= startOfDay(now, 1)) return 'Yesterday';
  const d = new Date(ms);
  if (ms >= startOfDay(now, 6)) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/** Open, nothing going on, and untouched for two weeks or more: offered for tidying. */
export const isQuiet = (task: Pick<TaskSummary, 'updated'>, live: TaskLive, now: number) => live.state === 'open' && task.updated < now - QUIET_DAYS * DAY;

/** Where a done task is filed: the day for this week, the month before that. */
export function doneGroup(ms: number, now: number): { key: string; label: string; month: boolean } {
  if (ms >= startOfDay(now)) return { key: 'today', label: 'Today', month: false };
  if (ms >= startOfDay(now, 1)) return { key: 'yesterday', label: 'Yesterday', month: false };
  if (ms >= startOfDay(now, 6)) return { key: 'week', label: 'This week', month: false };
  const d = new Date(ms);
  const n = new Date(now);
  const month = d.toLocaleDateString([], { month: 'long', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
  const sameMonth = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: sameMonth ? `Earlier in ${month}` : month, month: true };
}

export type Listed<T> = { task: T; live: TaskLive };
export type TaskGroup<T> = { key: string; label: string; month: boolean; items: Listed<T>[] };
export type TaskSection<T> = { key: 'needs' | 'work' | 'open' | 'done'; label: string; count: number; groups: TaskGroup<T>[] };

/** When a done task was done (or, from before Foreword noted it, last changed). */
const doneTime = (t: Pick<TaskSummary, 'updated' | 'doneAt'>) => t.doneAt ?? t.updated;

/**
 * The sections, in order, each only when it has tasks: Needs you, At work,
 * Open (newest first), and Done, by day this week and by month before.
 */
export function taskSections<T extends Pick<TaskSummary, 'updated' | 'doneAt'>>(items: Listed<T>[], now: number): TaskSection<T>[] {
  const plain = (key: string, list: Listed<T>[]): TaskGroup<T>[] => [{ key, label: '', month: false, items: list }];
  const byUpdated = (a: Listed<T>, b: Listed<T>) => b.task.updated - a.task.updated;
  const needs = items.filter((i) => needsYou(i.live)).sort(byUpdated);
  const work = items.filter((i) => i.live.state === 'working').sort(byUpdated);
  const open = items.filter((i) => i.live.state === 'open').sort(byUpdated);
  const done = items.filter((i) => i.live.state === 'done').sort((a, b) => doneTime(b.task) - doneTime(a.task));
  const groups: TaskGroup<T>[] = [];
  for (const i of done) {
    const g = doneGroup(doneTime(i.task), now);
    const last = groups[groups.length - 1];
    if (last?.key === g.key) last.items.push(i);
    else groups.push({ ...g, items: [i] });
  }
  const sections: TaskSection<T>[] = [];
  if (needs.length) sections.push({ key: 'needs', label: 'Needs you', count: needs.length, groups: plain('needs', needs) });
  if (work.length) sections.push({ key: 'work', label: 'At work', count: work.length, groups: plain('work', work) });
  if (open.length) sections.push({ key: 'open', label: 'Open', count: open.length, groups: plain('open', open) });
  if (done.length) sections.push({ key: 'done', label: 'Done', count: done.length, groups });
  return sections;
}

/** The files a task changed, by name: "ch. 1, 2" for chapters, else the file, or how many. */
export function changedWhere(paths: string[], names: BookNames): string {
  if (!paths.length) return '';
  const chapters = paths.map((p) => chapterNumber(p, names));
  const allChapters = chapters.every((n) => n != null);
  if (paths.length > 3) return `${paths.length} ${allChapters ? 'chapters' : 'files'}`;
  if (allChapters) return `ch. ${(chapters as number[]).sort((a, b) => a - b).join(', ')}`;
  if (paths.length === 1) return paths[0].slice(paths[0].lastIndexOf('/') + 1);
  return `${paths.length} files`;
}

/** Lines added and removed over a task's files. */
export function changedLines(files: TaskSummary['files']): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const f of Object.values(files ?? {})) {
    added += f.added;
    deleted += f.deleted;
  }
  return { added, deleted };
}

/**
 * A quiet task's second line: the mode it last ran in, then what it changed
 * ("Write · ch. 1, 2 ·", with the counts after) or "no changes". Null for a
 * task from before Foreword noted these.
 */
export function taskMeta(task: Pick<TaskSummary, 'mode' | 'files'>, names: BookNames): { text: string; added: number; deleted: number; changed: boolean } | null {
  const paths = Object.keys(task.files ?? {});
  if (!task.mode && !paths.length) return null;
  const mode = task.mode ? modeConfig(task.mode).label : '';
  const { added, deleted } = changedLines(task.files);
  if (!paths.length) return { text: `${mode} · no changes`, added: 0, deleted: 0, changed: false };
  return { text: [mode, changedWhere(paths, names)].filter(Boolean).join(' · ') + ' · ', added, deleted, changed: true };
}

/** A match in a task, and, when it isn't in the title, where it is, cut round the match. */
export type TaskMatch = { inTitle: boolean; where?: 'asked' | 'said'; before?: string; match?: string; after?: string };

/** Find words in a task: its title, the author's first message, its latest reply. */
export function findInTask(task: Pick<TaskSummary, 'title' | 'asked' | 'said'>, query: string): TaskMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { inTitle: false };
  if (task.title.toLowerCase().includes(q)) return { inTitle: true };
  for (const where of ['asked', 'said'] as const) {
    const text = (task[where] ?? '').replace(/\s+/g, ' ');
    const at = text.toLowerCase().indexOf(q);
    if (at < 0) continue;
    const from = Math.max(0, at - 24);
    const to = at + q.length;
    return { inTitle: false, where, before: `${from > 0 ? '…' : ''}${text.slice(from, at)}`, match: text.slice(at, to), after: `${text.slice(to, to + 40)}${to + 40 < text.length ? '…' : ''}` };
  }
  return null;
}

/** One line of text, at most `max` characters. */
export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** A reply's words on one line: without its code blocks, link targets, headings, quotes, bullets, bold and code marks. */
export function plainLine(markdown: string, max: number): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+)/gm, '')
    .replace(/\*\*|[*`]/g, '');
  return clip(text, max);
}
