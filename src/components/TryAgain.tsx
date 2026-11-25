// Try again, at the foot of the last turn: the same message once more (its
// words, files and passages, in its mode), or with another model or effort,
// which the chat keeps from then on, as when they're chosen in the message
// box's menus. After a failure it says so in words. Its menu is in the page's
// top layer, as the selection card's is: the chat would cut it off.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { DEFAULT_EFFORT, type ModelRef } from '../services/agent/types';
import { Meter } from './EffortPicker';
import { Icon } from './icons';
import { ModelList } from './ModelPicker';

/** `failed`: the turn didn't finish, so the button says what it does. */
export function TryAgain({ userId, failed }: { userId: string; failed: boolean }) {
  const off = useStore(studio.store, (s) => s.agent.running || s.agent.status !== 'ready');
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (off) setOpen(false);
  }, [off]);
  return (
    <span className={`try-again${failed ? ' failed' : ''}`}>
      <button className={`try-again-go${failed ? '' : ' icon'}`} aria-label="Try again" title="Send the same message again" disabled={off} onClick={() => void studio.tryAgain(userId)}>
        <Icon name="retry" size={13} />
        {failed && <span>Try again</span>}
      </button>
      <button
        ref={more}
        className="try-again-more icon"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Try again with another model or effort"
        title="Try again with another model or effort"
        disabled={off}
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevronDown" size={11} />
      </button>
      {open && more.current && <TryAgainMenu userId={userId} anchor={more.current} close={() => setOpen(false)} />}
    </span>
  );
}

const WIDTH = 320;
const MARGIN = 8;

function TryAgainMenu({ userId, anchor, close }: { userId: string; anchor: HTMLElement; close: () => void }) {
  const models = useStore(studio.store, (s) => s.agent.models);
  const model = useStore(studio.store, (s) => s.agent.model);
  const recent = useStore(studio.store, (s) => s.agent.recentModels);
  const efforts = useStore(studio.store, (s) => s.agent.efforts);
  const effort = useStore(studio.store, (s) => s.agent.effort);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Below the chevron if it fits, else above (the last turn is often at the foot of the chat); its right edge at the chevron's.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const height = box.current?.offsetHeight ?? 0;
    const below = r.bottom + 4 + height <= window.innerHeight - MARGIN || r.top - 4 - height < MARGIN;
    const top = below ? r.bottom + 4 : r.top - 4 - height;
    const left = Math.min(Math.max(MARGIN, r.right - WIDTH), window.innerWidth - WIDTH - MARGIN);
    if (place?.top !== top || place?.left !== left) setPlace({ top, left });
  });

  useEffect(() => {
    // The list fills in lazily, as the message box's model menu's does.
    void studio.loadModels();
    const outside = (e: Event) => !box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node);
    const onDown = (e: MouseEvent) => outside(e) && close();
    // The chat scrolling moves the turn away from it.
    const onWheel = (e: WheelEvent) => outside(e) && close();
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('wheel', onWheel, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('resize', close);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (on: { model?: ModelRef; effort?: string }) => {
    close();
    void studio.tryAgain(userId, on);
  };
  const levels = efforts.filter((o) => o.value !== DEFAULT_EFFORT);
  return createPortal(
    <div
      ref={box}
      className="setup-popover try-again-menu"
      role="dialog"
      aria-label="Try again with"
      style={{ width: WIDTH, top: place?.top ?? -9999, left: place?.left ?? 0 }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        close();
        anchor.focus();
      }}
    >
      <div className="setup-head">
        <span className="setup-title">Try again with</span>
        <span className="setup-about">The same message once more. What you pick stays for the messages after it, as in the menus under the message box.</span>
      </div>
      {levels.length > 0 && (
        <>
          <div className="setup-label">Effort</div>
          <div className="setup-efforts" role="group" aria-label="Effort">
            {efforts.map((o) => (
              <button key={o.value} className={`setup-effort${o.value === effort ? ' current' : ''}`} aria-current={o.value === effort || undefined} title={o.value === effort ? `${o.name}: as now` : o.description} onClick={() => go({ effort: o.value })}>
                <Meter rank={levels.indexOf(o)} of={levels.length} />
                {o.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="setup-label">Model</div>
      {models.length ? (
        <ModelList compact models={models} current={model} recent={recent} onChoose={(m) => go({ model: { providerID: m.providerID, id: m.id } })} onClose={close} />
      ) : (
        <div className="setup-none">Loading models…</div>
      )}
    </div>,
    document.body,
  );
}
