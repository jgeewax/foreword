// Settings' own controls, in place of the browser's checkboxes, radio
// buttons and selects: a switch for on or off, a segmented control for one
// of a few, a colour picker, and a menu for one of many.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './icons';

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

/**
 * A setting typed in a box (a column, a list of columns). It's used on Enter, on
 * leaving the box or on closing Settings, not at each key, so typing 200 doesn't
 * wrap at 20 on the way. While it isn't one, `mistake` says why; leaving the box
 * then puts the setting back, and Esc does at any time (a second Esc closes Settings).
 */
export function TypedSetting<T>({
  label,
  value,
  parse,
  format,
  onChange,
  mistake,
  className,
  placeholder,
  before,
  after,
}: {
  label: string;
  value: T;
  parse: (text: string) => T | null;
  format: (value: T) => string;
  onChange: (value: T) => void;
  mistake: string;
  className?: string;
  placeholder?: string;
  /** Words either side of the box ("Wrap at", "characters"). */
  before?: ReactNode;
  after?: ReactNode;
}) {
  const shown = format(value);
  const [draft, setDraft] = useState(shown);
  const [typing, setTyping] = useState(false);
  // The setting when it changes elsewhere (the settings file), but not under the author's typing.
  useEffect(() => {
    if (!typing) setDraft(shown);
  }, [shown, typing]);
  const parsed = parse(draft);
  const use = useRef(() => {});
  use.current = () => {
    if (parsed !== null && format(parsed) !== shown) onChange(parsed);
  };
  useEffect(() => () => use.current(), []);
  return (
    <>
      <div className="settings-row">
        {before}
        <input
          className={`settings-input${className ? ` ${className}` : ''}`}
          aria-label={label}
          aria-invalid={parsed === null}
          placeholder={placeholder}
          spellCheck={false}
          value={draft}
          onFocus={() => setTyping(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            use.current();
            setTyping(false);
            setDraft(parsed === null ? shown : format(parsed));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              use.current();
              if (parsed !== null) setDraft(format(parsed));
            } else if (e.key === 'Escape' && draft !== shown) {
              // Puts it back, not closing Settings.
              e.stopPropagation();
              setDraft(shown);
            }
          }}
        />
        {after}
      </div>
      {parsed === null && <div className="settings-help bad">{mistake}</div>}
    </>
  );
}

export type PickerRow = {
  key: string;
  /** What it is, more about it, and a path (in type, as Tools' copies). */
  title: ReactNode;
  detail?: ReactNode;
  path?: string;
  icon?: ReactNode;
  selected?: boolean;
  /** A heading above this row (once for a run of rows with the same one). */
  section?: string;
  /** Another way to choose (Choose a folder…), under a line, rather than a choice. */
  action?: boolean;
  run: () => void;
};

/**
 * One of many, in a menu under a button that shows the choice, as Settings ▸
 * Tools' program picker: arrows open it and move, Enter picks, Esc closes the
 * menu (not Settings). With `filter`, a box at the top narrows a long list.
 * `disabled` with one choice shows it, without a menu.
 */
export function Picker({ label, trigger, rows, disabled = false, filter }: { label: string; trigger: ReactNode; rows: PickerRow[]; disabled?: boolean; filter?: (row: PickerRow, query: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shown = filter && query.trim() ? rows.filter((r) => r.action || filter(r, query.trim().toLowerCase())) : rows;
  const close = (refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  };
  const pick = (row: PickerRow | undefined) => {
    if (!row) return;
    close();
    row.run();
  };

  useEffect(() => {
    if (!open) return;
    setHighlight(Math.max(0, rows.findIndex((r) => r.selected)));
    // Keys go to the menu (a click doesn't focus a button in WebKit), so Esc closes it rather than Settings.
    if (!filter) triggerRef.current?.focus();
    // The whole menu in view, in Settings' scrolling page.
    listRef.current?.scrollIntoView({ block: 'nearest' });
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setHighlight(0), [query]);
  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-row="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length));
    } else if (e.key === 'Enter' || (e.key === ' ' && !(e.target instanceof HTMLInputElement))) {
      e.preventDefault();
      pick(shown[highlight]);
    } else if (e.key === 'Escape') {
      // Closes the menu, not Settings.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const firstAction = shown.findIndex((r) => r.action);

  return (
    <div className="tool-picker picker" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        className={`tool-trigger picker-trigger${disabled ? ' static' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {trigger}
        {!disabled && <Icon name="chevronDown" size={14} />}
      </button>
      {open && (
        <div className="tool-list" role="listbox" aria-label={label} ref={listRef}>
          {filter && (
            <input
              className="picker-filter"
              placeholder="Filter"
              aria-label={`Filter: ${label}`}
              spellCheck={false}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {query.trim() && shown.every((r) => r.action) && <div className="picker-none">Nothing matches “{query.trim()}”.</div>}
          {shown.map((r, i) => (
            <div key={r.key}>
              {i === firstAction && i > 0 && <div className="tool-list-divider" />}
              {r.section && !r.action && r.section !== shown[i - 1]?.section && <div className="tool-list-section">{r.section}</div>}
              <div
                role="option"
                aria-selected={!!r.selected}
                data-row={i}
                className={`tool-option${r.action ? ' tool-action' : ''}${i === highlight ? ' highlighted' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
              >
                <span className="tool-option-check">{r.selected && <Icon name="check" size={13} />}</span>
                {r.icon && <span className="picker-option-icon">{r.icon}</span>}
                <span className="tool-option-body">
                  <span className="tool-option-title">{r.title}</span>
                  {r.detail && <span className="tool-option-detail">{r.detail}</span>}
                  {r.path && <span className="tool-option-path">{r.path}</span>}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
