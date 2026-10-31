import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { OPTION_COUNTS, optionsLabel } from '../services/agent/options-mode';
import { Icon } from './icons';

/**
 * How many options Options mode writes: beside the mode in the message box,
 * and in the selection bar's Options card. One setting for both, kept for
 * every book.
 */
export function OptionCount({ className = '', onPicked }: { className?: string; onPicked?: () => void }) {
  const count = useStore(studio.store, (s) => s.settings.optionCount);
  return (
    <label className={`option-count ${className}`} title="How many options to write: each is a version to pick from">
      <select
        aria-label="How many options"
        value={count}
        onChange={(e) => {
          studio.updateSettings({ optionCount: Number(e.target.value) });
          onPicked?.();
        }}
      >
        {OPTION_COUNTS.map((n) => (
          <option key={n} value={n}>
            {optionsLabel(n)}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={10} />
    </label>
  );
}
