// Git's marks on the book's files, as VS Code's: each status's letter and
// colour, and, for the Files view, what each file and folder shows.
import type { GitFile, GitStatus } from './ipc';

type Status = GitFile['status'];

/** Each status's letter and what it means, as VS Code's (`?` shows as U, a conflict as !). */
export const GIT_STATUS: Record<Status, { letter: string; title: string }> = {
  M: { letter: 'M', title: 'Modified' },
  A: { letter: 'A', title: 'Added' },
  '?': { letter: 'U', title: 'Untracked: new, not in Git yet' },
  D: { letter: 'D', title: 'Deleted' },
  R: { letter: 'R', title: 'Renamed' },
  U: { letter: '!', title: 'Conflict: both sides changed it' },
};

/** The class a status colours a row with (`git-M`…; untracked is `git-new`), as Source Control's rows. */
export const gitClass = (status: Status) => `git-${status === '?' ? 'new' : status}`;

/** Which status a folder takes from what's in it: a conflict first, then a change, then what's new. */
const WEIGHT: Record<Status, number> = { U: 5, M: 4, D: 3, A: 2, R: 1, '?': 0 };

/** A file's status; a folder's strongest one, and how many files in it changed. */
export type GitMark = { status: Status; changed: number };

/**
 * What the Files view marks: each changed file, and every folder above one.
 * A file staged and changed again shows the change (as VS Code's: the
 * working tree's status over the index's), a conflict over both.
 */
export function gitMarks(repo: GitStatus | null): Map<string, GitMark> {
  const marks = new Map<string, GitMark>();
  if (!repo) return marks;
  const files = new Map<string, Status>();
  for (const f of repo.staged) files.set(f.path, f.status);
  for (const f of repo.files) files.set(f.path, f.status);
  for (const [path, status] of files) {
    marks.set(path, { status, changed: 1 });
    for (let i = path.indexOf('/'); i > 0; i = path.indexOf('/', i + 1)) {
      const folder = path.slice(0, i);
      const mark = marks.get(folder);
      if (!mark) marks.set(folder, { status, changed: 1 });
      else marks.set(folder, { status: WEIGHT[status] > WEIGHT[mark.status] ? status : mark.status, changed: mark.changed + 1 });
    }
  }
  return marks;
}
