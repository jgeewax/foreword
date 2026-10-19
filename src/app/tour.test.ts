import { describe, expect, it } from 'vitest';
import { placeCard, shouldStartTour, TOUR_STEPS } from './tour';

describe('the tour', () => {
  const view = { width: 1600, height: 1000 };
  const card = { width: 300, height: 160 };

  it('starts by itself only for someone new', () => {
    expect(shouldStartTour(false, 1)).toBe(true);
    expect(shouldStartTour(false, 0)).toBe(true);
    expect(shouldStartTour(false, 5)).toBe(false);
    expect(shouldStartTour(true, 1)).toBe(false);
  });

  it('puts its card beside what it lights up, inside the window', () => {
    // The sidebar, at the left: to its right, level with its middle.
    expect(placeCard({ left: 44, top: 32, width: 260, height: 940 }, card, view)).toEqual({ left: 318, top: 422 });
    // The assistant, at the right edge: to its left.
    expect(placeCard({ left: 1200, top: 32, width: 400, height: 940 }, card, view)).toEqual({ left: 886, top: 422 });
    // The status bar, the whole width at the bottom: above it.
    expect(placeCard({ left: 0, top: 976, width: 1600, height: 24 }, card, view)).toEqual({ left: 650, top: 802 });
    // The search box, in the middle at the top: to its right, kept in the window.
    expect(placeCard({ left: 500, top: 5, width: 600, height: 22 }, card, view)).toEqual({ left: 1114, top: 12 });
    // Nothing lit: in the middle.
    expect(placeCard(null, card, view)).toEqual({ left: 650, top: 420 });
  });

  it('has a card for each part, and shows the preview on its own step only', () => {
    expect(TOUR_STEPS[0].target).toBeNull();
    expect(TOUR_STEPS.filter((s) => s.preview).map((s) => s.target)).toEqual(['.preview-pane']);
  });
});
