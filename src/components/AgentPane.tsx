import { clockTime, stepTimes, thinkingSoFar, thoughtHeading, waitedPrefix } from '../app/activity';
import { ASSISTANT_NAMES } from '../app/settings';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { composerKeyAction, sendHint } from '../app/settings';
import { studio, type ChatItem } from '../app/studio';
import { onContextMenu } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { AGENT_MODES, modeConfig, nextMode } from '../services/agent/modes';
import { parseOptions } from '../services/agent/options-mode';
import { AssistantMenu } from './AssistantMenu';
import { Icon } from './icons';
import { Markdown } from './Markdown';
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

type QuestionItem = Extract<ChatItem, { kind: 'question' }>;
type Field = QuestionItem['fields'][number];
type Value = string | number | boolean | string[];

const isEmpty = (v: Value | undefined) => v === undefined || v === '' || (Array.isArray(v) && !v.length);
const shown = (v: Value | undefined) => (Array.isArray(v) ? v.join(', ') : v === undefined || v === '' ? '—' : String(v));

/** One question: its options as buttons (checkboxes for several), plus a free answer when allowed. */
function QuestionField({ field, value, onChange, disabled, autoFocus }: { field: Field; value: Value | undefined; onChange: (v: Value) => void; disabled: boolean; autoFocus: boolean }) {
  const options = field.options ?? [];
  const multi = field.type === 'multiselect';
  const picked = (o: string) => (multi ? Array.isArray(value) && value.includes(o) : value === o);
  const isOther = !multi && typeof value === 'string' && value !== '' && !options.some((o) => o.value === value);
  const [other, setOther] = useState(isOther ? String(value) : '');
  const pick = (o: string) => {
    if (multi) {
      const now = Array.isArray(value) ? value : [];
      onChange(now.includes(o) ? now.filter((x) => x !== o) : [...now, o]);
    } else onChange(o);
  };
  return (
    <div className="question-field">
      {field.title && <div className="question-header">{field.title}</div>}
      {field.description && <div className="question-text">{field.description}</div>}
      {options.length > 0 && (
        <div className="question-options" role={multi ? 'group' : 'radiogroup'}>
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={picked(o.value)}
              className={`question-option${picked(o.value) ? ' picked' : ''}`}
              disabled={disabled}
              autoFocus={autoFocus && i === 0}
              onClick={() => pick(o.value)}
            >
              <span className="question-key">{multi ? (picked(o.value) ? '☑' : '☐') : i + 1}</span>
              <span className="question-option-body">
                <span className="question-label">{o.label}</span>
                {o.description && <span className="question-desc">{o.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {field.type === 'boolean' && (
        <div className="question-options">
          {[true, false].map((b) => (
            <button key={String(b)} type="button" className={`question-option${value === b ? ' picked' : ''}`} disabled={disabled} onClick={() => onChange(b)}>
              {b ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      )}
      {field.type === 'external' && field.url && (
        <button type="button" className="link" onClick={() => void studio.openPrinterPage(field.url!)}>
          Open {field.url}
        </button>
      )}
      {(field.custom || (!options.length && (field.type === 'string' || field.type === 'number' || field.type === 'integer'))) && (
        <input
          className="question-other"
          type={field.type === 'string' || field.type === 'multiselect' ? 'text' : 'number'}
          placeholder={options.length ? 'Or type your own answer…' : (field.placeholder ?? 'Your answer…')}
          value={options.length ? other : value === undefined ? '' : String(value)}
          disabled={disabled}
          autoFocus={autoFocus && !options.length}
          onChange={(e) => {
            const t = e.target.value;
            if (!options.length) return onChange(field.type === 'string' ? t : t === '' ? '' : Number(t));
            setOther(t);
            if (multi) {
              const known = (Array.isArray(value) ? value : []).filter((x) => options.some((o) => o.value === x));
              onChange(t.trim() ? [...known, t.trim()] : known);
            } else onChange(t);
          }}
        />
      )}
    </div>
  );
}

/** The assistant's question(s): answer and it carries on; dismiss and it's told you declined. */
function QuestionCard({ item }: { item: QuestionItem }) {
  const [values, setValues] = useState<Record<string, Value>>(() => (item.answer ? { ...item.answer } : {}));
  const ref = useRef<HTMLFormElement>(null);
  const settled = item.state === 'answered' || item.state === 'dismissed';
  const busy = item.state === 'sending';
  const questions = item.fields.filter((f) => f.type !== 'external');
  const ready = questions.every((f) => !isEmpty(values[f.key]));
  const submit = () => {
    if (!ready || busy || settled) return;
    const answer: Record<string, Value> = {};
    for (const f of questions) {
      const v = values[f.key];
      answer[f.key] = typeof v === 'string' ? v.trim() : v;
    }
    void studio.answerQuestion(item.id, answer);
  };
  if (settled) {
    return (
      <div className={`question done ${item.state}`}>
        <div className="question-head">{item.state === 'answered' ? 'You answered' : 'You dismissed the question'}</div>
        {item.state === 'answered' &&
          questions.map((f) => (
            <div key={f.key} className="question-answer">
              <span className="muted">{f.title ?? f.description}:</span> {shown(item.answer?.[f.key])}
            </div>
          ))}
      </div>
    );
  }
  return (
    <form
      ref={ref}
      className="question"
      aria-label="The assistant asks"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        // 1–9 picks an option of the first question still unanswered (single choice).
        if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
        const n = Number(e.key);
        const field = questions.find((f) => f.type !== 'multiselect' && f.options?.length && isEmpty(values[f.key])) ?? questions.find((f) => f.type !== 'multiselect' && f.options?.length);
        if (field && n >= 1 && n <= (field.options?.length ?? 0)) {
          e.preventDefault();
          setValues((v) => ({ ...v, [field.key]: field.options![n - 1].value }));
        } else if (e.key === 'Enter' && ready) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="question-head">The assistant asks</div>
      {item.fields.map((f, i) => (
        <QuestionField key={f.key} field={f} value={values[f.key]} disabled={busy} autoFocus={i === 0} onChange={(v) => setValues((vs) => ({ ...vs, [f.key]: v }))} />
      ))}
      <div className="question-actions">
        <button type="button" disabled={busy} onClick={() => void studio.dismissQuestion(item.id)}>
          Dismiss
        </button>
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? 'Sending…' : 'Answer'}
        </button>
      </div>
    </form>
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

/**
 * The model's reasoning: its last lines while it streams, then folded to
 * "Waited 12 s · Thought for 4 s". Waiting (the model saying nothing yet:
 * queued, loading, or reasoning it doesn't show) and thinking (its reasoning
 * streaming in) are timed apart, so a slow start doesn't count as thought.
 */
function Thinking({ item }: { item: Extract<ChatItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  const now = useNow(!item.done, 1000);
  if (!item.done) {
    return (
      <div className="thinking live">
        <div className="thinking-head">
          {waitedPrefix(item)}
          <span className="shimmer">Thinking…</span> <span className="thinking-time">{clockTime(thinkingSoFar(item, now))}</span>
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
  // A live thinking block already says "Thinking…".
  const thinkingShown = useStore(studio.store, (s) => {
    const last = s.agent.items[s.agent.items.length - 1];
    return last?.kind === 'thinking' && !last.done;
  });
  const now = useNow(running);
  if (!running || !activity || (thinkingShown && activity.phase === 'thinking')) return null;
  // This step's own time (how long it's been waiting, or thinking, or on this
  // tool), and the turn's when it has had other steps before.
  const { step, total } = stepTimes(activity, now);
  const wait = activity.retryAt ? Math.max(0, Math.ceil((activity.retryAt - now) / 1000)) : 0;
  const label =
    activity.phase === 'sending'
      ? 'Sending…'
      : activity.phase === 'waiting'
        ? 'Waiting for the model…'
        : activity.phase === 'thinking'
          ? 'Thinking…'
          : activity.phase === 'tool'
            ? `${activity.label ?? 'Working'}…`
            : activity.phase === 'writing'
              ? 'Writing…'
              : activity.phase === 'asking'
                ? 'Waiting for your answer'
                : `The model is busy. Trying again${wait ? ` in ${wait} s` : ' now'}${activity.attempt ? ` (attempt ${activity.attempt})` : ''}`;
  return (
    <div className={`activity-line phase-${activity.phase}`} role="status" aria-live="polite" title={activity.reason}>
      <span className="activity-spinner" aria-hidden />
      <span className="activity-label shimmer">{label}</span>
      <span className="activity-time">{clockTime(step)}</span>
      {total > step && <span className="activity-total" title="Since you sent it">{clockTime(total)} in all</span>}
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
      return <QuestionCard item={item} />;
    case 'assistant':
      if (item.options) return <OptionsReply item={item} />;
      return (
        <div className={`msg assistant md${item.done ? '' : ' streaming'}`}>
          <Markdown text={withoutAddressed(withoutMarker(item.text))} />
          {item.taskCheck === 'ask' && <TaskCheck id={item.id} />}
        </div>
      );
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

/** "Is the task done?" under the reply that asks it. */
function TaskCheck({ id }: { id: string }) {
  const running = useStore(studio.store, (s) => s.agent.running);
  return (
    <div className="task-check">
      <span>Is this task done?</span>
      <button className="primary" disabled={running} onClick={() => void studio.finishTask()}>
        Yes, it's done: new task
      </button>
      <button disabled={running} onClick={() => studio.dismissTaskCheck(id)}>
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
            {agent.status === 'starting' && (agent.signingIn ? `Sign in with Google, in your browser, to start ${assistantName}…` : `Starting the assistant (${assistantName})…`)}
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
        <Composer />
      </div>
    </section>
  );
}
