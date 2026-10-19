import { activityWords, clockTime, stepTimes, thinkingSoFar, thoughtHeading, waitedPrefix, waitingTip, workerName } from '../app/activity';
import { ASSISTANT_NAMES } from '../app/settings';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { composerKeyAction, sendHint } from '../app/settings';
import { pendingQuestion, studio, type Activity, type ChatItem, type QuestionItem } from '../app/studio';
import { onContextMenu } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { AGENT_MODES, modeConfig, nextMode } from '../services/agent/modes';
import { parseOptions } from '../services/agent/options-mode';
import { answerText, isAnswered, isRecommended, questionKind, questionText, splitQuestions, withoutRecommended, type QuestionKind } from '../services/agent/questions';
import { AssistantMenu } from './AssistantMenu';
import { Icon } from './icons';
import { Markdown, MarkdownLine } from './Markdown';
import { EffortPicker } from './EffortPicker';
import { ModelPicker } from './ModelPicker';
import { PermissionsMenu } from './Permissions';
import { ContextMeter, TaskMenu } from './TaskMenu';
import { withoutMarker } from '../app/tasks';
import { withoutAddressed } from '../app/review';
import { describePermission, describeTool } from '../app/tool-labels';
import { parseSlash, slashMatches } from '../app/slash';
import type { SourceSelection } from '../editor/selection';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function Patch({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => !l.startsWith('Index:') && !/^={5,}/.test(l));
  return (
    <pre className="patch">
      {lines.map((l, i) => (
        <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : ''}>
          {l || ' '}
        </div>
      ))}
    </pre>
  );
}

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>;

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(
    () => studio.toast('Copied'),
    (e) => studio.toast(`Couldn't copy: ${e}`, 'error'),
  );
}

/** Options-mode reply: one card per option; picking one replaces the passage in the editor. */
function OptionsReply({ item }: { item: AssistantItem }) {
  const parsed = useMemo(() => parseOptions(item.text), [item.text]);
  const { target, applied } = item.options!;
  if (!parsed.options.some((o) => o.text != null)) {
    return (
      <div className={`msg assistant md${item.done ? '' : ' streaming'}`}>
        <Markdown text={item.text} />
      </div>
    );
  }
  const where = target && `${target.path.split('/').pop()}:${target.start.line}`;
  return (
    <div className="msg assistant options-reply">
      {parsed.intro && (
        <div className="md">
          <Markdown text={parsed.intro} />
        </div>
      )}
      <div className="options-target">{target ? `Pick one to ${target.text ? 'replace' : 'insert at'} ${where}` : 'Nothing was selected: copy the one you want.'}</div>
      {parsed.options.map((o, i) => (
        <div key={i} className={`option-card${applied === i ? ' applied' : ''}`}>
          <div className="option-head">
            <span className="option-n">Option {o.n}</span>
            {o.label && <span className="option-label">{o.label}</span>}
          </div>
          {o.text != null && <pre className={`option-text${o.complete ? '' : ' streaming'}`}>{o.text}</pre>}
          {o.note && (
            <div className="option-note md">
              <Markdown text={o.note} />
            </div>
          )}
          <div className="option-actions">
            {target && (
              <button
                className={applied === i ? '' : 'primary'}
                disabled={!item.done || !o.complete || o.text == null}
                title={applied === i ? 'This option is in the editor (⌘Z to undo)' : `Put this in place of ${where} (⌘Z to undo)`}
                onClick={() => void studio.applyOption(item.id, i)}
              >
                {applied === i ? 'In use ✓' : applied != null ? 'Use this instead' : target.text ? 'Use this' : 'Insert'}
              </button>
            )}
            <button disabled={!o.complete || o.text == null} onClick={() => copyText(o.text ?? '')}>
              Copy
            </button>
          </div>
        </div>
      ))}
      {/* Once one is in use: was that it? */}
      {applied != null && item.taskCheck === 'ask' && <TaskCheck id={item.id} question={`Option ${parsed.options[applied]?.n ?? applied + 1} is in. Is this task done?`} />}
    </div>
  );
}

