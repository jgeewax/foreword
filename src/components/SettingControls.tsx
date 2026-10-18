// Settings' own controls, in place of the browser's checkboxes and radio
// buttons: a switch for on or off, and a segmented control for one of a few.
import { useRef, type ReactNode } from 'react';

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
