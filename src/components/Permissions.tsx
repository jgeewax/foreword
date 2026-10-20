import { useEffect, useRef, useState } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { Icon } from './icons';
import { PERMISSION_ITEMS, presetOf, PRESETS, type Level, type PresetId } from '../services/agent/permissions';
import { CommandRules } from './CommandRules';

const LEVEL_LABELS: [Level, string][] = [
  ['ask', 'Ask'],
  ['allow', 'Allow'],
  ['deny', 'Never'],
];

/** Presets plus one Ask / Allow / Never control per kind of action. */
export function PermissionsEditor() {
  const permissions = useStore(studio.store, (s) => s.settings.permissions);
  const preset = presetOf(permissions);
  return (
    <div className="permissions-editor">
      <div className="perm-presets" role="radiogroup" aria-label="Presets">
        {(Object.keys(PRESETS) as PresetId[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={preset === id}
            className={`perm-preset${preset === id ? ' active' : ''}`}
            title={PRESETS[id].description}
            onClick={() => studio.updateSettings({ permissions: PRESETS[id].permissions })}
          >
            {PRESETS[id].label}
          </button>
        ))}
      </div>
      <div className="perm-description">{preset === 'custom' ? 'Custom: your own mix, below.' : PRESETS[preset].description}</div>
      {PERMISSION_ITEMS.map((item) => (
        <div key={item.key} className="perm-row">
          <div className="perm-text">
            <span className="perm-label">{item.label}</span>
            <span className="perm-detail">{item.detail}</span>
          </div>
          <div className="perm-levels" role="radiogroup" aria-label={item.label}>
            {LEVEL_LABELS.map(([level, label]) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={permissions[item.key] === level}
                className={`perm-level ${level}${permissions[item.key] === level ? ' active' : ''}`}
                onClick={() => studio.updateSettings({ permissions: { ...permissions, [item.key]: level } })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="perm-always">
        Always: it can read this book’s files, asks before reading .env files, and can never build or compile the book (the preview does that). Ask, Plan and
        Options never change files. Changes apply to the current conversation right away.
      </p>
    </div>
  );
}

/** The permissions chip in the composer; opens the editor upward. */
export function PermissionsMenu() {
  const permissions = useStore(studio.store, (s) => s.settings.permissions);
  const rules = useStore(studio.store, (s) => s.settings.alwaysAllow.length + s.settings.neverAllow.length + (s.project.settings.alwaysAllow?.length ?? 0) + (s.project.settings.neverAllow?.length ?? 0) + (s.agent.sessionId ? (s.taskRules[s.agent.sessionId]?.alwaysAllow.length ?? 0) : 0));
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'kinds' | 'rules'>('kinds');
  const rootRef = useRef<HTMLDivElement>(null);
  const preset = presetOf(permissions);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="perm-menu" ref={rootRef}>
      <button
        className={`perm-trigger preset-${preset}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Permissions: ${preset === 'custom' ? 'Custom' : PRESETS[preset].label}`}
        title={`What the assistant may do: ${preset === 'custom' ? 'Custom' : PRESETS[preset].label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="shield" size={14} />
        {/* Hidden when the chat is narrow; the shield's colour still tells. */}
        <span className="perm-trigger-label">
          {preset === 'custom' ? 'Custom' : PRESETS[preset].label}
          {rules > 0 && <span className="perm-trigger-rules"> · {rules === 1 ? '1 rule' : `${rules} rules`}</span>}
        </span>
      </button>
      {open && (
        <div className="perm-popover" role="dialog" aria-label="Permissions">
          <div className="perm-title">What the assistant may do</div>
          <div className="perm-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'kinds'} className={tab === 'kinds' ? 'active' : ''} onClick={() => setTab('kinds')}>
              Kinds of action
            </button>
            <button role="tab" aria-selected={tab === 'rules'} className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>
              Your rules{rules > 0 ? ` · ${rules}` : ''}
            </button>
          </div>
          {tab === 'kinds' ? <PermissionsEditor /> : <CommandRules scopes={['task', 'book', 'all']} builtIn own />}
        </div>
      )}
    </div>
  );
}
