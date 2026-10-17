import { useState } from 'react';
import { studio } from '../app/studio';
import { onContextMenu } from '../lib/context-menu';
import type { GitFile } from '../lib/ipc';
import { useStore } from '../lib/store';

const STATUS: Record<GitFile['status'], { letter: string; title: string }> = {
  M: { letter: 'M', title: 'Changed' },
  A: { letter: 'A', title: 'Added' },
  '?': { letter: 'N', title: 'New: not in Git yet' },
  D: { letter: 'D', title: 'Deleted' },
  R: { letter: 'R', title: 'Renamed' },
  U: { letter: '!', title: 'Conflict: both sides changed it' },
};

const ago = (seconds: number) => {
  const m = Math.round((Date.now() / 1000 - seconds) / 60);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(seconds * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * Source Control: the book's own Git repository. What's changed since the last
 * commit, a message and Commit, Pull and Push, and the recent commits; each
 * shows what changed in words.
 */
export function SourceControlPanel() {
  const git = useStore(studio.store, (s) => s.git);
  const titles = useStore(studio.store, (s) => s.names.titles);
  const [message, setMessage] = useState('');
  const repo = git.repo;
  if (git.status === 'loading' || git.status === 'off') return <div className="history-empty muted">Looking for a Git repository…</div>;
  if (!repo) return <div className="history-empty muted">This book isn’t in a Git repository.</div>;
  const changes = repo.files;
  const commit = async () => {
    if (await studio.git.commit(message)) setMessage('');
  };
  return (
    <div className="git-panel">
      <div className="git-branch">
        <span title={repo.root}>
          {repo.branch ? (
            <>
              On <b>{repo.branch}</b>
            </>
          ) : (
            'No branch (a detached commit)'
          )}
          {repo.upstream ? <span className="muted"> · {repo.upstream}</span> : <span className="muted"> · not on a remote yet</span>}
        </span>
        <span className="spacer" />
        {repo.upstream && (
          <button className="small" disabled={!!git.busy} title="Bring in commits from the remote (only when no merge is needed)" onClick={() => void studio.git.pull()}>
            {git.busy === 'pull' ? 'Pulling…' : `Pull${repo.behind ? ` ↓${repo.behind}` : ''}`}
          </button>
        )}
        <button className="small" disabled={!!git.busy || (!!repo.upstream && repo.ahead === 0)} title="Send your commits to the remote" onClick={() => void studio.git.push()}>
          {git.busy === 'push' ? 'Pushing…' : `Push${repo.ahead ? ` ↑${repo.ahead}` : ''}`}
        </button>
      </div>
      <div className="git-commit">
        <textarea
          value={message}
          rows={2}
          placeholder={changes.length ? 'What changed? (the commit message)' : 'Nothing to commit'}
          aria-label="Commit message"
          disabled={!changes.length || !!git.busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey) {
              e.preventDefault();
              void commit();
            }
          }}
        />
        <button className="primary" disabled={!changes.length || !message.trim() || !!git.busy} title="Commit every change in the book (⌘⏎)" onClick={() => void commit()}>
          {git.busy === 'commit' ? 'Committing…' : `Commit ${changes.length} file${changes.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {changes.length > 0 && (
        <>
          <div className="task-section git-section">
            Changes · {changes.length}
            <span className="spacer" />
            <button className="link" onClick={() => void studio.git.showWorking()}>
              What changed
            </button>
          </div>
          {changes.map((f) => {
            const name = f.path.slice(f.path.lastIndexOf('/') + 1);
            const folder = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
            return (
              <button
                key={f.path}
                className={`git-file s-${f.status === '?' ? 'new' : f.status}`}
                title={`${STATUS[f.status].title}: ${f.path}`}
                onClick={() => void studio.git.showWorking(f.path)}
                onContextMenu={onContextMenu(() => [
                  { label: 'What Changed', action: () => void studio.git.showWorking(f.path) },
                  f.status !== 'D' && { label: 'Open', action: () => void studio.openFile(f.path) },
                ])}
              >
                <span className="git-status">{STATUS[f.status].letter}</span>
                <span className="git-name">{titles[f.path] ? `${titles[f.path]}` : name}</span>
                <span className="git-folder muted">{titles[f.path] ? f.path : folder}</span>
              </button>
            );
          })}
        </>
      )}
      {!changes.length && <div className="history-empty muted">Everything is committed.</div>}
      {git.log.length > 0 && <div className="task-section git-section">Recent commits</div>}
      {git.log.map((c) => (
        <button
          key={c.hash}
          className="git-commit-row"
          title={`${c.short} · ${c.author}`}
          onClick={() => void studio.git.showCommit(c)}
          onContextMenu={onContextMenu(() => [
            { label: 'What Changed', action: () => void studio.git.showCommit(c) },
            { label: 'Copy Commit ID', action: () => studio.copy(c.hash, 'Commit ID copied') },
          ])}
        >
          <span className="git-subject">{c.subject}</span>
          <span className="git-when muted">{ago(c.time)}</span>
        </button>
      ))}
    </div>
  );
}
