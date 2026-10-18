// The chat's assistant menu, under the message box beside the model: the
// assistant's mark; it opens upward with each assistant and how it is on this
// Mac (as in Settings ▸ Assistant), to switch to, and a way to its settings.
import { useEffect, useRef, useState } from 'react';
import { studio } from '../app/studio';
import { ASSISTANT_NAMES, ASSISTANTS, type AssistantId } from '../app/settings';
import { ipc, type AssistantsSetup } from '../lib/ipc';
import { useStore } from '../lib/store';
import { ABOUT, AssistantMark, cardStatus, nowOf } from './AssistantSettings';
import { Icon } from './icons';

export function AssistantMenu() {
  const chosen = useStore(studio.store, (s) => s.settings.assistant);
  const agent = useStore(studio.store, (s) => s.agent);
  const opencode = useStore(studio.store, (s) => s.tools?.opencode);
  const [open, setOpen] = useState(false);
  const [setups, setSetups] = useState<AssistantsSetup | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const name = ASSISTANT_NAMES[chosen];
  const now = nowOf(chosen, agent, setups?.[chosen], true);
  const busy = studio.assistantBusy;
  const current = agent.model ? agent.models.find((m) => m.providerID === agent.model?.providerID && m.id === agent.model?.id) : undefined;
  const modelName = current?.name ?? agent.model?.id ?? null;
  // The mark's dot, only when it isn't simply running: starting, or not working.
  const markTone = now === 'starting' ? 'busy' : now === 'running' || now === 'off' ? null : now === 'signed-out' ? 'warn' : 'bad';

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (id: AssistantId) => {
    if (id !== chosen && !studio.switchAssistant(id)) return;
    close();
    studio.events.emit('focus-composer');
  };
  const settings = () => {
    close();
    studio.openSettings('assistant');
  };

  useEffect(() => {
    if (!open) return;
    // How each would run here: it changes as programs are installed or signed in to.
    void ipc.assistantsStatus().then(setSetups, (e) => console.warn('assistants status', e));
    rootRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && close();
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // ↑↓ move between the assistants and Settings; Esc closes.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('.assistant-menu-popover [role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="assistant-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        className="assistant-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Assistant: ${name}`}
        title={`${name}: switch assistant, or its settings`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="assistant-trigger-mark">
          <AssistantMark id={chosen} size={16} />
          {markTone && <span className={`assistant-trigger-dot tone-${markTone}`} />}
        </span>
        <span className="assistant-trigger-name">{name}</span>
      </button>
      {open && (
        <div className="assistant-menu-popover" role="menu" aria-label="Assistant">
          <div className="assistant-menu-title">Writing assistant</div>
          {ASSISTANTS.map((id) => {
            const status = cardStatus(id, id === chosen ? now : null, setups?.[id], modelName, opencode?.version ?? null);
            const locked = busy && id !== chosen;
            return (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={id === chosen}
                aria-disabled={locked}
                data-assistant={id}
                className={`assistant-menu-row${id === chosen ? ' current' : ''}${locked ? ' locked' : ''}`}
                title={locked ? 'The assistant is working: stop it, or let it finish, to switch' : id === chosen ? `${ASSISTANT_NAMES[id]} is the assistant` : `Switch to ${ASSISTANT_NAMES[id]} (a new conversation)`}
                onClick={() => choose(id)}
              >
                <AssistantMark id={id} size={26} />
                <span className="assistant-menu-text">
                  <span className="assistant-menu-name">
                    {ASSISTANT_NAMES[id]} <span className="assistant-card-maker">{ABOUT[id].maker}</span>
                  </span>
                  <span className={`assistant-status tone-${status.tone}`}>
                    <span className="assistant-dot" />
                    {status.text}
                  </span>
                </span>
                <span className="model-check">{id === chosen ? <Icon name="check" size={13} /> : null}</span>
              </button>
            );
          })}
          <div className="assistant-menu-footer">
            <span className="muted">{busy ? 'Switch once the assistant has finished.' : 'Switching starts a new conversation.'}</span>
            <button role="menuitem" className="small assistant-menu-settings" onClick={settings}>
              <Icon name="settings" size={13} /> Settings…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
