// Latency measurement for the SPEC §6 budgets. Timestamps are epoch ms with
// sub-ms precision so they compare across webviews (the preview runs in its own
// web content process and reports paint times over IPC).
export const clock = () => performance.timeOrigin + performance.now();

export class LatencyStats {
  private samples: number[] = [];
  constructor(private capacity = 200) {}

  add(ms: number) {
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get count() {
    return this.samples.length;
  }

  percentile(p: number): number | null {
    if (!this.samples.length) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  }

  values() {
    return [...this.samples];
  }

  clear() {
    this.samples = [];
  }
}

/** Calls `cb` just after the next frame is painted (rAF, then a task). */
export function afterNextPaint(cb: () => void) {
  requestAnimationFrame(() => {
    const ch = new MessageChannel();
    ch.port1.onmessage = cb;
    ch.port2.postMessage(0);
  });
}

const PREVIEW_MATCH_WINDOW_MS = 3000;

/**
 * key → editor paint, and edit → preview paint. Each edit is matched to the
 * first preview paint after it (within 3 s). During fast typing a paint can
 * belong to an earlier edit, so burst numbers are slightly optimistic; isolated
 * edits are exact.
 */
export class PerfTracker {
  readonly inputToPaint = new LatencyStats();
  readonly editToPreview = new LatencyStats();
  private pendingKey: number | null = null;
  private pendingEdits: number[] = [];

  keyDown(at = clock()) {
    this.pendingKey = at;
  }

  /** Call synchronously from the editor's content-change handler. */
  edit(onMeasured?: () => void) {
    const now = clock();
    this.pendingEdits.push(now);
    if (this.pendingEdits.length > 500) this.pendingEdits.shift();
    const key = this.pendingKey;
    if (key == null) return;
    this.pendingKey = null;
    afterNextPaint(() => {
      this.inputToPaint.add(clock() - key);
      onMeasured?.();
    });
  }

  previewPainted(paints: number[]) {
    for (const t of paints) {
      const matched = this.pendingEdits.filter((e) => e <= t && t - e <= PREVIEW_MATCH_WINDOW_MS);
      for (const e of matched) this.editToPreview.add(t - e);
      this.pendingEdits = this.pendingEdits.filter((e) => e > t);
    }
  }
}
