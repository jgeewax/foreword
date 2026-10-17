import { useEffect, useRef, type ReactNode } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Radio<T extends string>({ name, value, current, onChange, label, detail }: { name: string; value: T; current: T; onChange: (v: T) => void; label: string; detail?: string }) {
  return (
    <label className="settings-option">
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} />
      <span>
        {label}
        {detail && <span className="muted"> — {detail}</span>}
      </span>
    </label>
  );
}

export function SettingsDialog() {
  const settings = useStore(studio.store, (s) => s.settings);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = dialogRef.current;
    (root?.querySelector<HTMLElement>('.modal-body input:checked') ?? root?.querySelector<HTMLElement>('.modal-body input, .modal-body select'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        studio.closeSettings();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.closeSettings()}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" ref={dialogRef}>
        <header className="modal-header">
          <h1>Settings</h1>
          <button className="icon" aria-label="Close settings" onClick={() => studio.closeSettings()}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <Section title="Chat">
            <div className="settings-field">
              <div className="settings-label">Send a message with</div>
              <Radio name="sendKey" value="enter" current={settings.sendKey} onChange={(v) => studio.updateSettings({ sendKey: v })} label="Enter" detail="Shift+Enter for a new line" />
              <Radio
                name="sendKey"
                value="mod-enter"
                current={settings.sendKey}
                onChange={(v) => studio.updateSettings({ sendKey: v })}
                label="⌘ Enter"
                detail="Enter for a new line"
              />
            </div>
          </Section>
          <Section title="Agent">
            <div className="settings-field">
              <div className="settings-label">When the agent wants to change a file</div>
              <Radio
                name="agentEdits"
                value="ask"
                current={settings.agentEdits}
                onChange={(v) => studio.updateSettings({ agentEdits: v })}
                label="Ask me each time"
                detail="you see the proposed change first"
              />
              <Radio
                name="agentEdits"
                value="allow"
                current={settings.agentEdits}
                onChange={(v) => studio.updateSettings({ agentEdits: v })}
                label="Edit without asking"
                detail="changes appear in the editor and preview directly"
              />
              <p className="settings-help">Applies to the current conversation right away. .env files always ask, and the agent can never run build commands.</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
