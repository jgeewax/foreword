import type { ReactNode } from 'react';
import { countsLabel } from '../app/proofing-core';
import { ASSISTANT_NAMES } from '../app/settings';
import { studio, type Stat } from '../app/studio';
import { numberedTitle } from '../app/tool-labels';
import { Icon, type IconName } from './icons';
import type { ToolInfo } from '../lib/ipc';
import { baseName, dirName, tildePath } from '../lib/paths';
import { useStore } from '../lib/store';
import { useTaskDot } from './TaskMenu';
import { TypstGuide } from './TypstGuide';

const ms = (v: number | null) => (v == null ? '–' : `${Math.round(v)}`);
const stat = (s: Stat) => (s.n ? `${ms(s.p50)}/${ms(s.p95)} ms` : '–');

type Pane = 'explorer' | 'preview' | 'agent';

/**
 * The title bar, as VS Code's on macOS: the window's own buttons at the left
 * (macOS draws them; studio.refreshViewportInset leaves them room), the book's
 * name in the middle as a search box for its files (⌘P), and the pane toggles
 * at the right. Everything else is in the menus, the activity bar or the pane
 * it's about. The bar moves the window, except on its buttons.
 */
export function TitleBar({ panes }: { panes?: { visible: Record<Pane, boolean>; onToggle: (pane: Pane) => void } }) {
  const ws = useStore(studio.store, (s) => s.workspace);
  // Tasks that need the author (a question, a permission, a reply not yet seen): a badge on the
  // assistant's toggle while its pane is hidden. Shown, the pane's task menu says so itself.
  const others = useStore(studio.store, (s) => Object.values(s.agent.background).filter((b) => b.attention || b.unread).length);
  const waiting = others + (useTaskDot() === 'ask' ? 1 : 0);
  return (
    <header className="titlebar" data-tauri-drag-region="deep">
      <div className="titlebar-left" />
      <div className="titlebar-center">
        {ws && (
          <button className="command-center" title={`Go to a file in ${tildePath(ws.root)} (⌘P), or run a command (⇧⌘P)`} onClick={() => studio.openQuickOpen()}>
            <Icon name="search" />
            <span className="command-center-name">{ws.name}</span>
          </button>
        )}
      </div>
      <div className="titlebar-right">
        {panes &&
          (
            [
              ['explorer', 'paneLeft', 'Sidebar', '⌘B'],
              ['preview', 'paneMiddle', 'Preview', '⌥⌘P'],
              ['agent', 'paneRight', 'Assistant', '⌥⌘B'],
            ] as const
          ).map(([pane, icon, label, keys]) => {
            const badge = pane === 'agent' && !panes.visible.agent && waiting > 0;
            return (
              <button
                key={pane}
                className="chrome-icon"
                title={`${panes.visible[pane] ? 'Hide' : 'Show'} the ${label.toLowerCase()} (${keys})${badge ? `: ${waiting === 1 ? 'a task needs' : `${waiting} tasks need`} you` : ''}`}
                aria-label={badge ? `${label}, ${waiting} waiting` : label}
                aria-pressed={panes.visible[pane]}
                onClick={() => panes.onToggle(pane)}
              >
                <Icon name={panes.visible[pane] ? `${icon}On` : icon} />
                {badge && <span className="titlebar-badge" aria-hidden />}
              </button>
            );
          })}
      </div>
    </header>
  );
}

type Tone = 'ok' | 'busy' | 'warn' | 'bad' | 'off';

/**
 * A status item, as VS Code's: an icon and a few words. Its tone colours the
 * icon (on a book's colour, only what's wrong shows); clickable when it offers
 * an action.
 */
function Indicator({ tone, icon, label, title, onClick }: { tone?: Tone; icon?: IconName; label: ReactNode; title?: string; onClick?: () => void }) {
  const className = tone ? `indicator ${tone}` : 'indicator';
  const body = (
    <>
      {icon && <Icon name={icon} size={14} />}
      <span className="indicator-label">{label}</span>
    </>
  );
  return onClick ? (
    <button className={className} title={title} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={className} title={title}>
      {body}
    </span>
  );
}

