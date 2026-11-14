// The selection card's setup chip: what a request from it will run on (the
// assistant's mark, the model, the effort), beside the button that sends it.
// It opens a menu to change them there, as the message box's menus do, and to
// pin the request's mode to them (mode-setups.ts). The menu is in the page's
// top layer: the card is inside the editor, which would cut it off.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setupOf } from '../app/mode-setups';
import { ASSISTANT_NAMES, ASSISTANTS, type AssistantId } from '../app/settings';
import { studio } from '../app/studio';
import { ipc, type AssistantsSetup } from '../lib/ipc';
import { useStore } from '../lib/store';
import { modeConfig, type AgentMode } from '../services/agent/modes';
import { DEFAULT_EFFORT, type EffortOption, type ModelInfo, type ModelRef } from '../services/agent/types';
import { AssistantMark, cardStatus, nowOf } from './AssistantSettings';
import { Meter } from './EffortPicker';
import { Icon } from './icons';
import { ModelList } from './ModelPicker';

type Shown = {
  assistant: AssistantId;
  model: ModelRef | null;
  modelName: string | null;
  effort: string | null;
  effortName: string | null;
  /** To pick from: the assistant's models (another's as last listed here), and the model's levels (null: not known yet). */
  models: ModelInfo[];
  efforts: EffortOption[] | null;
};

/**
 * What a request in `mode` runs on: what's in use, if that's what it runs on
 * (the mode shown, or neither pinned); else the mode's own or the usual one,
 * as kept, which the chat switches to when the request goes.
 */
function useShown(mode: AgentMode): { shown: Shown; inUse: boolean; pinned: boolean } {
  const setups = useStore(studio.store, (s) => s.agent.setups);
  const current = useStore(studio.store, (s) => s.agent.mode);
  const assistant = useStore(studio.store, (s) => s.settings.assistant);
  const models = useStore(studio.store, (s) => s.agent.models);
  const model = useStore(studio.store, (s) => s.agent.model);
  const efforts = useStore(studio.store, (s) => s.agent.efforts);
  const effort = useStore(studio.store, (s) => s.agent.effort);
  const owner = (m: AgentMode) => (setups.pins[m] ? m : null);
  const inUse = owner(mode) === owner(current);
  const pinned = !!setups.pins[mode];
  const kept = inUse ? null : (setupOf(setups, mode) ?? { assistant, model: null, effort: null });
  // Another assistant's are read from what was kept (only when they could have changed).
  const keptModels = useMemo(() => (kept ? studio.modelsOf(kept.assistant) : []), [kept?.assistant, models]); // eslint-disable-line react-hooks/exhaustive-deps
  const keptEfforts = useMemo(() => (kept?.model ? studio.effortsOf(kept.assistant, kept.model) : null), [kept?.assistant, kept?.model?.providerID, kept?.model?.id, efforts]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!kept) {
    const info = model ? models.find((m) => m.providerID === model.providerID && m.id === model.id) : undefined;
    const level = efforts.find((o) => o.value === effort);
    return { inUse, pinned, shown: { assistant, model, modelName: info?.name ?? model?.id ?? null, effort, effortName: level?.name ?? null, models, efforts } };
  }
  return {
    inUse,
    pinned,
    shown: {
      assistant: kept.assistant,
      model: kept.model,
      modelName: kept.model ? (kept.modelName ?? kept.model.id) : null,
      effort: kept.effort,
      effortName: kept.effort ? (kept.effortName ?? kept.effort) : null,
      models: keptModels,
      efforts: keptEfforts,
    },
  };
}

/** The effort's name, unless it's the model's own ("Default"). */
const levelName = (s: Shown) => (s.effort && s.effort !== DEFAULT_EFFORT ? s.effortName : null);

/** "Claude Code · Opus 5.5 · Medium" (an assistant whose model wasn't picked: its own). */
const shownLine = (s: Shown) => [ASSISTANT_NAMES[s.assistant], s.modelName ?? 'its usual model', levelName(s)].filter(Boolean).join(' · ');

