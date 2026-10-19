import { useEffect, useRef, useState } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { DEFAULT_EFFORT } from '../services/agent/types';
import { Icon } from './icons';

/** A bar for each of the model's levels (up to six), as many filled as this one is high ("Default" has none filled). */
function Meter({ rank, of }: { rank: number; of: number }) {
  const bars = Math.min(Math.max(of, 1), 6);
  const filled = rank < 0 ? 0 : Math.max(1, Math.round(((rank + 1) / of) * bars));
  return (
    <span className="effort-meter" aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className={i < filled ? 'on' : ''} style={{ height: `${3 + Math.round((i * 9) / Math.max(bars - 1, 1))}px` }} />
      ))}
    </span>
  );
}

/**
 * How hard the model thinks before it answers (Claude Code's effort, Codex's
 * reasoning effort, an OpenCode model's variants), beside the model. Only for
 * models that have levels; it opens upward, and /effort sets it too.
 */
export function EffortPicker() {
  const efforts = useStore(studio.store, (s) => s.agent.efforts);
  const effort = useStore(studio.store, (s) => s.agent.effort);
  const running = useStore(studio.store, (s) => s.agent.running);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    (root?.querySelector<HTMLElement>('.mode-option[aria-checked="true"]') ?? root?.querySelector<HTMLElement>('.mode-option'))?.focus();
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!efforts.length) return null;
  const current = efforts.find((o) => o.value === effort);
  const levels = efforts.filter((o) => o.value !== DEFAULT_EFFORT);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>('.effort-trigger')?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('.mode-option') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  return (
    <div className="effort-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        className="effort-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Effort: ${current?.name ?? 'not known'}`}
        disabled={running}
        title={running ? 'The effort can be changed when the assistant is idle' : `Effort: how hard the model thinks before it answers${current ? ` (${current.name})` : ''}. More is slower, and better at hard passages.`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="gauge" size={13} />
        {current?.name ?? 'Effort'}
      </button>
      {open && (
        <div className="mode-popover effort-popover" role="menu" aria-label="Effort">
          <div className="effort-head">How hard the model thinks before it answers</div>
          {efforts.map((o) => (
            <button
              key={o.value}
              role="menuitemradio"
              aria-checked={o.value === effort}
              className={`mode-option${o.value === effort ? ' current' : ''}`}
              onClick={() => {
                setOpen(false);
                void studio.selectEffort(o.value);
              }}
            >
              <Meter rank={levels.indexOf(o)} of={levels.length} />
              <span className="mode-text">
                <span className="mode-name">{o.name}</span>
                {o.description && <span className="mode-description">{o.description}</span>}
              </span>
              <span className="model-check">{o.value === effort ? '✓' : ''}</span>
            </button>
          ))}
          <div className="model-footer">
            <span className="muted">More is slower · kept for this model · /effort sets it too</span>
          </div>
        </div>
      )}
    </div>
  );
}