const selectedText = () => String(window.getSelection() ?? '').trim();

/** Right-click on a chat item: copy the selection, the message, or a tool's details. */
const itemMenu = (text: string, what: string) =>
  onContextMenu(() => [
    !!selectedText() && { label: 'Copy', action: () => studio.copy(selectedText()) },
    { label: `Copy ${what}`, action: () => studio.copy(text) },
  ]);

type Field = QuestionItem['fields'][number];
type Value = string | number | boolean | string[];

/** A question's short name, for tabs and the record: its header, or the start of the question. */
function questionName(f: Field) {
  if (f.title) return f.title;
  const t = questionText(f).replace(/\s+/g, ' ');
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

/**
 * The question in the chat, once it's answered: what was asked and what you
 * said (asked in a reply, your message below says it). While it waits, a line
 * pointing to the panel.
 */
function QuestionRecord({ item }: { item: QuestionItem }) {
  const questions = item.fields.filter((f) => f.type !== 'external');
  const several = questions.length > 1;
  if (item.state === 'pending' || item.state === 'sending') {
    return (
      <div className="question-waiting">
        <Icon name="help" size={13} />
        The assistant asks you {several ? `${questions.length} questions` : 'a question'}, below
      </div>
    );
  }
  const head =
    item.state === 'answered' ? (item.via === 'message' ? 'The assistant asked' : several ? 'You answered' : 'You answered') : item.state === 'dismissed' ? `You skipped ${several ? 'the questions' : 'the question'}` : 'Not answered';
  const withAnswers = item.state === 'answered' && item.via !== 'message';
  return (
    <div className={`question-record ${item.state}`}>
      <div className="question-record-head">
        {item.state === 'answered' && <Icon name="check" size={12} />}
        {head}
      </div>
      {questions.map((f) => (
        <div key={f.key} className="question-record-row" title={questionText(f)}>
          <span className="question-record-q">{withAnswers ? questionName(f) : questionText(f)}</span>
          {withAnswers && <span className="question-record-a">{answerText(f, item.answer?.[f.key]) ? <MarkdownLine text={answerText(f, item.answer?.[f.key])} /> : <span className="muted">Not answered</span>}</span>}
        </div>
      ))}
    </div>
  );
}

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

/** A question about something the assistant may not do without asking, in words; the exact command folds out. */
function PermissionCard({ item }: { item: Extract<ChatItem, { kind: 'permission' }> }) {
  const names = useStore(studio.store, (s) => s.names);
  const pending = item.state === 'pending' || item.state === 'sending';
  const { what, code } = describePermission(item.action, item.resources, names);
  return (
    <div className={`permission ${pending ? 'pending' : item.state}`}>
      <div className="permission-title">
        {pending ? 'The assistant wants to' : item.state === 'reject' ? 'You didn’t let the assistant' : 'You let the assistant'} {what}.
      </div>
      {code && (
        <details className="permission-command">
          <summary>Show the command</summary>
          <pre className="tool-command">{code}</pre>
        </details>
      )}
      {item.patches.map((p) => (
        <Patch key={p.file} text={p.patch} />
      ))}
      {pending && (
        <div className="permission-actions">
          <button className="primary" disabled={item.state === 'sending'} title="Just this once; it asks again next time" onClick={() => void studio.replyPermission(item.id, 'once')}>
            Allow
          </button>
          <button disabled={item.state === 'sending'} onClick={() => void studio.replyPermission(item.id, 'reject')}>
            Don’t allow
          </button>
        </div>
      )}
    </div>
  );
}

/** A tool call in words ("Read “The Storm” (chapter 2) · lines 1–40"); its raw output folds out. */
function ToolRow({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const names = useStore(studio.store, (s) => s.names);
  // A question asked here is shown by its card.
  const hasCard = useStore(studio.store, (s) => item.name === 'question' && s.agent.items.some((i) => i.kind === 'question' && i.callId === item.id));
  if (hasCard) return null;
  const label = describeTool(item.name, item.input, names, undefined, item.read);
  const text = item.status === 'running' ? `${label.running}…` : label.done;
  const note = item.note ?? label.note;
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (item.read) void studio.showRead(item.read);
    else if (label.path) void studio.openFile(label.path);
  };
  return (
    <details className={`tool ${item.status}`}>
      <summary title={`${item.name}: ${item.summary}`}>
        <span className="tool-status" aria-hidden>
          {item.status === 'running' ? <span className="tool-spinner" /> : item.status === 'done' ? '✓' : '✕'}
        </span>
        {label.path && (item.read || item.name !== 'read') ? (
          <button className="tool-label link" title={item.read ? 'Open the file with these lines selected' : 'Open the file'} onClick={open}>
            {text}
          </button>
        ) : (
          <span className="tool-label">{text}</span>
        )}
        {note && <span className="tool-note">· {note}</span>}
      </summary>
      {/* The command itself, for the curious: in words above, exact here. */}
      {label.code && <pre className="tool-command">{label.code}</pre>}
      {item.detail && <pre className="tool-detail">{item.detail}</pre>}
    </details>
  );
}

/** A clock that ticks while `on`, for a live time. */
function useNow(on: boolean, every = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [on, every]);
  return now;
}