/** The chip: `verb` is what the card does ("Revise"), in `mode`; `narrow`: the model only; `onClosed` gives the card its keys back. */
export function SetupChip({ mode, verb, narrow, onClosed }: { mode: AgentMode; verb: string; narrow?: boolean; onClosed?: () => void }) {
  const { shown, inUse, pinned } = useShown(mode);
  const running = useStore(studio.store, (s) => s.agent.running);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = modeConfig(mode).label;
  const line = shownLine(shown);
  // As the message box's menus: not while a reply runs on it.
  const locked = inUse && running;
  const close = () => {
    setOpen(false);
    onClosed?.();
  };
  return (
    <>
      <button
        ref={trigger}
        className={`setup-chip${pinned ? ' pinned' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${verb} runs on ${line}${pinned ? `, pinned to ${label} mode` : ''}`}
        disabled={locked}
        title={locked ? `${verb} runs on ${line}: it can be changed once the reply at work is done` : `${verb} runs on ${line}${pinned ? ` (pinned to ${label} mode)` : ''}. Click to change it.`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <AssistantMark id={shown.assistant} size={16} />
        <span className="setup-chip-name">{shown.modelName ?? ASSISTANT_NAMES[shown.assistant]}</span>
        {!narrow && levelName(shown) && <span className="setup-chip-effort">{levelName(shown)}</span>}
        {pinned && (
          <span className="setup-chip-pin">
            <Icon name="pin" size={11} />
          </span>
        )}
        <Icon name="chevronDown" size={10} />
      </button>
      {open && trigger.current && <SetupPopover mode={mode} verb={verb} anchor={trigger.current} close={close} />}
    </>
  );
}

const WIDTH = 336;
const MARGIN = 8;

function SetupPopover({ mode, verb, anchor, close }: { mode: AgentMode; verb: string; anchor: HTMLElement; close: () => void }) {
  const { shown, inUse, pinned } = useShown(mode);
  const recent = useStore(studio.store, (s) => s.agent.recentModels);
  const current = useStore(studio.store, (s) => s.agent.mode);
  const agent = useStore(studio.store, (s) => s.agent);
  const running = useStore(studio.store, (s) => s.settings.assistant);
  const opencode = useStore(studio.store, (s) => s.tools?.opencode);
  const [statuses, setStatuses] = useState<AssistantsSetup | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const label = modeConfig(mode).label;
  // Switching program would stop a conversation at work (as the message box's assistant menu).
  const busy = inUse && studio.assistantBusy;

  // Below the chip if it fits, else above; its right edge at the chip's, inside the window.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const height = box.current?.offsetHeight ?? 0;
    const below = r.bottom + 4 + height <= window.innerHeight - MARGIN || r.top - 4 - height < MARGIN;
    const top = below ? r.bottom + 4 : r.top - 4 - height;
    const left = Math.min(Math.max(MARGIN, r.right - WIDTH), window.innerWidth - WIDTH - MARGIN);
    if (place?.top !== top || place?.left !== left) setPlace({ top, left });
  });

  useEffect(() => {
    // The running one's list fills in lazily; how each would run here changes as programs are installed.
    if (inUse) void studio.loadModels();
    void ipc.assistantsStatus().then(setStatuses, (e) => console.warn('assistants status', e));
    const outside = (e: Event) => !box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node);
    const onDown = (e: MouseEvent) => outside(e) && close();
    // The editor scrolling moves the card away from it.
    const onWheel = (e: WheelEvent) => outside(e) && close();
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('wheel', onWheel, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('resize', close);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const levels = shown.efforts?.filter((o) => o.value !== DEFAULT_EFFORT) ?? [];
  const about = inUse
    ? pinned
      ? `${label} mode’s own, as the chat has now.`
      : 'As the chat has now: a change here is a change there too.'
    : pinned
      ? `${label} mode’s own: the chat changes to it for this.`
      : `Your usual setup: the chat goes back to it for this, from ${modeConfig(current).label} mode’s own.`;
  return createPortal(
    <div
      ref={box}
      className="setup-popover"
      role="dialog"
      aria-label={`What ${verb} runs on`}
      style={{ width: WIDTH, top: place?.top ?? -9999, left: place?.left ?? 0 }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
    >
      <div className="setup-head">
        <span className="setup-title">{verb} with</span>
        <span className="setup-about">{about}</span>
      </div>
      <div className="setup-assistants" role="radiogroup" aria-label="Assistant">
        {ASSISTANTS.map((id) => {
          const now = id === running ? nowOf(id, agent, statuses?.[id], true) : null;
          const status = cardStatus(id, now, statuses?.[id], null, opencode?.version ?? null);
          const locked = busy && id !== shown.assistant;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={id === shown.assistant}
              aria-disabled={locked}
              data-assistant={id}
              className={`setup-assistant${id === shown.assistant ? ' current' : ''}`}
              title={locked ? 'The assistant is working: stop it, or let it finish, to switch' : `${ASSISTANT_NAMES[id]}: ${status.text}`}
              onClick={() => !locked && id !== shown.assistant && void studio.chooseSetup(mode, { assistant: id })}
            >
              <AssistantMark id={id} size={22} />
              <span>{ASSISTANT_NAMES[id]}</span>
            </button>
          );
        })}
      </div>
      <div className="setup-label">Model</div>
      {shown.models.length ? (
        <ModelList compact models={shown.models} current={shown.model} recent={recent} onChoose={(m) => void studio.chooseSetup(mode, { model: m })} onClose={close} />
      ) : (
        <div className="setup-none">{inUse ? 'Loading models…' : `${ASSISTANT_NAMES[shown.assistant]}’s models are listed here once it has run in Foreword. Until then, it uses its own.`}</div>
      )}
      {levels.length > 0 && (
        <>
          <div className="setup-label">Effort</div>
          <div className="setup-efforts" role="radiogroup" aria-label="Effort">
            {shown.efforts!.map((o) => (
              <button key={o.value} role="radio" aria-checked={o.value === shown.effort} className={`setup-effort${o.value === shown.effort ? ' current' : ''}`} title={o.description} onClick={() => void studio.chooseSetup(mode, { effort: o })}>
                <Meter rank={levels.indexOf(o)} of={levels.length} />
                {o.name}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="setup-pin">
        <input type="checkbox" checked={pinned} onChange={() => void studio.pinMode(mode, !pinned)} />
        <span className="setup-pin-text">
          <span className="setup-pin-name">
            <Icon name="pin" size={12} /> Pin to {label} mode
          </span>
          <span className="setup-pin-about">{pinned ? `${label} keeps these whatever the other modes run on.` : `${label} shares your usual setup with every mode not pinned.`}</span>
        </span>
      </label>
    </div>,
    document.body,
  );
}
