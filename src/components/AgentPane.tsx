import { ASSISTANT_NAMES } from '../app/settings';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { composerKeyAction, sendHint } from '../app/settings';
import { pendingQuestion, studio, type QuestionItem } from '../app/studio';
import { setupLine } from '../app/mode-setups';
import { useStore } from '../lib/store';
import appIcon from '../../src-tauri/icons/128x128@2x.png';
import { AGENT_MODES, modeConfig, nextMode } from '../services/agent/modes';
import { answerText, isAnswered, isRecommended, questionKind, questionText, withoutRecommended, type QuestionKind } from '../services/agent/questions';
import { AssistantMenu } from './AssistantMenu';
import { Icon } from './icons';
import { Markdown, MarkdownLine } from './Markdown';
import { EffortPicker } from './EffortPicker';
import { ModelPicker } from './ModelPicker';
import { PermissionsMenu } from './Permissions';
import { ContextMeter, TaskMenu, useContextUse } from './TaskMenu';
import { ActivityGlyph, questionName, TaskStrip, Transcript } from './Trace';
import { parseSlash, slashMatches, slashToken, withoutSlash } from '../app/slash';
import { actionLine, STARTERS, stockAction } from '../app/stock-prompts';
import type { SourceSelection } from '../editor/selection';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

type Field = QuestionItem['fields'][number];
type Value = string | number | boolean | string[];

const KEY_HINT: Record<QuestionKind, string> = {
  choice: '1–9 to choose',
  multi: '1–9 or space to tick · ⏎ next',
  yesno: 'Y or N',
  text: '⏎ next · ⇧⏎ new line',
  number: '⏎ next',
  link: '',
};

/**
 * The assistant's questions, in the composer's place, one at a time (as in
 * Claude Code): choices with numbered keys, several choices with checkboxes,
 * yes or no, or your own words; every choice question has Other for an answer
 * of your own. Several questions have tabs and end on a review of the
 * answers. A single choice answers at once. Skip (esc) tells the assistant
 * you didn't answer.
 */
