import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from './store';

describe('Store', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('notifies once per frame for a burst of updates', () => {
    const frames: (() => void)[] = [];
    vi.useFakeTimers(); // first: fake timers bring their own requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => frames.push(f));
    const store = new Store({ n: 0 });
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.get().n));
    store.set({ n: 1 });
    store.set({ n: 2 });
    store.set((s) => ({ n: s.n + 1 }));
    expect(seen).toEqual([]);
    frames.forEach((f) => f());
    vi.advanceTimersByTime(1000); // the fallback doesn't notify again
    expect(seen).toEqual([3]);
  });

  it('still notifies when no frame comes (a hidden or covered window)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const store = new Store({ n: 0 });
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.get().n));
    store.set({ n: 5 });
    vi.advanceTimersByTime(249);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([5]);
    store.set({ n: 6 });
    vi.advanceTimersByTime(250);
    expect(seen).toEqual([5, 6]);
  });
});
