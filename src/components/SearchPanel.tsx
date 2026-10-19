import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SearchOptions } from '../app/book-search';
import { studio } from '../app/studio';
import { numberedTitle } from '../app/tool-labels';
import { useStore } from '../lib/store';
import { FileIcon, Icon } from './icons';

/** One of the box's toggles, as VS Code's: Aa, ab, .* */
function Toggle({ on, label, title, onClick }: { on: boolean; label: ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" className={`search-toggle${on ? ' on' : ''}`} aria-pressed={on} aria-label={title} title={title} onClick={onClick}>
      {label}
    </button>
  );
}

/**
 * Search the whole book, as VS Code's Search view (⇧⌘F): words (any case,
 * or matching case, or whole words) or a pattern, results under each
 * chapter's name in reading order, and Replace All. A result opens its file
 * with the match selected.
 */
export function SearchPanel() {
  const search = useStore(studio.store, (s) => s.search);
  const names = useStore(studio.store, (s) => s.names);
  const inputRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(() => !!studio.state.search.replace);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const option = (key: keyof SearchOptions) => () => studio.setSearch({ options: { ...search.options, [key]: !search.options[key] } });

  useEffect(() => {
    inputRef.current?.focus();
    return studio.events.on('focus-search', (text) => {
      if (text) studio.setSearch({ query: text });
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const files = search.results?.length ?? 0;
  const fold = (path: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="search-panel">
      <div className="search-form">
        <button className={`icon search-expand${replacing ? ' open' : ''}`} aria-label={replacing ? 'Hide Replace' : 'Replace'} aria-expanded={replacing} title={replacing ? 'Hide Replace' : 'Replace'} onClick={() => setReplacing((r) => !r)}>
          <Icon name="chevronRight" size={14} />
        </button>
        <div className="search-fields">
          <label className="search-box">
            <input
              ref={inputRef}
              value={search.query}
              placeholder="Search the book"
              aria-label="Search the book"
              spellCheck={false}
              onChange={(e) => studio.setSearch({ query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void studio.runSearch();
                } else if (e.key === 'Escape' && search.query) {
                  e.preventDefault();
                  e.stopPropagation();
                  studio.setSearch({ query: '' });
                }
              }}
            />
            <Toggle on={search.options.matchCase} label="Aa" title="Match case" onClick={option('matchCase')} />
            <Toggle on={search.options.wholeWord} label={<u>ab</u>} title="Whole words only" onClick={option('wholeWord')} />
            <Toggle on={search.options.regex} label=".*" title="A pattern (regular expression): $1 in Replace puts back a group" onClick={option('regex')} />
          </label>
          {replacing && (
            <div className="search-replace">
              <label className="search-box">
                <input value={search.replace} placeholder="Replace with" aria-label="Replace with" spellCheck={false} onChange={(e) => studio.setSearch({ replace: e.target.value })} />
              </label>
              <button className="small" disabled={!search.total || search.searching} title="Replace every match in the book (it asks first, and History keeps the book as it was)" onClick={() => void studio.replaceAll()}>
                Replace All
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="search-summary muted" aria-live="polite">
        {search.error ? (
          <span className="bad">{search.error}</span>
        ) : search.results === null ? (
          search.query ? (
            'Searching…'
          ) : (
            'Every chapter and text file in the book, as it is in the editor.'
          )
        ) : search.total ? (
          `${search.capped ? 'The first ' : ''}${search.total} result${search.total === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`
        ) : (
          'No results.'
        )}
      </div>
      <div className="search-results">
        {search.results?.map((f) => {
          const title = numberedTitle(f.path, names);
          const slash = f.path.lastIndexOf('/');
          const open = !folded.has(f.path);
          return (
            <section key={f.path} className="search-file">
              <div className="search-file-head" role="button" tabIndex={0} aria-expanded={open} title={f.path} onClick={() => fold(f.path)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fold(f.path))}>
                <span className={`twisty${open ? ' open' : ''}`}>
                  <Icon name="chevronRight" size={16} />
                </span>
                <FileIcon path={f.path} />
                <span className="search-file-name">{title ?? f.path.slice(slash + 1)}</span>
                <span className="search-file-path">{title ? f.path.slice(slash + 1) : f.path.slice(0, Math.max(0, slash))}</span>
                <span className="search-count">{f.matches.length}</span>
              </div>
              {open &&
                f.matches.map((m) => (
                  <button key={`${m.line}:${m.column}`} className="search-match" title={`Line ${m.line}`} onClick={() => void studio.revealMatch(f.path, m)}>
                    <span className="search-match-text">
                      {m.before}
                      <mark>{m.match}</mark>
                      {m.after}
                    </span>
                    <span className="search-match-line">{m.line}</span>
                  </button>
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