function QuestionPanel({ item }: { item: QuestionItem }) {
  const running = useStore(studio.store, (s) => s.agent.running);
  const questions = useMemo(() => item.fields.filter((f) => f.type !== 'external'), [item.fields]);
  const links = item.fields.filter((f) => f.type === 'external' && f.url);
  const n = questions.length;
  // Several questions end on a review (step n).
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, Value>>({});
  /** Your own answer to each question, and whether it's the one chosen (ticked, for several). */
  const [own, setOwn] = useState<Record<string, string>>({});
  const [ownOn, setOwnOn] = useState<Record<string, boolean>>({});
  /** The option being looked at (focus or hover), for its preview. */
  const [peek, setPeek] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const busy = item.state === 'sending';
  const field = step < n ? questions[step] : null;

  const answerOf = (f: Field, vals = values, mine = own, on = ownOn): Value | undefined => {
    const kind = questionKind(f);
    const text = (mine[f.key] ?? '').trim();
    if (kind === 'multi') return [...((vals[f.key] as string[] | undefined) ?? []), ...(on[f.key] && text ? [text] : [])];
    if ((kind === 'choice' || kind === 'yesno') && on[f.key]) return text;
    const v = vals[f.key];
    return typeof v === 'string' ? v.trim() : v;
  };
  const answered = (f: Field) => isAnswered(answerOf(f));
  const ready = questions.every((f) => !f.required || answered(f));

  const submit = (vals = values, mine = own, on = ownOn) => {
    if (busy || !questions.every((f) => !f.required || isAnswered(answerOf(f, vals, mine, on)))) return;
    const answer: Record<string, Value> = {};
    for (const f of questions) {
      const v = answerOf(f, vals, mine, on);
      if (isAnswered(v)) answer[f.key] = v!;
    }
    void studio.answerQuestion(item.id, answer);
  };
  /** On from this question: the next one, the review, or (just one question) answer. */
  const next = (vals = values, mine = own, on = ownOn) => {
    if (n === 1) submit(vals, mine, on);
    else setStep((s) => Math.min(s + 1, n));
  };
  const choose = (f: Field, v: string | boolean) => {
    const vals = { ...values, [f.key]: v };
    const on = { ...ownOn, [f.key]: false };
    setValues(vals);
    setOwnOn(on);
    next(vals, own, on);
  };
  const toggle = (f: Field, v: string) =>
    setValues((vals) => {
      const now = (vals[f.key] as string[] | undefined) ?? [];
      return { ...vals, [f.key]: now.includes(v) ? now.filter((x) => x !== v) : [...now, v] };
    });
  const typeOwn = (f: Field, text: string) => {
    setOwn({ ...own, [f.key]: text });
    // Typed, it's the answer (or, for several, ticked); emptied, the options are again.
    setOwnOn({ ...ownOn, [f.key]: text.trim() !== '' });
  };

  // The keyboard comes here when you're in the chat (not when you're writing in the editor):
  // to the answer chosen so far, or the first thing to answer with.
  const focusStep = () => {
    const el = ref.current;
    if (!el) return;
    const own = field && ownOn[field.key] ? '.ask-own-input' : null;
    for (const selector of [own, 'button.ask-choice[aria-checked="true"]', '.ask-text', '.ask-number', 'button.ask-choice', '.ask-submit']) {
      const target = selector && el.querySelector<HTMLElement>(selector);
      if (target) return target.focus();
    }
  };
  useLayoutEffect(() => {
    const el = ref.current;
    const active = document.activeElement;
    const inChat = !active || active === document.body || !!active.closest('.agent-pane');
    if (el && (inChat || el.contains(active))) focusStep();
    setPeek(null);
  }, [step]);
  // Gone (answered or skipped) with the keyboard: the message box has it again.
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) studio.events.emit('focus-composer');
      });
    },
    [],
  );

  const choices = () => [...(ref.current?.querySelectorAll<HTMLElement>('.ask-step button.ask-choice, .ask-step .ask-own-input') ?? [])];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (busy || e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      // Out of what you're typing first; then skip.
      if (typing && (e.target as HTMLInputElement).value) (choices().find((c) => c !== e.target) ?? ref.current)?.focus();
      else void studio.dismissQuestion(item.id);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (e.target instanceof HTMLTextAreaElement) return;
      const list = choices();
      const at = list.indexOf(e.target as HTMLElement);
      if (at < 0 && !list.length) return;
      e.preventDefault();
      list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      return;
    }
    if (typing) {
      if (e.key === 'Enter' && !e.shiftKey && field) {
        e.preventDefault();
        if (answered(field) || !field.required) next();
      }
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && n > 1) {
      e.preventDefault();
      setStep((s) => Math.max(0, Math.min(n, s + (e.key === 'ArrowRight' ? 1 : -1))));
      return;
    }
    if (!field) {
      if (e.key === 'Enter' && ready && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        submit();
      }
      return;
    }
    const kind = questionKind(field);
    if (kind === 'multi' && e.key === 'Enter' && (e.target === ref.current || (e.target as HTMLElement).classList.contains('ask-choice'))) {
      // Ticking is a click (or space); ⏎ moves on.
      e.preventDefault();
      if (answered(field) || !field.required) next();
      return;
    }
    const options = kind === 'yesno' ? [true, false] : (field.options ?? []).map((o) => o.value);
    const key = e.key.toLowerCase();
    const index = kind === 'yesno' && (key === 'y' || key === 'n') ? (key === 'y' ? 0 : 1) : /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
    if (index >= 0 && index < options.length) {
      e.preventDefault();
      if (kind === 'multi') toggle(field, options[index] as string);
      else choose(field, options[index]);
    } else if (index === options.length && field.custom) {
      // The number after the options: your own answer.
      e.preventDefault();
      ref.current?.querySelector<HTMLInputElement>('.ask-own-input')?.focus();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && (answered(field) || !field.required) && kind !== 'choice' && kind !== 'yesno') {
      e.preventDefault();
      next();
    }
  };

  const kind = field ? questionKind(field) : null;
  const preview = field?.options?.find((o) => o.value === (peek ?? (values[field.key] as string)))?.preview;
  const last = step >= n - 1;
  const hint = busy ? 'Sending…' : `${kind ? KEY_HINT[kind] : '⏎ submit'}${n > 1 ? ' · ←→ questions' : ''} · esc skip`;
  return (
    <div className={`ask-panel${busy ? ' busy' : ''}`} ref={ref} role="dialog" aria-label="The assistant asks" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="ask-top">
        <span className="ask-title">
          <Icon name="help" size={14} />
          {n > 1 ? `The assistant has ${n} questions` : 'The assistant asks'}
        </span>
        {n > 1 && (
          <div className="ask-tabs" role="tablist">
            {questions.map((f, i) => (
              <button key={f.key} role="tab" aria-selected={step === i} className={`ask-tab${step === i ? ' current' : ''}${answered(f) ? ' done' : ''}`} title={questionText(f)} tabIndex={-1} onClick={() => setStep(i)}>
                <span className="ask-tab-mark" aria-hidden>
                  {answered(f) ? '✓' : i + 1}
                </span>
                {questionName(f)}
              </button>
            ))}
            <button role="tab" aria-selected={step === n} className={`ask-tab review${step === n ? ' current' : ''}`} tabIndex={-1} onClick={() => setStep(n)}>
              Review
            </button>
          </div>
        )}
      </div>

      {field && kind ? (
        <div className="ask-step" key={field.key}>
          <div className="ask-question md">
            <Markdown text={questionText(field)} />
          </div>
          {(kind === 'choice' || kind === 'multi' || kind === 'yesno') && (
            <div className="ask-choices" role={kind === 'multi' ? 'group' : 'radiogroup'} aria-label={questionText(field)}>
              {(kind === 'yesno' ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] : (field.options ?? [])).map((o, i) => {
                const picked = kind === 'multi' ? ((values[field.key] as string[] | undefined) ?? []).includes(o.value as string) : !ownOn[field.key] && values[field.key] === o.value;
                const label = String(o.label);
                const description = 'description' in o ? o.description : undefined;
                return (
                  <button
                    key={String(o.value)}
                    type="button"
                    role={kind === 'multi' ? 'checkbox' : 'radio'}
                    aria-checked={picked}
                    className={`ask-choice${picked ? ' picked' : ''}`}
                    disabled={busy}
                    onFocus={() => setPeek(typeof o.value === 'string' ? o.value : null)}
                    onMouseEnter={() => setPeek(typeof o.value === 'string' ? o.value : null)}
                    onClick={() => (kind === 'multi' ? toggle(field, o.value as string) : choose(field, o.value))}
                  >
                    <span className={`ask-key${kind === 'multi' ? ' box' : ''}`} aria-hidden>
                      {kind === 'multi' ? picked ? <Icon name="check" size={11} /> : '' : kind === 'yesno' ? (o.value ? 'Y' : 'N') : i + 1}
                    </span>
                    <span className="ask-choice-body">
                      <span className="ask-label">
                        <span>
                          <MarkdownLine text={withoutRecommended(label)} />
                        </span>
                        {isRecommended(label) && <span className="ask-badge">Recommended</span>}
                      </span>
                      {description && (
                        <span className="ask-desc md">
                          <MarkdownLine text={description} />
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
              {field.custom && (
                <label className={`ask-choice ask-own${ownOn[field.key] ? ' picked' : ''}`} onMouseEnter={() => setPeek(null)}>
                  <span
                    className={`ask-key${kind === 'multi' ? ' box' : ''}`}
                    aria-hidden
                    onClick={(e) => {
                      // The box ticks your own answer in or out (for several).
                      if (kind !== 'multi') return;
                      e.preventDefault();
                      setOwnOn({ ...ownOn, [field.key]: !ownOn[field.key] });
                    }}
                  >
                    {kind === 'multi' ? ownOn[field.key] ? <Icon name="check" size={11} /> : '' : kind === 'yesno' ? '…' : (field.options?.length ?? 0) + 1}
                  </span>
                  <input
                    className="ask-own-input"
                    value={own[field.key] ?? ''}
                    placeholder={kind === 'multi' ? 'Something else (type it)…' : 'Other: type your own answer…'}
                    aria-label="Your own answer"
                    disabled={busy}
                    onFocus={() => setPeek(null)}
                    onChange={(e) => typeOwn(field, e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
          {kind === 'text' && (
            <textarea
              className="ask-text"
              rows={2}
              value={(values[field.key] as string | undefined) ?? ''}
              placeholder={field.placeholder ?? 'Your answer…'}
              disabled={busy}
              onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            />
          )}
          {kind === 'number' && (
            <input
              className="ask-number"
              type="number"
              value={values[field.key] === undefined ? '' : String(values[field.key])}
              placeholder={field.placeholder ?? 'A number…'}
              disabled={busy}
              onChange={(e) => setValues({ ...values, [field.key]: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          )}
          {preview && <pre className="ask-preview">{preview}</pre>}
        </div>
      ) : (
        <div className="ask-review" role="list" aria-label="Your answers">
          {questions.map((f, i) => (
            <button key={f.key} type="button" role="listitem" className="ask-review-row" title="Change this answer" onClick={() => setStep(i)}>
              <span className="ask-review-q">{questionText(f)}</span>
              <span className={`ask-review-a${answered(f) ? '' : ' none'}`}>{answered(f) ? <MarkdownLine text={answerText(f, answerOf(f))} /> : f.required ? 'Needs an answer' : 'Not answered'}</span>
            </button>
          ))}
        </div>
      )}

      {links.map((f) => (
        <button key={f.key} type="button" className="link" onClick={() => void studio.openPrinterPage(f.url!)}>
          Open {f.url}
        </button>
      ))}

      <div className="ask-actions">
        <span className="ask-hint" title={hint}>
          {hint}
        </span>
        {running && item.via !== 'message' && (
          <button type="button" className="ask-stop" title="Stop the assistant now" disabled={busy} onClick={() => void studio.cancel()}>
            Stop
          </button>
        )}
        <button type="button" disabled={busy} title="Don't answer: the assistant carries on without your answers (esc)" onClick={() => void studio.dismissQuestion(item.id)}>
          Skip
        </button>
        {n > 1 && step > 0 && (
          <button type="button" disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {field && n > 1 ? (
          <button type="button" className="primary ask-submit" disabled={busy || (!!field.required && !answered(field))} onClick={() => next()}>
            {last ? 'Review' : 'Next'}
          </button>
        ) : (
          <button type="button" className="primary ask-submit" disabled={busy || !ready || (n === 1 && !questions.some(answered))} onClick={() => submit()}>
            {busy ? 'Sending…' : n > 1 ? 'Submit answers' : 'Submit'}
          </button>
        )}
      </div>
    </div>
  );
}

/** The mode menu: compact trigger, opens upward with a description per mode, and what each runs on. ⇧Tab cycles. */
function ModeMenu() {
  const mode = useStore(studio.store, (s) => s.agent.mode);
  const running = useStore(studio.store, (s) => s.agent.running);
  const setups = useStore(studio.store, (s) => s.agent.modeSetups);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = modeConfig(mode);

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
    <div className="mode-menu" ref={rootRef}>
      <button
        className={`mode-trigger mode-${mode}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mode: ${current.label}`}
        disabled={running}
        title={`${current.description} (⇧Tab to switch)`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mode-icon">{current.icon}</span>
        {current.label}
      </button>
      {open && (
        <div className="mode-popover" role="menu">
          {AGENT_MODES.map((m) => {
            const c = modeConfig(m);
            const setup = setups[m];
            return (
              <button
                key={m}
                role="menuitemradio"
                aria-checked={m === mode}
                className={`mode-option${m === mode ? ' current' : ''}`}
                onClick={() => {
                  setOpen(false);
                  void studio.setMode(m);
                }}
              >
                <span className="mode-icon">{c.icon}</span>
                <span className="mode-text">
                  <span className="mode-name">{c.label}</span>
                  <span className="mode-description">{c.description}</span>
                  {setup && <span className="mode-setup">{setupLine(setup)}</span>}
                </span>
                <span className="model-check">{m === mode ? '✓' : ''}</span>
              </button>
            );
          })}
          <div className="model-footer">
            <span className="muted">⇧Tab in the message box switches mode. Each mode keeps the assistant, model and effort last used in it.</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown in Ask and Discuss once the agent has replied: switch to Write and make what was agreed. */
function CarryOutActions() {
  const mode = useStore(studio.store, (s) => s.agent.mode);
  const replied = useStore(studio.store, (s) => !s.agent.running && s.agent.items.some((i) => i.kind === 'assistant'));
  // The assistant offered another mode for this: its two ways on are the choice.
  const offered = useStore(studio.store, (s) => {
    const last = s.agent.items.findLast((i) => i.kind === 'assistant' || i.kind === 'user');
    return last?.kind === 'assistant' && last.modeSuggestion?.state === 'pending';
  });
  const carry = modeConfig(mode).carryOut;
  if (!carry || !replied || offered) return null;
  return (
    <div className="carry-out-actions">
      <span className="muted">{carry.question}</span>
      <button className="primary" onClick={() => void studio.carryOut()}>
        {carry.label}
      </button>
    </div>
  );
}

/**
 * A passage that goes with the next message: the live selection (it follows the
 * editor's), or one kept with ⌘I or Keep. Where it's from, and the start of it;
 * click the text to see all of it, the place to go there.
 */
function ContextCard({ selection, live, fromPreview, onKeep, onRemove }: { selection: SourceSelection; live: boolean; fromPreview?: boolean; onKeep?: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const title = useStore(studio.store, (s) => s.names.titles[selection.relativePath]);
  const { relativePath: path, start, end, selectedText } = selection;
  const lines = !selectedText ? `line ${start.line}, column ${start.column}` : start.line === end.line ? `line ${start.line}` : `lines ${start.line}–${end.line}`;
  const excerpt = selectedText.replace(/\s+/g, ' ').trim();
  return (
    <div className={`context-card${live ? ' live' : ' kept'}${open ? ' open' : ''}`}>
      <div className="context-head">
        {!live && (
          <span className="context-pin" title="Kept with the chat">
            <Icon name="pin" size={12} />
          </span>
        )}
        <button className="context-where" title={`${path}, ${lines}: go there`} onClick={() => void studio.revealSelection(selection)}>
          {title ?? basename(path)}
          <span className="context-lines"> · {lines}</span>
        </button>
        {fromPreview && <span className="context-tag">from the preview</span>}
        <span className="spacer" />
        {onKeep && (
          <button className="context-action" title="Keep it with the chat after you select something else" onClick={onKeep}>
            <Icon name="pin" size={12} />
            Keep
          </button>
        )}
        <button className="context-action chip-remove" aria-label={live ? 'Leave the selection out' : `Remove ${path}, ${lines}`} title={live ? 'Leave it out of the next message' : 'Remove'} onClick={onRemove}>
          <Icon name="close" size={11} />
        </button>
      </div>
      {excerpt ? (
        <button className="context-text" aria-expanded={open} title={open ? 'Show less' : 'Show all of it'} onClick={() => setOpen((o) => !o)}>
          {open ? selectedText.replace(/\n$/, '') : excerpt}
        </button>
      ) : (
        <div className="context-text empty">Where the cursor is (no text selected).</div>
      )}
    </div>
  );
}

/**
 * The task's buttons, on the message box, where you look after a reply: Done, New task,
 * and how full the conversation is. They stay put (Done greys out while it works), and
 * New task turns blue once the conversation is long enough to slow the assistant down.
 */
function TaskBar() {
  const blank = useStore(studio.store, (s) => !s.agent.taskId && !s.agent.items.length);
  const running = useStore(studio.store, (s) => s.agent.running);
  const replied = useStore(studio.store, (s) => s.agent.items.some((i) => i.kind === 'assistant'));
  const done = useStore(studio.store, (s) => s.agent.tasks.find((t) => t.id === s.agent.taskId)?.status === 'done');
  const long = useContextUse().tone !== '';
  // A blank conversation already is a new task, with nothing to finish.
  if (blank) return null;
  const doneTitle = done
    ? 'This task is done already'
    : running
      ? 'Done, once this turn ends'
      : !replied
        ? 'Done, once the assistant has replied'
        : "This task is done: it's saved as a named version in History, and a new task starts (⇧⌘D)";
  return (
    <div className="task-bar">
      <button className="task-bar-button done" disabled={done || running || !replied} title={doneTitle} onClick={() => void studio.finishTask()}>
        <Icon name="check" size={14} />
        Done
      </button>
      <button
        className={`task-bar-button new-task${long ? ' hot' : ''}`}
        title={running ? 'Start a new task: this one carries on in the background (⌘T)' : 'Start a new task: this one stays in your list (⌘T)'}
        onClick={() => studio.newTask()}
      >
        <Icon name="plus" size={14} />
        New task
      </button>
      {/* From the right: the meter, then the hint, which drops out when the pane is too narrow for it. */}
      <div className="task-bar-end">
        <ContextMeter />
        {long && <span className="task-bar-hint">Long chats get slower</span>}
      </div>
    </div>
  );
}

function Composer() {
  const attachments = useStore(studio.store, (s) => s.agent.attachments);
  const running = useStore(studio.store, (s) => s.agent.running);
  const mode = useStore(studio.store, (s) => s.agent.mode);
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready');
  const sendKey = useStore(studio.store, (s) => s.settings.sendKey);
  const live = useStore(studio.store, (s) => s.agent.selection);
  useStore(studio.store, (s) => s.agent.selectionDismissed);
  const liveShown = !!live && studio.isSelectionIncluded() && !attachments.some((a) => a.label === live.attachment.label);
  const [text, setTextState] = useState(() => studio.composerDraft);
  // Where the caret is: the "/…" list is for the word being typed there.
  const [caret, setCaret] = useState(text.length);
  const caretAfter = useRef<number | null>(null);
  const typed = (t: string, at: number) => {
    studio.composerDraft = t;
    setTextState(t);
    setCaret(at);
  };
  // Set from here (not typed): the caret is put where it belongs once the box has the text.
  const setText = (t: string, at = t.length) => {
    typed(t, at);
    caretAfter.current = at;
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => studio.events.on('focus-composer', () => inputRef.current?.focus()), []);
  useEffect(
    () =>
      studio.events.on('fill-composer', (t) => {
        setText(t);
        requestAnimationFrame(() => inputRef.current?.focus());
      }),
    [],
  );

  const stopped = useStore(studio.store, (s) => s.agent.stopped && !!s.agent.sessionId);
  // An empty box after a stop: Send (and ⏎) resume instead.
  const canResume = stopped && !running && !text.trim();
  // "/…" (at the start, or after a space mid-message): the list of commands, until a space (or Esc).
  const token = slashToken(text, caret);
  const matches = slashMatches(text, caret);
  const [highlight, setHighlight] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
  const showSlash = matches.length > 0 && slashDismissed !== text;
  useEffect(() => setHighlight(0), [text, caret]);
  const pickSlash = (name: string) => {
    const cmd = matches.find((c) => c.name === name);
    if (!cmd || !token) return;
    if (cmd.immediate) {
      // Picked mid-message, it runs and the rest of the message stays.
      const rest = withoutSlash(text, token);
      setText(rest.text, rest.caret);
      void studio.runSlash(`/${cmd.name}`);
    } else setText(`/${cmd.name} `);
    inputRef.current?.focus();
  };
  const send = async (delivery: 'queue' | 'steer' = 'queue') => {
    const message = text;
    if (!message.trim()) {
      if (canResume) void studio.resume();
      return;
    }
    // A command acts on the app; it isn't sent.
    if (message.trim().startsWith('/') && parseSlash(message)) {
      setText('');
      await studio.runSlash(message);
      return;
    }
    // Cleared at once (it feels instant); put back if it couldn't be sent.
    setText('');
    if (!(await studio.send(message, { delivery }))) setText(message);
  };
  // The box grows with what's typed, up to a cap (then it scrolls).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (caretAfter.current !== null) {
      el.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
  }, [text]);
  // The keys live in the buttons' tooltips, not in a line of help under the box.
  const keys = sendHint(sendKey);
  const queueKeys = `${keys.split(' · ')[0].replace('send', 'queue')} · ⌥⏎ send now`;

  return (
    <div className="composer">
      <TaskBar />
      <QueuedMessages />
      <CarryOutActions />
      {(attachments.length > 0 || liveShown) && (
        <div className="context-cards">
          {attachments.map((a) => (
            <ContextCard key={a.id} selection={a.selection} live={false} onRemove={() => studio.removeAttachment(a.id)} />
          ))}
          {liveShown && live && (
            <ContextCard
              key={live.attachment.label}
              selection={live.attachment.selection}
              live
              fromPreview={live.from === 'preview'}
              onKeep={() => studio.keepSelection()}
              onRemove={() => studio.dismissSelection()}
            />
          )}
        </div>
      )}
      {showSlash && (
        <div className="slash-menu" role="listbox" aria-label="Commands">
          {matches.map((c, i) => (
            <button
              key={c.name}
              role="option"
              aria-selected={i === highlight}
              className={i === highlight ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pickSlash(c.name)}
            >
              <span className="slash-name">
                /{c.name}
                {c.arg && <span className="slash-arg"> {c.arg}</span>}
              </span>
              <span className="slash-desc">{c.description}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className="composer-box"
        onMouseDown={(e) => {
          // A click in the box's empty space (not on a control) is a click in the text.
          const t = e.target as HTMLElement;
          if (t === e.currentTarget || t.classList.contains('composer-controls') || t.classList.contains('spacer')) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <textarea
          ref={inputRef}
          value={text}
          rows={2}
          placeholder={ready ? modeConfig(mode).placeholder : 'Agent not available'}
          onChange={(e) => {
            caretAfter.current = null;
            typed(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (showSlash) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
                return;
              }
              if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
                e.preventDefault();
                pickSlash(matches[Math.min(highlight, matches.length - 1)].name);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setSlashDismissed(text);
                return;
              }
            }
            const action = composerKeyAction({ ...e, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, sendKey);
            if (action) {
              e.preventDefault();
              void send(action === 'send-now' ? 'steer' : 'queue');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              studio.events.emit('focus-editor');
            } else if (e.key === 'Tab' && e.shiftKey && !running) {
              e.preventDefault();
              void studio.setMode(nextMode(mode));
            }
          }}
        />
        <div className="composer-controls">
          <ModeMenu />
          <AssistantMenu />
          <ModelPicker placement="up" />
          <EffortPicker />
          <PermissionsMenu />
          <span className="spacer" />
          {!text && (
            <button
              className="composer-slash"
              aria-label="Commands"
              title="Commands (type /)"
              onClick={() => {
                setText('/');
                inputRef.current?.focus();
              }}
            >
              /
            </button>
          )}
          {running ? (
            <>
              <button className="send-button stop" aria-label="Stop" title="Stop the assistant now" onClick={() => void studio.cancel()}>
                <Icon name="stop" size={14} />
              </button>
              {text.trim() && (
                <button className="send-button primary" aria-label="Queue" title={`Queue: sent when the assistant finishes · ${queueKeys}`} onClick={() => void send('queue')}>
                  <Icon name="arrowUp" size={15} />
                </button>
              )}
            </>
          ) : canResume ? (
            <button className="send-button primary resume" disabled={!ready} title="Carry on where it stopped, with the model chosen now (⏎)" onClick={() => void send()}>
              Resume
            </button>
          ) : (
            <button className="send-button primary" aria-label="Send" disabled={!ready || !text.trim()} title={`Send · ${keys}`} onClick={() => void send()}>
              <Icon name="arrowUp" size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Messages sent while the assistant works: waiting for it, or for its next step. */
function QueuedMessages() {
  const queued = useStore(studio.store, (s) => s.agent.queued);
  if (!queued.length) return null;
  return (
    <div className="queued" aria-label="Queued messages">
      {queued.map((q) => {
        // A button's request shows as what it asks for, and there's nothing of the author's to edit.
        const action = stockAction(q.text);
        const words = action ? actionLine(action) : q.text;
        return (
          <div key={q.id} className={`queued-item ${q.delivery}`}>
            <span className="queued-state">{q.sending ? 'Sending…' : q.delivery === 'steer' ? 'Next step' : 'Queued'}</span>
            <span className="queued-text" title={words}>
              {words}
            </span>
            {!q.sending && q.delivery === 'queue' && (
              <button className="small" title="The assistant reads it at its next step, without waiting for the end" onClick={() => void studio.steerQueued(q.id)}>
                Send now
              </button>
            )}
            {!q.sending && (
              <>
                {!action && (
                  <button className="small" title="Take it back to change it" onClick={() => void studio.unqueue(q.id, { edit: true })}>
                    Edit
                  </button>
                )}
                <button className="icon" aria-label="Don't send" title="Don't send" onClick={() => void studio.unqueue(q.id)}>
                  ✕
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Fewer words than this in the book: the interview, not the draft, is the style bar's first choice. */
const STYLE_INTERVIEW_BELOW_WORDS = 1500;

/** This conversation is drafting the style guide: say so, rather than offering to start it. */
const useDraftingHere = () => useStore(studio.store, (s) => s.styleGuide.drafting !== null && (s.styleGuide.drafting === '' || s.styleGuide.drafting === s.agent.sessionId));

/** The offer of a style guide, until there's one: before the first message, a card in the starter; after, a bar under the header. */
function StyleGuideBar({ empty }: { empty: boolean }) {
  const guide = useStore(studio.store, (s) => s.styleGuide);
  const drafting = useDraftingHere();
  if (drafting) {
    return (
      <div className="style-bar drafting">
        <ActivityGlyph phase="thinking" />
        <span>
          {guide.draftKind === 'revise' ? (
            <strong>Revising your style guide.</strong>
          ) : guide.draftKind === 'interview' ? (
            <>
              <strong>Writing your style guide with you:</strong> answer the questions below.
            </>
          ) : (
            <>
              <strong>{guide.draftKind === 'redraft' ? 'Redrafting' : 'Drafting'} your style guide</strong> from the chapters.
            </>
          )}{' '}
          {guide.draftKind === 'revise' ? 'It opens in the editor when it’s changed.' : 'It opens in the editor when it’s written.'}
        </span>
      </div>
    );
  }
  // The guide, once there is one, is in the strip under the header (TaskStrip).
  if (guide.exists || guide.dismissed || empty) return null;
  return <StyleGuideSetup />;
}

/** Draft it from the chapters, an interview, or a template; the likelier one first (in the card, the only button). */
function StyleGuideSetup({ card }: { card?: boolean }) {
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready' && !s.agent.running);
  // Little written yet: a draft from the chapters has little to go on, so the interview comes first.
  const fewWords = useStore(studio.store, (s) => (s.compile.words ?? 0) < STYLE_INTERVIEW_BELOW_WORDS);
  const draft = (
    <button
      key="draft"
      className={fewWords ? (card ? 'link' : '') : 'primary'}
      disabled={!ready}
      title="The assistant reads your chapters and writes WRITING_STYLE.md from how the book is written"
      onClick={() => void studio.draftStyleGuide()}
    >
      Draft from my chapters
    </button>
  );
  const interview = (
    <button
      key="interview"
      className={`style-interview${fewWords ? ' primary' : card ? ' link' : ''}`}
      disabled={!ready}
      title="The assistant asks you a few rounds of questions about the book (answers to pick from), then writes WRITING_STYLE.md from your answers"
      onClick={() => void studio.interviewStyleGuide()}
    >
      Interview me
    </button>
  );
  return (
    <div className={`style-bar setup${card ? ' card' : ''}`}>
      {card ? (
        <div className="style-card-head">
          <span className="style-card-mark" aria-hidden>
            Aa
          </span>
          <div className="style-card-words">
            <strong>Teach it your voice</strong>
            <span>A short style guide (voice, tone, terminology) keeps every edit sounding like your book.</span>
          </div>
        </div>
      ) : (
        <div>
          <strong>No writing style guide yet.</strong> A short guide (voice, tone, terminology, formatting) keeps every edit sounding like your book.
        </div>
      )}
      <div className="style-actions">
        {fewWords ? [interview, draft] : [draft, interview]}
        <button className={card ? 'link' : ''} title="Pick one made for your kind of book (a novel, a textbook, a picture book…), then change it" onClick={() => studio.openStyleTemplates()}>
          Start from a template
        </button>
        <button className="link quiet" onClick={() => studio.dismissStyleGuidePrompt()}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** One of these under the starter, a different one each new task. */
const TIPS: ReactNode[] = [
  <>
    Select some text and press <kbd>⌘</kbd>
    <kbd>I</kbd> to ask about it.
  </>,
  <>
    <kbd>⇧</kbd>
    <kbd>Tab</kbd> switches mode. <strong>Discuss</strong> thinks a direction through with you before anything is written.
  </>,
  <>
    <strong>Options</strong> writes three versions of a passage for you to pick from.
  </>,
  <>
    Type <kbd>/</kbd> in the message box for commands.
  </>,
  <>
    New to Typst?{' '}
    <button className="link" onClick={() => studio.openGuide()}>
      Typst basics
    </button>
  </>,
];

const greeting = (hour: number) => (hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening');

/** Shown before the first message: a welcome under Foreword's icon and name, things to ask (your TODOs first), the style guide's offer, and a tip. */
function Starter() {
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready');
  const todos = useStore(studio.store, (s) => s.todos);
  const titles = useStore(studio.store, (s) => s.names.titles);
  const offerGuide = useStore(studio.store, (s) => !s.styleGuide.exists && !s.styleGuide.dismissed);
  const drafting = useDraftingHere();
  const [hello] = useState(() => greeting(new Date().getHours()));
  const [tip] = useState(() => Math.floor(Math.random() * TIPS.length));
  return (
    <div className="starter">
      <div className="starter-hero">
        <span className="starter-emblem" aria-hidden>
          <img src={appIcon} alt="" width={60} height={60} />
        </span>
        <span className="starter-wordmark">Foreword</span>
        <h3>{hello}</h3>
        <p>What shall we work on? Every change it makes is marked in your text, and can be undone.</p>
      </div>
      {todos.length > 0 && (
        <div className="starter-group">
          <div className="starter-label">From your TODOs</div>
          {todos.slice(0, 3).map((t) => (
            <button key={`${t.path}:${t.line}`} className="suggestion todo tone-todo" disabled={!ready} title="Ask the assistant to do this now" onClick={() => void studio.askTodo(t)}>
              <span className="suggestion-icon">
                <Icon name="todos" size={13} />
              </span>
              <span className="suggestion-text">
                {t.text}
                <span className="suggestion-where">
                  {titles[t.path] ?? basename(t.path)} · line {t.line}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="starter-group">
        <div className="starter-label">Try asking</div>
        {STARTERS.map((s) => (
          <button key={s.label} className={`suggestion tone-${s.tone}`} disabled={!ready} title="Ask the assistant" onClick={() => void studio.send(s.prompt)}>
            <span className="suggestion-icon">
              <Icon name={s.icon} size={13} />
            </span>
            <span className="suggestion-text">{s.label}</span>
            <span className="suggestion-go">
              <Icon name="arrowUp" size={12} />
            </span>
          </button>
        ))}
      </div>
      {offerGuide && !drafting && <StyleGuideSetup card />}
      <p className="starter-tip">
        <Icon name="bulb" size={12} />
        <span>{TIPS[tip]}</span>
      </p>
    </div>
  );
}

export function AgentPane() {
  const assistantName = useStore(studio.store, (s) => ASSISTANT_NAMES[s.settings.assistant]);
  const agent = useStore(studio.store, (s) => s.agent);
  const asking = pendingQuestion(agent);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    // The newest at the bottom in view; with nothing yet, the starter from its top.
    if (el && stick.current) el.scrollTop = agent.items.length ? el.scrollHeight : 0;
  }, [agent.items, agent.activity]);

  return (
    <section className="pane agent-pane">
      <div className="agent-body">
        <header className="pane-header">
          <TaskMenu />
          {agent.running && <span className="busy-bar" aria-hidden />}
          <span className="spacer" />
          <button
            className="icon pane-action agent-settings"
            aria-label="Assistant settings"
            title={`Assistant settings: which assistant (${assistantName}), its model and its account`}
            onClick={() => studio.openSettings('assistant')}
          >
            <Icon name="settings" size={15} />
          </button>
        </header>
        {(agent.status !== 'ready' || agent.connection === 'lost') && (
          <div className="agent-status">
            {agent.status === 'starting' &&
              (agent.signingIn ? (
                `Sign in with Google, in your browser, to start ${assistantName}…`
              ) : (
                <>
                  <ActivityGlyph phase="starting" />
                  <span className="shimmer">Starting {assistantName}…</span>
                </>
              ))}
            {agent.status === 'off' && 'The assistant is off.'}
            {agent.status === 'error' && (
              // Signed out, Settings says how to sign in (Sign in…).
              <span className="bad" title={agent.signedOut ? agent.error : undefined}>
                {agent.signedOut ? `${assistantName} isn’t signed in.` : `${assistantName}: ${agent.error}`}
              </span>
            )}
            {agent.status === 'ready' && agent.connection === 'lost' && <span className="bad">Reconnecting to the assistant…</span>}
            <span className="spacer" />
            {agent.status === 'error' && agent.signedOut && (
              <button className="link" onClick={() => studio.openSettings('assistant')}>
                Sign in…
              </button>
            )}
            {agent.status === 'error' && (
              <button className="link" onClick={() => void studio.startAgent()}>
                Retry
              </button>
            )}
          </div>
        )}
        <StyleGuideBar empty={agent.items.length === 0} />
        <TaskStrip />
        <div
          className="transcript"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {agent.items.length === 0 && <Starter />}
          <Transcript key={agent.taskId ?? 'new'} />
        </div>
        {/* The assistant's questions take the message box's place until they're answered or skipped. */}
        {asking ? (
          <div className="composer asking">
            <QueuedMessages />
            <QuestionPanel key={asking.id} item={asking} />
          </div>
        ) : (
          <Composer />
        )}
      </div>
    </section>
  );
}
