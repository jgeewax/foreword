import { useEffect, useMemo, useRef, useState } from 'react';
import { available, paletteCommands, rankCommands, recentCommands, runCommand, type CommandRow } from '../app/commands';
import { studio } from '../app/studio';
import { chapterNumber, type BookNames } from '../app/tool-labels';
import { fileTabs } from '../app/view-tabs';
import { fuzzyMatch } from '../lib/fuzzy';
import { useStore } from '../lib/store';

type Row = { path: string; title?: string; score: number; positions: number[]; inTitle: boolean };

/** The matched characters in bold. */
function Marked({ text, at }: { text: string; at: number[] }) {
  const set = new Set(at);
  return (
    <>
      {[...text].map((ch, i) => (set.has(i) ? <b key={i}>{ch}</b> : ch))}
    </>
  );
}

/** A file's title in the list: its heading, after its number if it's a chapter ("17. The Harbour"). */
function titleOf(path: string, names: BookNames): string | undefined {
  const title = names.titles[path];
  const n = title ? chapterNumber(path, names) : null;
  return n ? `${n}. ${title}` : title;
}

/** Without a book (the welcome screen): one array, so the store's selector returns the same value each time. */
const NO_FILES: string[] = [];

/** What starts a query for a command, as in VS Code. */
const COMMAND_PREFIX = '>';
const startingQuery = (mode: 'files' | 'commands' | false) => (mode === 'commands' ? COMMAND_PREFIX : '');

/**
 * ⌘P: go to a file by (part of) its name, or a chapter by its heading.
 * ⇧⌘P, or ">" typed first: run a command (see app/commands.ts).
 */
