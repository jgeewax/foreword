import { describe, expect, it } from 'vitest';
import { LatencyStats, PerfTracker, clock } from './perf';
import { buildTree } from './tree';

describe('buildTree', () => {
  it('nests paths with folders first and natural sort', () => {
    const tree = buildTree(['main.typ', 'chapters/ch10.typ', 'chapters/ch2.typ', 'refs.bib', 'figures/a.svg']);
    expect(tree.map((n) => n.name)).toEqual(['chapters', 'figures', 'main.typ', 'refs.bib']);
    expect(tree[0].children.map((n) => n.path)).toEqual(['chapters/ch2.typ', 'chapters/ch10.typ']);
  });
});

describe('LatencyStats', () => {
  it('computes nearest-rank percentiles over a bounded window', () => {
    const s = new LatencyStats(5);
    [10, 20, 30, 40, 50, 60].forEach((v) => s.add(v));
    expect(s.count).toBe(5);
    expect(s.percentile(50)).toBe(40);
    expect(s.percentile(95)).toBe(60);
  });
});

describe('PerfTracker', () => {
  it('matches each edit to the first preview paint after it', () => {
    const p = new PerfTracker();
    p.edit();
    const editAt = clock();
    p.previewPainted([editAt - 1000]); // a paint before the edit doesn't count
    expect(p.editToPreview.count).toBe(0);
    p.previewPainted([editAt + 120]);
    expect(p.editToPreview.count).toBe(1);
    expect(p.editToPreview.percentile(50)!).toBeGreaterThanOrEqual(119);
    p.previewPainted([editAt + 500]); // already matched
    expect(p.editToPreview.count).toBe(1);
  });
});

describe('paths for messages', () => {
  it('reads a pasted path: quotes, file URLs and Terminal escapes', async () => {
    const { pastedPath } = await import('./paths');
    expect(pastedPath('  /opt/homebrew/bin/tinymist \n')).toBe('/opt/homebrew/bin/tinymist');
    expect(pastedPath('"/Applications/My Tools/git"')).toBe('/Applications/My Tools/git');
    expect(pastedPath("'~/bin/opencode'")).toBe('~/bin/opencode');
    expect(pastedPath('file:///Users/ada/My%20Tools/tinymist')).toBe('/Users/ada/My Tools/tinymist');
    expect(pastedPath('/Users/ada/My\\ Tools/tinymist')).toBe('/Users/ada/My Tools/tinymist');
    expect(pastedPath('/a/b\n/c/d')).toBe('/a/b');
  });
});
