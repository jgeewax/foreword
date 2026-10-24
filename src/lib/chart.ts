// A chart the assistant asks the chat to draw: a ```chart block of bars, for
// numbers it counted that compare (chapter lengths, how often a name comes
// up). One series, bars from zero, the ones the answer is about marked, and
// reference lines ("the middle chapter"):
//
//   ```chart
//   title: Chapters by length
//   unit: words
//   mark: 10087 | middle
//   bar: Ch 1 | 8775
//   bar: Ch 13 | 13188 | *
//   ```
//
// A line "label | value" is a bar too. Anything else it can't read, and the
// block shows as written.

export type ChartBar = { label: string; value: number; on: boolean };
export type ChartMark = { value: number; label: string };
export type ChartSpec = { title: string; unit: string; bars: ChartBar[]; marks: ChartMark[] };

export const MAX_BARS = 60;

/** A number as written: "13,188", "1 204", "42%", "0.5". Null if it isn't one, or is below zero. */
export function chartNumber(s: string): number | null {
  const t = s.trim().replace(/[\s,_]/g, '').replace(/%$/, '');
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const ON = /^(\*|on|yes|this|highlight(ed)?|mark(ed)?)$/i;

export function parseChart(body: string): ChartSpec | null {
  const spec: ChartSpec = { title: '', unit: '', bars: [], marks: [] };
  let percent = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(title|unit|mark|bar)\s*:\s*(.*)$/i.exec(line);
    const key = m?.[1].toLowerCase();
    const value = m ? m[2] : line;
    if (key === 'title') spec.title = value.trim();
    else if (key === 'unit') spec.unit = value.trim();
    else if (key === 'mark') {
      const [n, ...label] = value.split('|');
      const v = chartNumber(n);
      if (v == null) return null;
      spec.marks.push({ value: v, label: label.join('|').trim() });
    } else if (key === 'bar' || value.includes('|')) {
      const [label, n, flag = ''] = value.split('|').map((p) => p.trim());
      const v = n == null ? null : chartNumber(n);
      if (v == null || !label) return null;
      if (/%\s*$/.test(n)) percent = true;
      spec.bars.push({ label, value: v, on: ON.test(flag) });
    } else return null;
  }
  if (!spec.bars.length || spec.bars.length > MAX_BARS) return null;
  if (percent && !spec.unit) spec.unit = '%';
  spec.marks = spec.marks.slice(0, 2);
  return spec;
}

/** A value as the chart says it: "13,188", "4.5", "42%". */
export function chartValue(n: number, unit = ''): string {
  const s = n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 2 : n < 100 ? 1 : 0 });
  return unit === '%' ? `${s}%` : s;
}

/** The chart in words, for a screen reader: its title, each bar, and the reference lines. */
export function chartWords(spec: ChartSpec): string {
  const unit = spec.unit && spec.unit !== '%' ? ` ${spec.unit}` : '';
  const bars = spec.bars.map((b) => `${b.label}: ${chartValue(b.value, spec.unit)}${unit}`).join('; ');
  const marks = spec.marks.map((m) => `${m.label || 'line'} at ${chartValue(m.value, spec.unit)}`).join('; ');
  return [spec.title, bars, marks].filter(Boolean).join('. ');
}
