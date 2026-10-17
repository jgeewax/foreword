import { studio } from '../app/studio';
import { cellStatus, duplicateNames, type CellStatus } from '../code/cells';
import { useStore } from '../lib/store';

const STATUS: Record<CellStatus | 'running', { icon: string; label: string }> = {
  running: { icon: '⟳', label: 'running…' },
  'not-run': { icon: '○', label: 'not run' },
  ok: { icon: '✓', label: 'ok' },
  outdated: { icon: '⚠', label: 'out of date' },
  failed: { icon: '✗', label: 'failed' },
  mismatch: { icon: '✗', label: 'wrong output' },
};

/** The book's runnable code examples, with their status; run one or all. */
export function CodePanel() {
  const code = useStore(studio.store, (s) => s.code);
  const busy = code.running.length > 0;
  const dupes = new Set(duplicateNames(code.cells));
  const stale = code.cells.filter((c) => ['not-run', 'outdated'].includes(cellStatus(c, code.outputs[c.name]))).length;
  const files = [...new Set(code.cells.map((c) => c.path))];

  if (!code.cells.length) {
    return (
      <div className="code-panel empty">
        <p>
          <strong>Runnable code examples</strong> show their real output in the book, and can check it.
        </p>
        <pre className="code-sample">{'#import "/code.typ": run\n\n#run("hello", ```python\nprint("Hello")\n```, expect: "Hello")'}</pre>
        {!code.setUp && (
          <button className="primary" onClick={() => void studio.code.setUp()}>
            Set up runnable code
          </button>
        )}
        <p className="muted">Python, JavaScript (Node), Bash, Ruby, R, Julia, Perl and Lua, using what's installed on this Mac.</p>
      </div>
    );
  }
  return (
    <div className="code-panel">
      {!code.trusted && (
        <div className="code-trust">
          Running code is off for this book.{' '}
          <button className="link" onClick={() => void studio.code.ensureTrusted()}>
            Allow…
          </button>
        </div>
      )}
      <div className="code-actions">
        <button className="primary" disabled={busy || !stale} onClick={() => void studio.code.runAll({ onlyStale: true })}>
          {stale ? `Run ${stale} not up to date` : 'All up to date'}
        </button>
        <button disabled={busy} onClick={() => void studio.code.runAll()}>
          Run all
        </button>
      </div>
      {files.map((path) => (
        <div key={path} className="code-file">
          <div className="code-file-name">{path}</div>
          {code.cells
            .filter((c) => c.path === path)
            .map((c) => {
              const running = code.running.includes(c.name);
              const status = running ? 'running' : cellStatus(c, code.outputs[c.name]);
              const out = code.outputs[c.name];
              return (
                <div
                  key={`${c.name}:${c.line}`}
                  className={`code-cell status-${status}`}
                  role="button"
                  tabIndex={0}
                  title={out?.stdout ? `Output:\n${out.stdout.slice(0, 400)}` : undefined}
                  onClick={() => void studio.openAt(c.path, c.line)}
                >
                  <span className="code-status" aria-label={STATUS[status].label}>
                    {STATUS[status].icon}
                  </span>
                  <span className="code-name">{c.name}</span>
                  <span className="code-lang">{c.lang || '?'}</span>
                  <span className="code-state">{dupes.has(c.name) ? 'name used twice' : STATUS[status].label}</span>
                  <button
                    className="icon"
                    title="Run this example"
                    aria-label={`Run ${c.name}`}
                    disabled={running}
                    onClick={(e) => {
                      e.stopPropagation();
                      void studio.code.run([c.name]);
                    }}
                  >
                    ▶
                  </button>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
