// Settings' own controls, in place of the browser's checkboxes and radio
// buttons: a switch for on or off, a segmented control for one of a few,
// and a colour picker.
import { useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * An on/off setting, as in macOS's System Settings: what it does, then the
 * switch. It applies at once; a click anywhere on the row flips it.
 */
export function SwitchRow({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="settings-switch">
      <span className="settings-switch-text">{children}</span>
      <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
        <span className="switch-knob" />
      </button>
    </label>
  );
}

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** One of a few, side by side, with the chosen one's note under it. Arrows move the choice, as in a radio group. */
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; detail?: string }[]; onChange: (v: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = options.findIndex((o) => o.value === value);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = STEPS[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (at + step + options.length) % options.length;
    onChange(options[next].value);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label={label} ref={ref} onKeyDown={onKeyDown}>
        {options.map((o, i) => (
          <button key={o.value} type="button" role="radio" aria-checked={i === at} tabIndex={i === at ? 0 : -1} className={i === at ? 'active' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {options[at]?.detail && <p className="settings-help">{options[at].detail}</p>}
    </>
  );
}

/**
 * A colour for a mark: swatches, any other colour (the Mac's colour picker),
 * or none: "Same as yours", the lines looking like the ones you wrote. Arrows
 * move along, as in a radio group.
 */
export function ColorChoice({ label, on, color, colors, onChange }: { label: string; on: boolean; color: string; colors: { color: string; name: string }[]; onChange: (choice: { on: boolean; color?: string }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  // The swatches, then another colour (the one chosen, if it isn't a swatch's), then none.
  const other = colors.length;
  const none = colors.length + 1;
  const preset = colors.findIndex((c) => c.color === color);
  const at = !on ? none : preset >= 0 ? preset : other;
  const pick = (i: number) => onChange(i === none ? { on: false } : { on: true, color: i === other ? color : colors[i].color });
  const openPicker = () => {
    const input = pickerRef.current;
    if (!input) return;
    if (input.showPicker) input.showPicker();
    else input.click();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = STEPS[e.key];
    if (!step) return;
    e.preventDefault();
    let to = (at + step + none + 1) % (none + 1);
    // Arrows pass "another colour" until there is one (choosing one opens the picker).
    if (to === other && preset >= 0) to = (to + step + none + 1) % (none + 1);
    pick(to);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
  const radio = (i: number) => ({ role: 'radio', 'aria-checked': i === at, tabIndex: i === at ? 0 : -1 }) as const;
  return (
    <div className="color-choice" role="radiogroup" aria-label={label} ref={ref} onKeyDown={onKeyDown}>
      {colors.map((c, i) => (
        <button key={c.color} type="button" className="swatch" style={{ '--swatch': c.color } as CSSProperties} aria-label={c.name} title={c.name} {...radio(i)} onClick={() => pick(i)} />
      ))}
      <button
        type="button"
        className={`swatch other${preset >= 0 ? '' : ' custom'}`}
        style={preset >= 0 ? undefined : ({ '--swatch': color } as CSSProperties)}
        aria-label="Another colour"
        title={preset >= 0 ? 'Another colour…' : `${color}: click for another`}
        {...radio(other)}
        onClick={openPicker}
      />
      <input ref={pickerRef} type="color" className="color-picker-input" tabIndex={-1} aria-hidden value={color} onChange={(e) => onChange({ on: true, color: e.target.value })} />
      <button type="button" className="swatch-none" title="No mark: these lines look like the ones you wrote" {...radio(none)} onClick={() => pick(none)}>
        Same as yours
      </button>
    </div>
  );
}
