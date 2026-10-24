// A ```chart block, drawn (chart.ts reads it): one series of bars from zero,
// the bars the reply is about in the chart's colour and the rest grey, and
// reference lines. Many bars stand as columns, with a tip on hover; a few lie
// as rows, each with its label and value.
import { useMemo, useState } from 'react';
import { chartValue, chartWords, parseChart, type ChartSpec } from '../lib/chart';

/** Bars past this many stand as columns. */
const ROWS_UP_TO = 8;
/** Values written over columns: the marked ones, a few at most. */
const COLUMN_VALUES = 3;

export function BarChart({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...spec.bars.map((b) => b.value), ...spec.marks.map((m) => m.value)) || 1;
  const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  const anyOn = spec.bars.some((b) => b.on);
  const unit = spec.unit && spec.unit !== '%' ? ` ${spec.unit}` : '';
  const say = (n: number) => chartValue(n, spec.unit);
  const head = spec.title || spec.unit ? (
    <figcaption className="chart-title">
      {spec.title}
      {spec.unit && spec.unit !== '%' && <span className="chart-unit">{spec.unit}</span>}
    </figcaption>
  ) : null;
  const marksKey = spec.marks.length > 0 && (
    <div className="chart-key" aria-hidden>
      {spec.marks.map((m, i) => (
        <span key={i}>
          <i className="chart-key-mark" />
          {m.label ? `${m.label} ` : ''}
          {say(m.value)}
        </span>
      ))}
    </div>
  );

  if (spec.bars.length <= ROWS_UP_TO) {
    return (
      <figure className={`chart chart-rows${anyOn ? ' some-on' : ''}`}>
        {head}
        <div className="chart-plot" role="img" aria-label={chartWords(spec)}>
          {spec.bars.map((b, i) => (
            <div key={i} className={`chart-row${b.on ? ' on' : ''}`} aria-hidden>
              <span className="chart-row-label" title={b.label}>
                {b.label}
              </span>
              <span className="chart-track">
                <span className={`chart-fill${b.value ? '' : ' zero'}`} style={{ width: pct(b.value) }} />
                {spec.marks.map((m, j) => (
                  <span key={j} className="chart-mark-v" style={{ left: pct(m.value) }} />
                ))}
              </span>
              <span className="chart-row-value">{say(b.value)}</span>
            </div>
          ))}
        </div>
        {marksKey}
      </figure>
    );
  }

  const n = spec.bars.length;
  const at = (i: number) => `${((i + 0.5) / n) * 100}%`;
  const top = spec.bars.reduce((t, b, i) => (b.value > spec.bars[t].value ? i : t), 0);
  const valued = new Set((anyOn ? spec.bars.flatMap((b, i) => (b.on ? [i] : [])) : [top]).slice(0, COLUMN_VALUES));
  // Under the columns: the first and last bars' labels, and the marked ones'.
  const named = [...new Set([0, ...valued, n - 1])].sort((a, b) => a - b);
  return (
    <figure className={`chart chart-columns${anyOn ? ' some-on' : ''}`}>
      {head}
      <div className="chart-plot" role="img" aria-label={chartWords(spec)} onMouseLeave={() => setHover(null)}>
        {spec.marks.map((m, i) => (
          <span key={i} className="chart-mark-h" style={{ bottom: pct(m.value) }} aria-hidden />
        ))}
        {spec.bars.map((b, i) => (
          <span key={i} className={`chart-col${b.on ? ' on' : ''}${hover === i ? ' hover' : ''}`} onMouseEnter={() => setHover(i)} aria-hidden>
            <span className={`chart-bar${b.value ? '' : ' zero'}`} style={{ height: pct(b.value) }}>
              {valued.has(i) && <span className="chart-col-value">{say(b.value)}</span>}
            </span>
          </span>
        ))}
        {hover != null && (
          <span className="chart-tip" style={{ left: `clamp(56px, ${at(hover)}, calc(100% - 56px))` }} aria-hidden>
            <strong>{spec.bars[hover].label}</strong> {say(spec.bars[hover].value)}
            {unit}
          </span>
        )}
      </div>
      <div className="chart-axis" aria-hidden>
        {named.map((i) => (
          <span key={i} className={[spec.bars[i].on && 'on', i === 0 && 'first', i === n - 1 && 'last'].filter(Boolean).join(' ')} style={{ left: i === 0 ? 0 : i === n - 1 ? '100%' : at(i) }}>
            {spec.bars[i].label}
          </span>
        ))}
      </div>
      {marksKey}
    </figure>
  );
}

/** A ```chart block's source: drawn once it's all there and it can be read, else as written. */
export function ChartBlock({ source, open }: { source: string; open: boolean }) {
  const spec = useMemo(() => (open ? null : parseChart(source)), [source, open]);
  if (open) return <div className="chart-pending shimmer">Drawing a chart…</div>;
  if (!spec) return <pre className="md-code" data-lang="chart">{source}</pre>;
  return <BarChart spec={spec} />;
}
