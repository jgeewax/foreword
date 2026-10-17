import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { formatContext, modelKey, modelSections, moveHighlight, selectableRows } from '../services/agent/model-search';
import type { ModelInfo } from '../services/agent/types';

/** Searchable model picker (replaces a plain <select>, which is unusable with dozens of models). */
export function ModelPicker({ placement = 'down' }: { placement?: 'up' | 'down' }) {
  const models = useStore(studio.store, (s) => s.agent.models);
  const model = useStore(studio.store, (s) => s.agent.model);
  const recent = useStore(studio.store, (s) => s.agent.recentModels);
  const running = useStore(studio.store, (s) => s.agent.running);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = model ? models.find((m) => modelKey(m) === modelKey(model)) : undefined;
  const sections = useMemo(() => modelSections(models, query, recent), [models, query, recent]);
  const rows = useMemo(() => selectableRows(sections), [sections]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (m: ModelInfo) => {
    close();
    void studio.selectModel(m);
  };

  // On open: refresh the list (it fills in lazily), focus search, highlight the current model.
  useEffect(() => {
    if (!open) return;
    void studio.loadModels();
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const at = model ? rows.findIndex((r) => modelKey(r.model) === modelKey(model) && sections[r.section].title !== 'Recent') : -1;
    setHighlight(query ? (rows.length ? 0 : -1) : at);
    // Only when the list contents change, not on every highlight move.
  }, [open, query, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-row="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => moveHighlight(rows.length, h, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[highlight];
      if (row) choose(row.model);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className={`model-picker ${placement}`} ref={rootRef}>
      <button
        className="model-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Model"
        disabled={running || !models.length}
        title={running ? 'The model can be changed when the agent is idle' : current ? `${current.providerName} · ${current.id}` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="model-trigger-name">{current?.name ?? (models.length ? 'Choose a model' : 'Loading models…')}</span>
        {current && <span className="model-trigger-provider">{current.providerName}</span>}
        <span className="model-trigger-chevron">▾</span>
      </button>
      {open && (
        <div className="model-popover" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            className="model-search"
            value={query}
            placeholder="Search models"
            aria-label="Search models"
            aria-controls="model-list"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="model-list" id="model-list" role="listbox" ref={listRef}>
            {sections.map((section, si) => (
              <div key={`${section.title}-${si}`} role="group" aria-label={section.title}>
                <div className="model-section">{section.title}</div>
                {section.models.map((m) => {
                  const row = rows.findIndex((r) => r.section === si && r.model === m);
                  const isCurrent = !!model && modelKey(m) === modelKey(model);
                  return (
                    <div
                      key={modelKey(m)}
                      role="option"
                      aria-selected={isCurrent}
                      aria-disabled={!m.supportsTools}
                      data-row={row}
                      className={`model-option${row === highlight ? ' highlighted' : ''}${m.supportsTools ? '' : ' disabled'}`}
                      title={m.supportsTools ? m.id : `${m.id}: no tool support, so it can't read or edit files`}
                      onMouseMove={() => row >= 0 && row !== highlight && setHighlight(row)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => m.supportsTools && choose(m)}
                    >
                      <span className="model-check">{isCurrent ? '✓' : ''}</span>
                      <span className="model-option-name">{m.name}</span>
                      <span className="model-option-meta">{m.supportsTools ? formatContext(m.contextWindow) : 'no tools'}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {rows.length === 0 && <div className="model-empty">{query ? `No models match “${query}”` : 'No models available'}</div>}
          </div>
          <div className="model-footer">
            <span>{models.length} models</span>
            <span className="muted">↑↓ choose · ⏎ select · esc close</span>
          </div>
        </div>
      )}
    </div>
  );
}
