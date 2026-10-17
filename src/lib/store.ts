import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * Minimal external store. Subscribers are notified at most once per animation
 * frame, so bursts of updates (agent token streaming, typing) cost one render.
 * A hidden or covered window gets no frames, so a timer stands in: what
 * subscribers do (and what's rendered) keeps up while the window is behind
 * others.
 */
export class Store<S> {
  private listeners = new Set<() => void>();
  private scheduled = false;
  private fallback: ReturnType<typeof setTimeout> | undefined;

  constructor(private state: S) {}

  get = (): S => this.state;

  set(update: Partial<S> | ((s: S) => Partial<S>)) {
    const patch = typeof update === 'function' ? update(this.state) : update;
    this.state = { ...this.state, ...patch };
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(this.flush);
    this.fallback = setTimeout(this.flush, 250);
  }

  private flush = () => {
    if (!this.scheduled) return;
    this.scheduled = false;
    clearTimeout(this.fallback);
    for (const l of this.listeners) l();
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** Subscribe to a slice; re-renders only when the selected value changes (Object.is). */
export function useStore<S, T>(store: Store<S>, selector: (s: S) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const get = useCallback(() => selectorRef.current(store.get()), [store]);
  return useSyncExternalStore(store.subscribe, get, get);
}

export class Emitter<E extends Record<string, unknown[]>> {
  private handlers: { [K in keyof E]?: Set<(...args: E[K]) => void> } = {};

  on<K extends keyof E>(event: K, handler: (...args: E[K]) => void): () => void {
    (this.handlers[event] ??= new Set()).add(handler);
    return () => this.handlers[event]?.delete(handler);
  }

  emit<K extends keyof E>(event: K, ...args: E[K]) {
    for (const h of this.handlers[event] ?? []) h(...args);
  }
}
