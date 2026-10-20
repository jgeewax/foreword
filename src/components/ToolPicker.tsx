// Choosing the program a tool runs (Settings ▸ Tools, and OpenCode's in
// Settings ▸ Assistant): the copies found on this Mac, a file, a pasted path
// or a typed one.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { studio } from '../app/studio';
import type { ToolName } from '../app/settings';
import { ipc, type ToolInfo, type ToolProbe } from '../lib/ipc';
import { pastedPath, tildePath } from '../lib/paths';
import { useStore } from '../lib/store';
import { Icon } from './icons';

/**
 * Which program a tool runs: what's in use and where it came from, and every
 * way to pick another: a copy found on this Mac, a file, a pasted path or a
 * typed one (checked as it's typed). Automatic goes back to the first copy
 * found. `notInstalled` says what to do when there's none (null: nothing,
 * when the page around it says so).
 */
export function ToolPicker({ tool, label, info, install, error, notInstalled }: { tool: ToolName; label: string; info: ToolInfo | undefined; install: string; error?: string; notInstalled?: ReactNode | null }) {
  const chosen = useStore(studio.store, (s) => s.settings.toolPaths[tool] ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // The path box's text while it's shown, and what's at that path.
  const [typing, setTyping] = useState<string | null>(null);
  const [probe, setProbe] = useState<ToolProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const copies = info?.copies ?? [];
  // The chosen path with ~ expanded, and the copy in use (for where it came from).
  const configured = info?.configured ?? null;
  const inUse = copies.find((c) => c.path === info?.path);
  const unusable = !!chosen && !!info && info.fromSettings === false;

  const apply = async (path: string) => {
    setOpen(false);
    setBusy(true);
    try {
      await studio.setToolPath(tool, path);
    } finally {
      setBusy(false);
    }
  };
  // A path from the file picker or the clipboard: used if it's the program, or else shown in the box with what's wrong.
  const offer = async (raw: string | null) => {
    const path = pastedPath(raw ?? '');
    if (!path) {
      studio.toast('There’s no path on the clipboard.');
      return;
    }
    const found = await ipc.toolProbe(tool, path).catch(() => null);
    if (found && !found.problem) {
      setTyping(null);
      await apply(path);
    } else {
      setTyping(path);
      setProbe(found);
    }
  };
  const choose = async () => {
    setOpen(false);
    const picked = await openDialog({ directory: false, multiple: false, defaultPath: info?.path ?? undefined, title: `Choose the ${label} program` });
    if (typeof picked === 'string') await offer(picked);
  };
  const paste = async () => {
    setOpen(false);
    await offer(await ipc.clipboardRead().catch(() => null));
  };
  const startTyping = () => {
    setOpen(false);
    setTyping(chosen && !copies.some((c) => c.path === configured) ? chosen : '');
  };
  const use = () => typing !== null && probe && !probe.problem && void apply(typing).then(() => setTyping(null));

  // What's at the typed path, checked as it's typed.
  useEffect(() => {
    if (typing === null || !typing.trim()) return setProbe(null);
    const timer = setTimeout(() => void ipc.toolProbe(tool, typing).then(setProbe, () => setProbe(null)), 200);
    return () => clearTimeout(timer);
  }, [typing, tool]);

  type Row = { key: string; run: () => void; selected?: boolean; content: ReactNode; className?: string };
  const rows: Row[] = [
    {
      key: 'automatic',
      run: () => void apply(''),
      selected: !chosen,
      content: (
        <>
          <span className="tool-option-title">Automatic</span>
          <span className="tool-option-detail">{copies[0] ? `The first one found: ${copies[0].version ?? 'version unknown'}, ${copies[0].source}` : 'Nothing found yet'}</span>
          {copies[0] && <span className="tool-option-path">{tildePath(copies[0].path)}</span>}
        </>
      ),
    },
    ...copies.map((c) => ({
      key: c.path,
      run: () => void apply(c.path),
      selected: !!chosen && configured === c.path,
      className: 'tool-copy',
      content: (
        <>
          <span className="tool-option-title">
            {c.version ?? 'version unknown'} <span className="muted">· {c.source}</span>
          </span>
          <span className="tool-option-path">{tildePath(c.path)}</span>
        </>
      ),
    })),
    { key: 'choose', run: () => void choose(), className: 'tool-action', content: <><Icon name="folder" size={14} /> Choose a file…</> },
    { key: 'paste', run: () => void paste(), className: 'tool-action', content: <><Icon name="paste" size={14} /> Paste a path</> },
    { key: 'type', run: startTyping, className: 'tool-action', content: <><Icon name="edit" size={14} /> Type a path…</> },
  ];
  const firstAction = rows.length - 3;

  useEffect(() => {
    if (!open) return;
    void studio.refreshTools().catch(() => {});
    setHighlight(Math.max(0, rows.findIndex((r) => r.selected)));
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-row="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);
  const onListKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      rows[highlight]?.run();
    } else if (e.key === 'Escape') {
      // Closes the list, not Settings.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="tool-picker-block" data-tool={tool} ref={rootRef}>
      <div className="tool-picker" onKeyDown={onListKey}>
        <button className="tool-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: which program`} disabled={busy} onClick={() => setOpen(!open)}>
          <span className="tool-choice">{chosen ? 'Your choice' : 'Automatic'}</span>
          {info?.path ? (
            <>
              <span className="tool-version">{info.version ?? 'version unknown'}</span>
              <span className="tool-source">{inUse?.source ?? 'a path you chose'}</span>
              <span className="tool-path">{tildePath(info.path)}</span>
            </>
          ) : (
            <span className="tool-version bad">{info ? 'Not found' : 'Looking…'}</span>
          )}
          <Icon name="chevronDown" size={14} />
        </button>
        {open && (
          <div className="tool-list" role="listbox" aria-label={`${label} programs`} ref={listRef}>
            {rows.map((r, i) => (
              <div key={r.key}>
                {i === 1 && copies.length > 0 && <div className="tool-list-section">Found on this Mac</div>}
                {i === firstAction && <div className="tool-list-divider" />}
                <div
                  role="option"
                  aria-selected={!!r.selected}
                  data-row={i}
                  className={`tool-option ${r.className ?? ''}${i === highlight ? ' highlighted' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={r.run}
                >
                  <span className="tool-option-check">{r.selected && <Icon name="check" size={13} />}</span>
                  <span className="tool-option-body">{r.content}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {typing !== null && (
        <div className="tool-typing">
          <div className="settings-row">
            <input
              className="settings-input"
              aria-label={`${label} program path`}
              placeholder={`/path/to/${tool}, or ~/…`}
              spellCheck={false}
              autoFocus
              value={typing}
              onChange={(e) => setTyping(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') use();
                else if (e.key === 'Escape') {
                  // Closes the box, not Settings.
                  e.stopPropagation();
                  setTyping(null);
                }
              }}
            />
            <button className="small primary" disabled={!probe || !!probe.problem || busy} onClick={use}>
              Use
            </button>
            <button className="small" onClick={() => setTyping(null)}>
              Cancel
            </button>
          </div>
          <div className={`tool-probe ${probe ? (probe.problem ? 'bad' : 'ok') : ''}`}>
            {!typing.trim() ? 'Type or paste the path of the program.' : !probe ? 'Checking…' : probe.problem ?? `${label} ${probe.version ?? ''} — ready to use`}
          </div>
        </div>
      )}
      {unusable && <div className="settings-help bad">There’s no program at {tildePath(configured ?? chosen)}, so Foreword uses {info?.path ? 'the first one it found' : 'none'}.</div>}
      {info && !info.path && notInstalled !== null && (
        <div className="settings-help">
          {notInstalled ?? (
            <>
              Not installed? In Terminal: <code className="selectable">{install}</code>{' '}
              <button className="link" onClick={() => void ipc.clipboardWrite(install).then(() => studio.toast('Copied.'))}>
                Copy
              </button>
              , then Search again.
            </>
          )}
        </div>
      )}
      {error && <div className="settings-help bad">{error}</div>}
    </div>
  );
}
