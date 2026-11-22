import { describe, expect, it } from 'vitest';
import { gitClass, gitMarks } from './git-marks';
import type { GitFile, GitStatus } from './ipc';

const repo = (staged: GitFile[], files: GitFile[]): GitStatus => ({ root: '/book', prefix: '', branch: 'main', upstream: null, ahead: 0, behind: 0, staged, files, remotes: [] });
const f = (status: GitFile['status'], path: string): GitFile => ({ status, path });

describe('gitMarks', () => {
  it('marks nothing outside a repository, or when everything is committed', () => {
    expect(gitMarks(null).size).toBe(0);
    expect(gitMarks(repo([], [])).size).toBe(0);
  });

  it('marks each changed file and every folder above it', () => {
    const marks = gitMarks(repo([], [f('M', 'src/chapters/one.typ'), f('?', 'notes.md')]));
    expect(Object.fromEntries(marks)).toEqual({
      'src/chapters/one.typ': { status: 'M', changed: 1 },
      'src/chapters': { status: 'M', changed: 1 },
      src: { status: 'M', changed: 1 },
      'notes.md': { status: '?', changed: 1 },
    });
  });

  it('shows the change over what was staged, and a conflict over both', () => {
    const marks = gitMarks(repo([f('A', 'a.typ'), f('M', 'b.typ'), f('M', 'c.typ')], [f('M', 'a.typ'), f('U', 'b.typ')]));
    expect(marks.get('a.typ')?.status).toBe('M');
    expect(marks.get('b.typ')?.status).toBe('U');
    expect(marks.get('c.typ')?.status).toBe('M');
  });

  it('gives a folder its strongest status and counts each file once', () => {
    const marks = gitMarks(repo([f('M', 'ch/a.typ')], [f('?', 'ch/new.typ'), f('M', 'ch/a.typ'), f('D', 'ch/old.typ')]));
    expect(marks.get('ch')).toEqual({ status: 'M', changed: 3 });
    expect(gitMarks(repo([], [f('?', 'ch/new.typ'), f('A', 'ch/b.typ')])).get('ch')?.status).toBe('A');
    expect(gitMarks(repo([], [f('M', 'ch/a.typ'), f('U', 'ch/b.typ')])).get('ch')?.status).toBe('U');
  });

  it('names untracked files as Source Control does', () => {
    expect(gitClass('?')).toBe('git-new');
    expect(gitClass('M')).toBe('git-M');
  });
});
