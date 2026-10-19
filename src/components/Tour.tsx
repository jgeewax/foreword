import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { studio } from '../app/studio';
import { placeCard, TOUR_STEPS, type Rect } from '../app/tour';
import { useStore } from '../lib/store';

/** The lit-up part's box, a little larger than it; null when it isn't showing (a hidden pane). */
function targetRect(selector: string | null): Rect | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  const r = el?.getBoundingClientRect();
  if (!r || r.width < 24 || r.height < 12) return null;
  const pad = 4;
  return { left: Math.max(0, r.left - pad), top: Math.max(0, r.top - pad), width: Math.min(innerWidth, r.width + 2 * pad), height: Math.min(innerHeight, r.height + 2 * pad) };
}

/**
 * The tour: the window dimmed but for the part a step is about, and a card
 * beside it saying what it's for. → or ⏎ for the next step, ← for the one
 * before, Esc to leave. A step about a hidden pane is passed over.
 */
export function Tour() {
  const step = useStore(studio.store, (s) => s.tour);
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const direction = useRef<1 | -1>(1);
  const s = step === null ? null : TOUR_STEPS[step];

  const go = (d: 1 | -1) => {
    direction.current = d;
    studio.tourStep(d);
  };

  // Where the lit part and the card are, again whenever the layout or the window changes.
  useLayoutEffect(() => {
    if (!s) return;
    const measure = () => {
      const r = targetRect(s.target);
      if (s.target && !r) return studio.tourStep(direction.current); // a hidden pane: on to the next
      setRect(r);
      const size = cardRef.current?.getBoundingClientRect();
      setCard(placeCard(r, { width: size?.width ?? 320, height: size?.height ?? 170 }, { width: innerWidth, height: innerHeight }));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('studio-layout', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('studio-layout', measure);
    };
  }, [s]);

  useEffect(() => {
    if (step === null) return;
    nextRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') studio.endTour();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]);

  if (!s || step === null) return null;
  const last = step === TOUR_STEPS.length - 1;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* The dimming, with a hole where the lit part is (or none at all, for a card in the middle). */}
      {rect ? <div className="tour-spot" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} /> : <div className="tour-dim" />}
      <div className="tour-card" ref={cardRef} style={card ? { left: card.left, top: card.top } : { visibility: 'hidden' }}>
        <div className="tour-step">
          {step + 1} of {TOUR_STEPS.length}
        </div>
        <h2 id="tour-title">{s.title}</h2>
        <p>{s.text}</p>
        <div className="tour-actions">
          {!last && (
            <button className="link tour-skip" onClick={() => studio.endTour()}>
              Skip the tour
            </button>
          )}
          <span className="spacer" />
          {step > 0 && <button onClick={() => go(-1)}>Back</button>}
          <button ref={nextRef} className="primary" onClick={() => (last ? studio.endTour() : go(1))}>
            {last ? 'Start writing' : step === 0 ? 'Show me' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
