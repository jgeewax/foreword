import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { composerKeyAction, sendHint } from '../app/settings';
import { studio, type ChatItem } from '../app/studio';
import { onContextMenu } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { AGENT_MODES, modeConfig, nextMode } from '../services/agent/modes';
import { parseOptions } from '../services/agent/options-mode';
import { Icon } from './icons';
import { Markdown } from './Markdown';
import { ModelPicker } from './ModelPicker';
import { PermissionsMenu } from './Permissions';
import { TypstGuide } from './TypstGuide';
import { ContextMeter, TaskMenu } from './TaskMenu';
import { withoutMarker } from '../app/tasks';
import { withoutAddressed } from '../app/review';
import { describeTool } from '../app/tool-labels';
import { parseSlash, slashMatches } from '../app/slash';

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
        {label.code && <code className="tool-code">{label.code}</code>}
      </summary>
      {item.detail && <pre className="tool-detail">{item.detail}</pre>}
    </details>
  );
}

/** The model's reasoning: its last lines while it streams, then folded to "Thought for 4 s". */
function Thinking({ item }: { item: Extract<ChatItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  if (!item.done) {
    return (
      <div className="thinking live">
        <div className="thinking-head shimmer">Thinking…</div>
        <div className="thinking-tail">
          <div>{item.text}</div>
        </div>
      </div>
    );
  }
  const secs = item.ended && item.started ? Math.max(1, Math.round((item.ended - item.started) / 1000)) : null;
  return (
    <div className="thinking">
      <button className="thinking-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {secs ? `Thought for ${secs} s` : 'Thought'} <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="thinking-text">{item.text}</div>}
    </div>
  );
}

const clockTime = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/** While a turn runs: what it's doing now, animated, with the time so far. */
function ActivityLine() {
  const running = useStore(studio.store, (s) => s.agent.running);
  const activity = useStore(studio.store, (s) => s.agent.activity);
  // A live thinking block already says "Thinking…".
  const thinkingShown = useStore(studio.store, (s) => {
    const last = s.agent.items[s.agent.items.length - 1];
    return last?.kind === 'thinking' && !last.done;
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [running]);
  if (!running || !activity || (thinkingShown && activity.phase === 'thinking')) return null;
  const elapsed = Math.max(0, Math.floor((now - activity.since) / 1000));
  const wait = activity.retryAt ? Math.max(0, Math.ceil((activity.retryAt - now) / 1000)) : 0;
  const label =
    activity.phase === 'sending'
      ? 'Sending…'
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
      <span className="activity-time">{clockTime(elapsed)}</span>
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
    case 'permission': {
      const pending = item.state === 'pending' || item.state === 'sending';
      return (
        <div className={`permission ${pending ? 'pending' : item.state}`}>
          <div className="permission-title">
            Allow <strong>{item.action}</strong> {item.resources.join(', ')}?
          </div>
          {item.patches.map((p) => (
            <Patch key={p.file} text={p.patch} />
          ))}
          {pending ? (
            <div className="permission-actions">
              <button className="primary" disabled={item.state === 'sending'} onClick={() => void studio.replyPermission(item.id, 'once')}>
                Allow once
              </button>
              <button disabled={item.state === 'sending'} onClick={() => void studio.replyPermission(item.id, 'reject')}>
                Reject
              </button>
            </div>
          ) : (
            <div className="permission-result">{item.state === 'reject' ? 'Rejected' : 'Allowed'}</div>
          )}
        </div>
      );
    }
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
        <span className="model-trigger-chevron">▾</span>
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

/** The live selection: sent with the message; click to see it, × to leave it out. */
function LiveSelectionChip({ live, open, onToggle }: { live: NonNullable<ReturnType<typeof studio.store.get>['agent']['selection']>; open: boolean; onToggle: () => void }) {
  const sel = live.attachment.selection;
  const lines = sel.end.line - sel.start.line + 1;
  return (
    <span className={`chip live${open ? ' open' : ''}`} title="Sent with your message. Click to see it.">
      <button className="chip-main" aria-expanded={open} onClick={onToggle}>
        <span className="chip-kind">{live.from === 'preview' ? 'From preview' : 'Selected'}</span>
        {live.attachment.label}
        <span className="chip-meta">· {lines === 1 ? `${sel.selectedText.length} chars` : `${lines} lines`}</span>
        <span className="chip-caret">{open ? '▴' : '▾'}</span>
      </button>
      <button aria-label="Leave the selection out" title="Leave it out of the next message" onClick={() => studio.dismissSelection()}>
        ×
      </button>
    </span>
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
  const [previewOpen, setPreviewOpen] = useState(false);
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

  return (
    <div className="composer">
      <QueuedMessages />
      <PlanActions />
      {(attachments.length > 0 || liveShown) && (
        <div className="chips">
          {attachments.map((a) => (
            <span key={a.id} className="chip" title={a.selection.selectedText || 'cursor position'}>
              {a.label}
              <button className="chip-remove" aria-label={`Remove ${a.label}`} onClick={() => studio.removeAttachment(a.id)}>
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
          {liveShown && live && <LiveSelectionChip live={live} open={previewOpen} onToggle={() => setPreviewOpen((o) => !o)} />}
        </div>
      )}
      {liveShown && live && previewOpen && <pre className="selection-preview">{live.attachment.selection.selectedText}</pre>}
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
      <textarea
        ref={inputRef}
        value={text}
        rows={3}
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
        <ModelPicker placement="up" />
        <PermissionsMenu />
        <span className="spacer" />
        {running ? (
          <>
            <button title="Stop the assistant now" onClick={() => void studio.cancel()}>
              Stop
            </button>
            {text.trim() && (
              <>
                <button title="The assistant reads it at its next step (⌥⏎)" onClick={() => void send('steer')}>
                  Send now
                </button>
                <button className="primary" title="Sent when the assistant finishes" onClick={() => void send('queue')}>
                  Queue
                </button>
              </>
            )}
          </>
        ) : (
          <button
            className="primary"
            disabled={!ready || (!text.trim() && !canResume)}
            title={canResume ? 'Carry on where it stopped, with the model chosen now (⏎)' : undefined}
            onClick={() => void send()}
          >
            {canResume ? 'Resume' : 'Send'}
          </button>
        )}
      </div>
      <div className="composer-hint" title="Change in Settings (⌘,)">
        {running
          ? `While it works: ${sendHint(sendKey).split(' · ')[0].replace('send', 'queue')} · ⌥⏎ send now`
          : `/ for commands · Selected text goes with your message · ${sendHint(sendKey)}`}
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
  const agent = useStore(studio.store, (s) => s.agent);
  const guideOpen = useStore(studio.store, (s) => s.guideOpen);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [agent.items, agent.activity]);

  return (
    <section className="pane agent-pane">
      {guideOpen && <TypstGuide onClose={() => studio.closeGuide()} />}
      {/* Hidden, not unmounted, while the guide is open: keeps the draft message and scroll position. */}
      <div className="agent-body" hidden={guideOpen}>
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
          <button
            className="header-button new-task"
            title={agent.running ? 'Start a new task (this one carries on in the background)' : 'Start a new task (a new conversation)'}
            onClick={() => studio.newSession()}
          >
            <Icon name="plus" size={14} />
            New task
          </button>
        </header>
        {(agent.status !== 'ready' || agent.connection === 'lost') && (
          <div className="agent-status">
            {agent.status === 'starting' && 'Starting the assistant (OpenCode)…'}
            {agent.status === 'off' && 'The assistant is off.'}
            {agent.status === 'error' && <span className="bad">OpenCode: {agent.error}</span>}
            {agent.status === 'ready' && agent.connection === 'lost' && <span className="bad">Reconnecting to the assistant…</span>}
            <span className="spacer" />
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
