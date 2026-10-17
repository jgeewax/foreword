import { studio, type Stat } from '../app/studio';
import type { ToolInfo } from '../lib/ipc';
import { baseName, dirName, tildePath } from '../lib/paths';
import { useStore } from '../lib/store';
import { TypstGuide } from './TypstGuide';

const ms = (v: number | null) => (v == null ? '–' : `${Math.round(v)}`);
const stat = (s: Stat) => (s.n ? `${ms(s.p50)}/${ms(s.p95)} ms` : '–');

export function Toolbar({ onToggle }: { onToggle: (pane: 'explorer' | 'preview' | 'agent') => void }) {
  const ws = useStore(studio.store, (s) => s.workspace);
  const exporting = useStore(studio.store, (s) => s.exporting);
  const guideOpen = useStore(studio.store, (s) => s.guideOpen);
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
      {ws && (
        <button title="Export the book to PDF (⇧⌘E)" disabled={exporting} onClick={() => void studio.exportPdf()}>
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
      )}
      <button title="Open folder (⌘O)" onClick={() => void studio.chooseWorkspace()}>
        Open…
      </button>
      <button className="icon" title="Toggle preview" onClick={() => onToggle('preview')}>
        ◧
      </button>
      <button className="icon" title="Toggle agent" onClick={() => onToggle('agent')}>
        ✦
      </button>
      <button className={`icon${guideOpen ? ' on' : ''}`} title="Typst basics: how to write in Typst" aria-label="Typst basics" onClick={() => (guideOpen ? studio.closeGuide() : studio.openGuide())}>
        ?
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
  const canAsk = useStore(studio.store, (s) => s.agent.status === 'ready' && !s.agent.running);
  return (
    <footer className="statusbar">
      <span>{active ?? 'No file'}</span>
      {cursor && active && (
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      {problems.errors > 0 ? (
        <span className="problems">
          <button className="link bad" title="Go to the next error" onClick={() => void studio.nextProblem()}>
            {problems.errors} {problems.errors === 1 ? 'error' : 'errors'}
          </button>
          {canAsk && (
            <button className="link" title="The assistant explains the error in plain words and fixes it" onClick={() => void studio.fixProblem()}>
              Ask the assistant to fix it
            </button>
          )}
        </span>
      ) : (
        <span>0 errors</span>
      )}
      <span>{problems.warnings} warnings</span>
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

function ToolRow({ label, name, tool, install, purpose }: { label: string; name: string; tool?: ToolInfo; install: string; purpose: string }) {
  if (!tool) return <li className="muted">{label}: checking…</li>;
  if (tool.path) {
    return (
      <li title={tool.path}>
        <span className="ok">✓</span> {label} <span className="muted">· {name} {tool.version ?? ''}</span>
      </li>
    );
  }
  return (
    <li className="missing">
      <span className="bad">✕</span> {label} is off: {name} isn't installed. {purpose} Install it in Terminal with <code className="selectable">{install}</code>, then restart Typst Studio.
    </li>
  );
}

export function Welcome() {
  const launch = useStore(studio.store, (s) => s.launch);
  const tools = useStore(studio.store, (s) => s.tools);
  const opening = useStore(studio.store, (s) => s.opening);
  const error = useStore(studio.store, (s) => s.openError);
  const recent = useStore(studio.store, (s) => s.recent);
  const guideOpen = useStore(studio.store, (s) => s.guideOpen);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Typst Studio</h1>
        <p className="welcome-lede">Write books in plain text, with the typeset pages updating beside you as you type, and a writing assistant on hand.</p>
        {opening ? (
          <p className="muted">Opening {opening}…</p>
        ) : (
          <>
            <div className="welcome-actions">
              <button className="primary" onClick={() => studio.openNewBook()}>
                New Book… <kbd>⇧⌘N</kbd>
              </button>
              <button onClick={() => void studio.chooseWorkspace()}>
                Open Folder… <kbd>⌘O</kbd>
              </button>
              {launch?.sampleBook && <button onClick={() => void studio.openWorkspace(launch.sampleBook!)}>Open sample book</button>}
            </div>
            {error && <p className="bad">{error}</p>}
            {recent.length > 0 && (
              <div className="welcome-recent">
                <h2>Recent</h2>
                {recent.map((r) => (
                  <button key={r} className="recent-row" title={r} onClick={() => void studio.openWorkspace(r)}>
                    <span className="recent-name">{baseName(r)}</span>
                    <span className="recent-path">{tildePath(dirName(r))}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <div className="welcome-learn">
          <strong>New to Typst?</strong> It's plain text with a little markup, and the basics take about five minutes.{' '}
          <button className="link" onClick={() => studio.openGuide()}>
            Read Typst basics
          </button>
        </div>
        <ul className="setup">
          <ToolRow label="Live preview" name="Tinymist" tool={tools?.tinymist} install="brew install tinymist" purpose="It typesets the pages you see as you write." />
          <ToolRow label="Writing assistant" name="OpenCode" tool={tools?.opencode} install="brew install opencode" purpose="It runs the assistant in the right-hand pane." />
        </ul>
      </div>
      {guideOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.closeGuide()}>
          <div className="modal guide-modal" role="dialog" aria-label="Typst basics">
            <TypstGuide onClose={() => studio.closeGuide()} />
          </div>
        </div>
      )}
    </div>
  );
}
