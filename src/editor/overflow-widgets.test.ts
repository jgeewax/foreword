import { describe, expect, it } from 'vitest';
import { shiftInside } from './overflow-widgets';

describe('shiftInside', () => {
  it('moves a widget past the right edge back inside, never past the left', () => {
    expect(shiftInside({ left: 564, right: 956 }, 312, 784)).toBe(172);
    expect(shiftInside({ left: 400, right: 700 }, 312, 784)).toBe(0);
    // Wider than the editor: it starts at the left edge.
    expect(shiftInside({ left: 400, right: 1000 }, 312, 784)).toBe(88);
    expect(shiftInside({ left: 300, right: 900 }, 312, 784)).toBe(0);
  });
});
