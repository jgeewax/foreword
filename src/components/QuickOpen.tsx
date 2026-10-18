import { useEffect, useMemo, useRef, useState } from 'react';
import { studio } from '../app/studio';
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

/** ⌘P: go to a file by (part of) its name, or a chapter by its heading. */
export function QuickOpen() {
  const files = useStore(studio.store, (s) => s.workspace?.files ?? []);
  const tabs = useStore(studio.store, (s) => s.tabs);
  const active = useStore(studio.store, (s) => s.active);
  const names = useStore(studio.store, (s) => s.names);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo((): Row[] => {
    // Files the book ignores (.typst-studio, the export folder) aren't in `files` already.
    const candidates = files.filter((f) => !f.startsWith('.typst-studio/'));
    if (!query.trim()) {
      // Open tabs first (the one you're in last), then the rest by name.
      const recent = fileTabs(tabs)
        .reverse()
        .filter((t) => t !== active);
      const rest = candidates.filter((f) => !recent.includes(f) && f !== active).sort();
      return [...recent, ...rest, ...(active ? [active] : [])].map((path) => ({ path, title: names.titles[path], score: 0, positions: [], inTitle: false }));
    }
    const out: Row[] = [];
    for (const path of candidates) {
      const byPath = fuzzyMatch(query, path);
      const title = names.titles[path];
      const byTitle = title ? fuzzyMatch(query, title) : null;
      const best = byTitle && (!byPath || byTitle.score > byPath.score) ? { m: byTitle, inTitle: true } : byPath ? { m: byPath, inTitle: false } : null;
      if (best) out.push({ path, title, score: best.m.score + (tabs.includes(path) ? 1 : 0), positions: best.m.positions, inTitle: best.inTitle });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }, [files, tabs, active, names, query]);

  useEffect(() => setHighlight(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const open = (row: Row | undefined) => {
    if (!row) return;
    studio.closeQuickOpen();
    void studio.openFile(row.path);
  };

  return (
    <div className="modal-backdrop quick-open-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.closeQuickOpen()}>
      <div className="quick-open" role="dialog" aria-label="Go to file">
        <input
          autoFocus
          value={query}
          placeholder="Go to a file or chapter…"
          aria-label="File or chapter"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(0, Math.min(rows.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1))));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              open(rows[highlight]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              studio.closeQuickOpen();
            }
          }}
        />
        <div className="quick-open-list" ref={listRef} role="listbox">
          {rows.map((r, i) => {
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
          {!rows.length && <div className="quick-open-empty muted">No file matches “{query}”.</div>}
        </div>
        <div className="quick-open-hint muted">↑↓ to choose · ⏎ to open · Esc to close</div>
      </div>
    </div>
  );
}