/** Who's at work, for the chat: "Claude", "Codex", or OpenCode's model. */
function useWorkerName() {
  const assistant = useStore(studio.store, (s) => s.settings.assistant);
  const model = useStore(studio.store, (s) => (s.agent.model ? s.agent.models.find((m) => m.providerID === s.agent.model!.providerID && m.id === s.agent.model!.id)?.name : null));
  return workerName(assistant, model);
}

/**
 * A small moving picture for what the assistant is doing: a sparkle that
 * twinkles while it thinks, a line being written while it writes, a comet
 * going round while a tool runs, an hourglass while it waits to try again.
 */
export function ActivityGlyph({ phase }: { phase: Activity['phase'] | 'starting' }) {
  if (phase === 'writing') {
    return (
      <svg className="glyph glyph-write" viewBox="0 0 24 24" aria-hidden>
        <path className="glyph-ink" d="M2 15c2.5-5 4.5-5 5.5-1s2.5 4 4.5-1 3.5-5.5 5-1 2.5 3.5 5 1" />
        <circle className="glyph-nib" cx="22" cy="13" r="1.6" />
      </svg>
    );
  }
  if (phase === 'tool') return <span className="glyph glyph-comet" aria-hidden />;
  if (phase === 'retrying') {
    return (
      <svg className="glyph glyph-hourglass" viewBox="0 0 24 24" aria-hidden>
        <path className="glass" d="M7 3.5h10M7 20.5h10M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5-8 8.5s8 3.5 8 8.5" />
        <path className="sand-top" d="M9.6 6.5h4.8L12 10.5z" />
        <path className="sand-bottom" d="M12 15.5l3.6 4H8.4z" />
      </svg>
    );
  }
  if (phase === 'asking') return <span className="glyph glyph-pulse" aria-hidden />;
  return (
    <svg className="glyph glyph-sparkle" viewBox="0 0 24 24" aria-hidden>
      <path className="sparkle-big" d="M10 3.5l1.9 6.6 6.6 1.9-6.6 1.9L10 20.5l-1.9-6.6L1.5 12l6.6-1.9z" />
      <path className="sparkle-small a" d="M19.5 2.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
      <path className="sparkle-small b" d="M19 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}

/**
 * The model's reasoning: its last lines while it streams, then folded to
 * "Waited 12 s · Thought for 4 s". Waiting (the model saying nothing yet:
 * queued, loading, or reasoning it doesn't show) and thinking (its reasoning
 * streaming in) are timed apart, so a slow start doesn't count as thought.
 */
function Thinking({ item }: { item: Extract<ChatItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  const now = useNow(!item.done, 1000);
  const name = useWorkerName();
  if (!item.done) {
    return (
      <div className="thinking live">
        <div className="thinking-head">
          <ActivityGlyph phase="thinking" />
          {waitedPrefix(item)}
          <span className="shimmer">{name} is thinking…</span> <span className="thinking-time">{clockTime(thinkingSoFar(item, now))}</span>
        </div>
        <div className="thinking-tail">
          <div>{item.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="thinking">
      <button className="thinking-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {thoughtHeading(item)} <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="thinking-text">{item.text}</div>}
    </div>
  );
}

/** While a turn runs: what it's doing now, animated, with the time so far. */
function ActivityLine() {
  const running = useStore(studio.store, (s) => s.agent.running);
  const activity = useStore(studio.store, (s) => s.agent.activity);
  // A live thinking block already says "… is thinking".
  const thinkingShown = useStore(studio.store, (s) => {
    const last = s.agent.items[s.agent.items.length - 1];
    return last?.kind === 'thinking' && !last.done;
  });
  const name = useWorkerName();
  const now = useNow(running);
  if (!running || !activity || (thinkingShown && activity.phase === 'thinking')) return null;
  // This step's own time (how long it's been waiting, or thinking, or on this
  // tool), and the turn's when it has had other steps before.
  const { step, total } = stepTimes(activity, now);
  const wait = activity.retryAt ? Math.max(0, Math.ceil((activity.retryAt - now) / 1000)) : 0;
  const words = activityWords(activity, name, step, wait);
  const label = activity.phase === 'asking' || activity.phase === 'retrying' ? words : `${words}…`;
  // A long turn: something worth knowing, under the line (not while it's waiting on you).
  const tip = activity.phase === 'asking' ? null : waitingTip(total, activity.since);
  return (
    <div className={`activity phase-${activity.phase}`}>
      <div className="activity-line" role="status" aria-live="polite" title={activity.reason}>
        <ActivityGlyph phase={activity.phase} />
        {/* Keyed by its words, so each new phrase comes in rather than just swapping. */}
        <span key={words} className="activity-label shimmer">
          {label}
        </span>
        <span className="activity-time">{clockTime(step)}</span>
        {total > step && (
          <span className="activity-total" title="Since you sent it">
            {clockTime(total)} in all
          </span>
        )}
      </div>
      {tip && (
        <div key={tip} className="activity-tip">
          {tip}
        </div>
      )}
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  return (
    <div className="item-wrap" onContextMenu={item.kind === 'user' || item.kind === 'assistant' ? itemMenu(item.text, 'Message') : item.kind === 'tool' ? itemMenu(`${item.name} ${item.summary}\n${item.detail}`, 'Details') : undefined}>
      <ItemBody item={item} />
    </div>
  );
}

function ItemBody({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg user">
          {item.attachments.length > 0 && (
            <div className="chips">
              {item.attachments.map((a) => (
                <span key={a} className="chip">
                  {a}
                </span>
              ))}
            </div>
          )}
          <div className="msg-text">{item.text}</div>
        </div>
      );
    case 'thinking':
      return <Thinking item={item} />;
    case 'question':
      return <QuestionRecord item={item} />;
    case 'assistant': {
      if (item.options) return <OptionsReply item={item} />;
      // Questions at the end of a reply are asked in the panel, not shown as their block.
      const text = withoutAddressed(withoutMarker(splitQuestions(item.text).text));
      if (!text.trim() && item.taskCheck !== 'ask') return null;
      return (
        <div className={`msg assistant md${item.done ? '' : ' streaming'}`}>
          <Markdown text={text} />
          {item.taskCheck === 'ask' && <TaskCheck id={item.id} />}
        </div>
      );
    }
    case 'tool':
      return <ToolRow item={item} />;
    case 'permission':
      return <PermissionCard item={item} />;
    case 'notice':
      return (
        <div className={`notice ${item.tone}`}>
          {item.text}
          {item.action && (
            <div className="notice-action">
              <button onClick={() => void (item.action!.resume ? studio.resume() : studio.send(item.action!.prompt ?? ''))}>{item.action.label}</button>
            </div>
          )}
        </div>
      );
  }
}

/** "Is the task done?" under the reply that asks it (or the option picked). */
function TaskCheck({ id, question = 'Is this task done?' }: { id: string; question?: string }) {
  const running = useStore(studio.store, (s) => s.agent.running);
  return (
    <div className="task-check">
      <span>{question}</span>
      <button className="primary" disabled={running} title="Saves your files, keeps a named version in History, and starts a new task" onClick={() => void studio.finishTask()}>
        Yes, it's done: new task
      </button>
      <button disabled={running} title="Keep going in this task" onClick={() => studio.dismissTaskCheck(id)}>
        Not yet
      </button>
    </div>
  );
}

/** The mode menu: compact trigger, opens upward with a description per mode. ⇧Tab cycles. */
function ModeMenu() {
  const mode = useStore(studio.store, (s) => s.agent.mode);
  const running = useStore(studio.store, (s) => s.agent.running);
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
                </span>
                <span className="model-check">{m === mode ? '✓' : ''}</span>
              </button>
            );
          })}
          <div className="model-footer">
            <span className="muted">⇧Tab in the message box switches mode</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown in plan mode once the agent has replied: carry out the plan. */
function PlanActions() {
  const show = useStore(studio.store, (s) => s.agent.mode === 'plan' && !s.agent.running && s.agent.items.some((i) => i.kind === 'assistant'));
  if (!show) return null;
  return (
    <div className="plan-actions">
      <span className="muted">Happy with the plan?</span>
      <button className="primary" onClick={() => void studio.writeFromPlan()}>
        Write it
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
  const setText = (t: string) => {
    studio.composerDraft = t;
    setTextState(t);
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
  // "/…": the list of commands, until a space (or Esc).
  const matches = slashMatches(text);
  const [highlight, setHighlight] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
  const showSlash = matches.length > 0 && slashDismissed !== text;
  useEffect(() => setHighlight(0), [text]);
  const pickSlash = (name: string) => {
    const cmd = matches.find((c) => c.name === name);
    if (!cmd) return;
    if (cmd.immediate) {
      setText('');
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
  }, [text]);
  // The keys live in the buttons' tooltips, not in a line of help under the box.
  const keys = sendHint(sendKey);
  const queueKeys = `${keys.split(' · ')[0].replace('send', 'queue')} · ⌥⏎ send now`;

  return (
    <div className="composer">
      <QueuedMessages />
      <PlanActions />
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
          onChange={(e) => setText(e.target.value)}
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
      {queued.map((q) => (
        <div key={q.id} className={`queued-item ${q.delivery}`}>
          <span className="queued-state">{q.sending ? 'Sending…' : q.delivery === 'steer' ? 'Next step' : 'Queued'}</span>
          <span className="queued-text" title={q.text}>
            {q.text}
          </span>
          {!q.sending && q.delivery === 'queue' && (
            <button className="small" title="The assistant reads it at its next step, without waiting for the end" onClick={() => void studio.steerQueued(q.id)}>
              Send now
            </button>
          )}
          {!q.sending && (
            <>
              <button className="small" title="Take it back to change it" onClick={() => void studio.unqueue(q.id, { edit: true })}>
                Edit
              </button>
              <button className="icon" aria-label="Don't send" title="Don't send" onClick={() => void studio.unqueue(q.id)}>
                ✕
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function StyleGuideBar() {
  const guide = useStore(studio.store, (s) => s.styleGuide);
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready' && !s.agent.running);
  // This conversation is drafting the guide: say so, rather than offering to start it.
  const drafting = useStore(studio.store, (s) => s.styleGuide.drafting !== null && (s.styleGuide.drafting === '' || s.styleGuide.drafting === s.agent.sessionId));
  if (drafting) {
    return (
      <div className="style-bar drafting">
        <ActivityGlyph phase="thinking" />
        <span>
          <strong>Drafting your style guide</strong> from the chapters. It opens in the editor when it’s written.
        </span>
      </div>
    );
  }
  if (guide.exists) {
    return (
      <div className="style-bar">
        <span className="muted">Style guide</span>
        <button className="link" title="Every message follows this guide. Click to edit it." onClick={() => void studio.openFile('WRITING_STYLE.md')}>
          WRITING_STYLE.md
        </button>
      </div>
    );
  }
  if (guide.dismissed) return null;
  return (
    <div className="style-bar setup">
      <div>
        <strong>No writing style guide yet.</strong> A short guide (voice, tone, terminology, formatting) keeps every edit sounding like your book.
      </div>
      <div className="style-actions">
        <button className="primary" disabled={!ready} title="The agent reads your chapters, asks a few questions, then writes WRITING_STYLE.md" onClick={() => void studio.draftStyleGuide()}>
          Draft from my chapters
        </button>
        <button onClick={() => void studio.createStyleGuideFromTemplate()}>Start from a template</button>
        <button className="link" onClick={() => studio.dismissStyleGuidePrompt()}>
          Not now
        </button>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  'Explain how the files of this book fit together.',
  'Suggest an outline for my next chapter.',
  "Read the open chapter and point out typos, repeated words and unclear sentences. Don't change anything yet.",
  'How do I add a footnote?',
];

/** Shown before the first message: what the assistant does, and things to try. */
function Starter() {
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready');
  const todos = useStore(studio.store, (s) => s.todos);
  return (
    <div className="starter">
      <h3>Your writing assistant</h3>
      <p>
        It reads your book, follows your style guide, and can edit for you. Every change shows up in the preview, and History keeps a version from before it.
      </p>
      {todos.length > 0 && (
        <>
          <div className="starter-label">From your TODOs</div>
          {todos.slice(0, 3).map((t) => (
            <button key={`${t.path}:${t.line}`} className="suggestion todo" disabled={!ready} title="Ask the assistant to do this now" onClick={() => void studio.askTodo(t)}>
              {t.text}
              <span className="suggestion-where">
                {t.path.split('/').pop()}:{t.line}
              </span>
            </button>
          ))}
        </>
      )}
      <div className="starter-label">Try asking</div>
      {SUGGESTIONS.map((s) => (
        <button key={s} className="suggestion" disabled={!ready} title="Ask this now" onClick={() => void studio.send(s)}>
          {s}
        </button>
      ))}
      <ul className="starter-tips">
        <li>
          Select text and press <kbd>⌘I</kbd> to ask about it.
        </li>
        <li>
          <strong>Plan</strong> talks it through and outlines before writing. <strong>Options</strong> gives you three versions to pick from.
        </li>
        <li>
          New to Typst?{' '}
          <button className="link" onClick={() => studio.openGuide()}>
            Typst basics
          </button>
        </li>
      </ul>
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
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [agent.items, agent.activity]);

  return (
    <section className="pane agent-pane">
      <div className="agent-body">
        <header className="pane-header">
          <TaskMenu />
          {agent.running && <span className="busy-bar" aria-hidden />}
          <span className="spacer" />
          <ContextMeter />
          {agent.sessionId && !agent.running && agent.items.some((i) => i.kind === 'assistant') && agent.tasks.find((t) => t.sessionId === agent.sessionId)?.status !== 'done' && (
            <button className="header-button" title="This task is done: it's saved as a named version in History, and a new task starts" onClick={() => void studio.finishTask()}>
              <Icon name="check" size={14} />
              Done
            </button>
          )}
          {/* A blank conversation already is a new task: nothing to start. */}
          {(agent.sessionId || agent.items.length > 0) && (
            <button
              className="header-button new-task"
              title={agent.running ? 'Start a new task (this one carries on in the background)' : 'Start a new task (a new conversation)'}
              onClick={() => studio.newSession()}
            >
              <Icon name="plus" size={14} />
              New task
            </button>
          )}
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
        <StyleGuideBar />
        <div
          className="transcript"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {agent.items.length === 0 && <Starter />}
          {agent.items.map((item) => (
            <Item key={item.id} item={item} />
          ))}
          <ActivityLine />
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