export function StatusBar() {
  const active = useStore(studio.store, (s) => s.active);
  const cursor = useStore(studio.store, (s) => s.cursor);
  const problems = useStore(studio.store, (s) => s.problems);
  const proofing = useStore(studio.store, (s) => countsLabel(s.active ? s.proofing.counts[s.active] : undefined));
  const compile = useStore(studio.store, (s) => s.compile);
  const preview = useStore(studio.store, (s) => s.preview);
  const agent = useStore(studio.store, (s) => s.agent.status);
  const agentError = useStore(studio.store, (s) => s.agent.error);
  const assistantName = useStore(studio.store, (s) => ASSISTANT_NAMES[s.settings.assistant]);
  const connection = useStore(studio.store, (s) => s.agent.connection);
  const running = useStore(studio.store, (s) => s.agent.running);
  const model = useStore(studio.store, (s) => s.agent.model);
  const perf = useStore(studio.store, (s) => s.perf);
  const zoom = useStore(studio.store, (s) => s.zoom);
  const canAsk = agent === 'ready' && !running;
  const todos = useStore(studio.store, (s) => s.todos.length);
  const previewTarget = useStore(studio.store, (s) => s.previewTarget);
  // A chapter typeset alone: its pages and words aren't the book's.
  const chapter = useStore(studio.store, (s) => (s.previewTarget === 'book' && s.previewChapter ? (numberedTitle(s.previewChapter, s.names) ?? 'One chapter') : null));

  const compileTone: Tone = compile.status === 'ok' ? 'ok' : compile.status === 'compiling' ? 'busy' : compile.status === 'error' ? 'bad' : 'off';
  const compileLabel =
    compile.status === 'ok' && previewTarget === 'cover'
      ? 'Cover'
      : compile.status === 'ok' && chapter
        ? `${chapter} alone`
      : compile.status === 'ok'
      ? `${compile.pages} ${compile.pages === 1 ? 'page' : 'pages'}${compile.words != null ? ` · ${compile.words.toLocaleString()} words` : ''}`
      : compile.status === 'compiling'
        ? 'Typesetting…'
        : compile.status === 'error'
          ? "Can't typeset"
          : '';
  const previewTone: Tone = preview.status === 'ready' ? 'ok' : preview.status === 'starting' ? 'warn' : preview.status === 'error' ? 'bad' : 'off';
  const agentTone: Tone =
    agent === 'error' ? 'bad' : agent === 'starting' || connection === 'lost' ? 'warn' : running ? 'busy' : agent === 'ready' ? 'ok' : 'off';
  const agentLabel =
    agent === 'error' ? 'Assistant unavailable' : agent === 'starting' ? 'Assistant starting…' : connection === 'lost' ? 'Reconnecting…' : running ? 'Assistant working…' : agent === 'ready' ? 'Assistant ready' : 'Assistant off';

  const slash = active ? active.lastIndexOf('/') + 1 : 0;

  // The book at the left, this window's session at the right, as VS Code's.
  return (
    <footer className="statusbar">
      <div className="statusbar-side">
        <span className="status-file" title={active ?? undefined}>
          {active ? (
            <>
              <span className="status-dir">{active.slice(0, slash)}</span>
              <span className="status-name">{active.slice(slash)}</span>
            </>
          ) : (
            'No file'
          )}
        </span>
        {problems.errors > 0 ? (
          <span className="problems">
            <Indicator tone="bad" icon="error" label={`${problems.errors} ${problems.errors === 1 ? 'error' : 'errors'}`} title="Go to the next error" onClick={() => void studio.nextProblem()} />
            {canAsk && <Indicator icon="sparkle" label="Ask the assistant to fix it" title="The assistant explains the error in plain words and fixes it" onClick={() => void studio.fixProblem()} />}
          </span>
        ) : (
          <Indicator tone="ok" icon="passed" label="No errors" title="No Typst errors" />
        )}
        {problems.warnings > 0 && (
          <Indicator
            tone="warn"
            icon="warning"
            label={`${problems.warnings} ${problems.warnings === 1 ? 'warning' : 'warnings'}`}
            title="Typst warnings (hover the yellow squiggles in the editor)"
          />
        )}
        {proofing && <Indicator icon="edit" label={proofing} title="Spelling and grammar in this file: go to the next mistake (⌘;)" onClick={() => studio.nextSpelling()} />}
        {compileLabel && (
          <Indicator
            tone={compileTone}
            icon="book"
            label={compileLabel}
            title={chapter ? 'Typesetting only this chapter, for a quicker preview (Settings ▸ General ▸ Preview)' : 'Typesetting status of the whole book'}
          />
        )}
        {todos > 0 && <Indicator icon="checklist" label={`${todos} to do`} title="TODOs left in the book" onClick={() => studio.showSidebar('todos')} />}
      </div>
      <div className="statusbar-side">
        {cursor && active && <Indicator label={`Ln ${cursor.line}, Col ${cursor.column}`} />}
        {Math.abs(zoom - 1) > 0.001 && (
          <Indicator icon="search" label={`${Math.round(zoom * 100)}%`} title="Zoom (⌘= / ⌘− / ⌘0). Click to reset." onClick={() => void studio.zoom('reset', 'key')} />
        )}
        <span className="perf">
          <Indicator icon="keyboard" label={stat(perf.input)} title="Keystroke → editor paint, p50/p95 (SPEC §6 target ≤16 ms p95)" />
          <Indicator icon="eye" label={stat(perf.preview)} title="Edit → preview paint, p50/p95 (SPEC §6 target ≤150/400 ms)" />
        </span>
        <Indicator
          tone={previewTone}
          icon="paneMiddle"
          label={preview.status === 'error' ? 'Preview stopped' : preview.status === 'starting' ? 'Preview starting…' : preview.status === 'ready' ? 'Preview' : 'Preview off'}
          title={preview.status === 'error' ? `${preview.error ?? 'The preview stopped.'} Click to restart it.` : 'Live preview (Tinymist)'}
          onClick={preview.status === 'error' ? () => void studio.restartTypst() : undefined}
        />
        <Indicator
          tone={agentTone}
          icon="sparkle"
          label={`${agentLabel}${model && agent === 'ready' ? ` · ${model.id}` : ''}`}
          title={agent === 'error' ? `${agentError ?? `${assistantName} is not running.`} Click to try again.` : model ? `${model.providerID}/${model.id}` : `Writing assistant (${assistantName})`}
          onClick={agent === 'error' ? () => void studio.startAgent() : undefined}
        />
      </div>
    </footer>
  );
}

export function Toast() {
  const toast = useStore(studio.store, (s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.tone}`} role="status" onClick={() => studio.store.set({ toast: null })}>
      <span>{toast.text}</span>
      {toast.actions?.length ? (
        <span className="toast-actions">
          {toast.actions.map((a) => (
            <button
              key={a.label}
              className="small"
              onClick={(e) => {
                e.stopPropagation();
                studio.store.set({ toast: null });
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </span>
      ) : null}
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
      <span className="bad">✕</span> {label} is off: {name} isn't installed. {purpose} Install it in Terminal with <code className="selectable">{install}</code>, then restart Foreword.
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
    <div className="app">
      <TitleBar />
      <div className="welcome">
        <div className="welcome-card">
          <h1>Foreword</h1>
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
                <button onClick={() => studio.openNewBook('sample')}>Open a Sample…</button>
                {launch?.sampleBook && <button onClick={() => void studio.openWorkspace(launch.sampleBook!)}>Open the test book</button>}
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
    </div>
  );
}
