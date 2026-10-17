import { studio, type Stat } from '../app/studio';
import { useStore } from '../lib/store';

const ms = (v: number | null) => (v == null ? '–' : `${Math.round(v)}`);
const stat = (s: Stat) => (s.n ? `${ms(s.p50)}/${ms(s.p95)} ms` : '–');

export function Toolbar({ onToggle }: { onToggle: (pane: 'explorer' | 'preview' | 'agent') => void }) {
  const ws = useStore(studio.store, (s) => s.workspace);
  return (
    <header className="toolbar">
      <button className="icon" title="Toggle explorer (⌘B)" onClick={() => onToggle('explorer')}>
        ☰
      </button>
      <strong className="brand">Typst Studio</strong>
      {ws && (
        <>
          <span className="sep-dot">·</span>
          <span title={ws.root}>{ws.name}</span>
          {ws.entry && <span className="muted">entry {ws.entry}</span>}
        </>
      )}
      <span className="spacer" />
      <button title="Open folder (⌘O)" onClick={() => void studio.chooseWorkspace()}>
        Open…
      </button>
      <button className="icon" title="Toggle preview" onClick={() => onToggle('preview')}>
        ◧
      </button>
      <button className="icon" title="Toggle agent" onClick={() => onToggle('agent')}>
        ✦
      </button>
      <button className="icon" title="Settings (⌘,)" aria-label="Settings" onClick={() => studio.openSettings()}>
        ⚙
      </button>
    </header>
  );
}

export function StatusBar() {
  const active = useStore(studio.store, (s) => s.active);
  const cursor = useStore(studio.store, (s) => s.cursor);
  const problems = useStore(studio.store, (s) => s.problems);
  const compile = useStore(studio.store, (s) => s.compile);
  const preview = useStore(studio.store, (s) => s.preview.status);
  const agent = useStore(studio.store, (s) => s.agent.status);
  const running = useStore(studio.store, (s) => s.agent.running);
  const model = useStore(studio.store, (s) => s.agent.model);
  const perf = useStore(studio.store, (s) => s.perf);
  const zoom = useStore(studio.store, (s) => s.zoom);
  return (
    <footer className="statusbar">
      <span>{active ?? 'No file'}</span>
      {cursor && active && (
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      <span className={problems.errors ? 'bad' : ''}>
        {problems.errors} errors, {problems.warnings} warnings
      </span>
      <span className={compile.status === 'error' ? 'bad' : ''}>
        {compile.status === 'compiling' ? 'compiling…' : compile.status === 'error' ? 'compile error' : compile.status === 'ok' ? `compiled · ${compile.pages} pp` : ''}
      </span>
      <span className="spacer" />
      {Math.abs(zoom - 1) > 0.001 && (
        <button className="link zoom-indicator" title="Zoom (⌘= / ⌘− / ⌘0). Click to reset." onClick={() => void studio.zoom('reset', 'key')}>
          Zoom {Math.round(zoom * 100)}%
        </button>
      )}
      <span title="Keystroke → editor paint, p50/p95 (SPEC §6 target ≤16 ms p95)">⌨ {stat(perf.input)}</span>
      <span title="Edit → preview paint, p50/p95 (SPEC §6 target ≤150/400 ms)">⇢ preview {stat(perf.preview)}</span>
      <span className={preview === 'error' ? 'bad' : ''}>preview {preview}</span>
      <span className={agent === 'error' ? 'bad' : ''}>
        agent {running ? 'working' : agent}
        {model ? ` · ${model.providerID}/${model.id}` : ''}
      </span>
    </footer>
  );
}

export function Toast() {
  const toast = useStore(studio.store, (s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.tone}`} role="status" onClick={() => studio.store.set({ toast: null })}>
      {toast.text}
    </div>
  );
}

export function Welcome() {
  const launch = useStore(studio.store, (s) => s.launch);
  const tools = useStore(studio.store, (s) => s.tools);
  const opening = useStore(studio.store, (s) => s.opening);
  const error = useStore(studio.store, (s) => s.openError);
  const last = (() => {
    try {
      return localStorage.getItem('studio.lastWorkspace');
    } catch {
      return null;
    }
  })();
  const tool = (name: string, t?: { path: string | null; version: string | null }) => (
    <li className={t?.path ? '' : 'bad'}>
      {name}: {t ? (t.path ? `${t.version ?? ''} (${t.path})` : 'not found') : 'checking…'}
    </li>
  );
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Typst Studio</h1>
        {opening ? (
          <p className="muted">Opening {opening}…</p>
        ) : (
          <>
            <div className="welcome-actions">
              <button className="primary" onClick={() => void studio.chooseWorkspace()}>
                Open Folder… <kbd>⌘O</kbd>
              </button>
              {launch?.sampleBook && <button onClick={() => void studio.openWorkspace(launch.sampleBook!)}>Open sample book</button>}
              {last && last !== launch?.sampleBook && <button onClick={() => void studio.openWorkspace(last)}>Reopen {last.split('/').pop()}</button>}
            </div>
            {error && <p className="bad">{error}</p>}
          </>
        )}
        <ul className="tools">
          {tool('tinymist', tools?.tinymist)}
          {tool('opencode', tools?.opencode)}
        </ul>
      </div>
    </div>
  );
}