export function QuickOpen() {
  const files = useStore(studio.store, (s) => s.workspace?.files ?? NO_FILES);
  const book = useStore(studio.store, (s) => !!s.workspace);
  const tabs = useStore(studio.store, (s) => s.tabs);
  const active = useStore(studio.store, (s) => s.active);
  const names = useStore(studio.store, (s) => s.names);
  const [query, setQuery] = useState(() => startingQuery(studio.state.quickOpen));
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const commandMode = query.startsWith(COMMAND_PREFIX);

  // ⌘P or ⇧⌘P again while open: start over in that mode.
  useEffect(() => studio.events.on('quick-open', (mode) => setQuery(startingQuery(mode))), []);

  // Closing hands the keyboard back to what had it (the editor, say), unless what ran took it.
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A moment later: StrictMode's trial unmount mounts again at once, and isn't a close.
      queueMicrotask(() => {
        const now = document.activeElement;
        if (mounted.current || (now && now !== document.body)) return;
        if (before && before !== document.body && before.isConnected) before.focus({ preventScroll: true });
      });
    };
  }, [before]);

  const rows = useMemo((): Row[] => {
    if (commandMode) return [];
    // Files the book ignores (.typst-studio, the export folder) aren't in `files` already.
    const candidates = files.filter((f) => !f.startsWith('.typst-studio/'));
    if (!query.trim()) {
      // Open tabs first (the one you're in last), then the rest by name.
      const recent = fileTabs(tabs)
        .reverse()
        .filter((t) => t !== active);
      const rest = candidates.filter((f) => !recent.includes(f) && f !== active).sort();
      return [...recent, ...rest, ...(active ? [active] : [])].map((path) => ({ path, title: titleOf(path, names), score: 0, positions: [], inTitle: false }));
    }
    const out: Row[] = [];
    for (const path of candidates) {
      const byPath = fuzzyMatch(query, path);
      const title = titleOf(path, names);
      const byTitle = title ? fuzzyMatch(query, title) : null;
      const best = byTitle && (!byPath || byTitle.score > byPath.score) ? { m: byTitle, inTitle: true } : byPath ? { m: byPath, inTitle: false } : null;
      if (best) out.push({ path, title, score: best.m.score + (tabs.includes(path) ? 1 : 0), positions: best.m.positions, inTitle: best.inTitle });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }, [commandMode, files, tabs, active, names, query]);

  // What applies is decided as the commands come up (a selection, a file in front…).
  const commands = useMemo(() => (commandMode ? available(paletteCommands(studio)) : []), [commandMode]);
  const recent = useMemo(() => (commandMode ? recentCommands() : []), [commandMode]);
  const commandRows = useMemo((): CommandRow[] => (commandMode ? rankCommands(commands, query.slice(COMMAND_PREFIX.length), recent) : []), [commandMode, commands, query, recent]);
  const count = commandMode ? commandRows.length : rows.length;

  useEffect(() => setHighlight(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const open = (row: Row | undefined) => {
    if (!row) return;
    studio.closeQuickOpen();
    void studio.openFile(row.path);
  };
  const choose = () => {
    if (!commandMode) return open(rows[highlight]);
    const row = commandRows[highlight];
    if (row) runCommand(studio, row.command);
  };

  return (
    <div className="modal-backdrop quick-open-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.closeQuickOpen()}>
      <div className={`quick-open${commandMode ? ' commands' : ''}`} role="dialog" aria-label={commandMode ? 'Command palette' : 'Go to file'}>
        <input
          autoFocus
          value={query}
          placeholder="Go to a file or chapter (type > for a command)…"
          aria-label={commandMode ? 'Command' : 'File or chapter'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(0, Math.min(count - 1, h + (e.key === 'ArrowDown' ? 1 : -1))));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              studio.closeQuickOpen();
            }
          }}
        />
        <div className="quick-open-list" ref={listRef} role="listbox">
          {commandMode
            ? commandRows.map((r, i) => (
                <button
                  key={r.command.id}
                  role="option"
                  aria-selected={i === highlight}
                  className={`quick-open-row command${i === highlight ? ' active' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => runCommand(studio, r.command)}
                >
                  <span className="quick-open-main">
                    <Marked text={r.label} at={r.positions} />
                  </span>
                  {r.command.detail && <span className="quick-open-path">{r.command.detail}</span>}
                  {r.recent && !commandRows[i - 1]?.recent && <span className="quick-open-note">recently used</span>}
                  {r.command.keys && (
                    <span className="quick-open-keys" aria-label={`Shortcut ${r.command.keys}`}>
                      {r.command.keys.split(' ').map((k, j) => (
                        <kbd key={j}>{k}</kbd>
                      ))}
                    </span>
                  )}
                </button>
              ))
            : rows.map((r, i) => {
                const name = r.path.slice(r.path.lastIndexOf('/') + 1);
                const folder = r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '';
                const nameStart = r.path.length - name.length;
                return (
                  <button
                    key={r.path}
                    role="option"
                    aria-selected={i === highlight}
                    className={`quick-open-row${i === highlight ? ' active' : ''}${r.path === active ? ' current' : ''}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => open(r)}
                  >
                    <span className="quick-open-main">
                      {r.title ? (
                        <Marked text={r.title} at={r.inTitle ? r.positions : []} />
                      ) : (
                        <Marked text={name} at={r.inTitle ? [] : r.positions.filter((p) => p >= nameStart).map((p) => p - nameStart)} />
                      )}
                    </span>
                    <span className="quick-open-path">
                      {r.title ? <Marked text={r.path} at={r.inTitle ? [] : r.positions} /> : <Marked text={folder} at={r.inTitle ? [] : r.positions.filter((p) => p < folder.length)} />}
                    </span>
                  </button>
                );
              })}
          {!count && (
            <div className="quick-open-empty muted">
              {commandMode ? `No command matches “${query.slice(COMMAND_PREFIX.length).trim()}”.` : book ? `No file matches “${query}”.` : 'Open a book to go to its files. Type > for a command.'}
            </div>
          )}
        </div>
        <div className="quick-open-hint muted">{commandMode ? '↑↓ to choose · ⏎ to run · Esc to close' : '↑↓ to choose · ⏎ to open · > for commands · Esc to close'}</div>
      </div>
    </div>
  );
}
