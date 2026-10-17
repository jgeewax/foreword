import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { composerKeyAction, sendHint } from '../app/settings';
import { studio, type ChatItem } from '../app/studio';
import { onContextMenu } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { AGENT_MODES, modeConfig, nextMode } from '../services/agent/modes';
import { parseOptions } from '../services/agent/options-mode';
import { Markdown } from './Markdown';
import { ModelPicker } from './ModelPicker';
import { TypstGuide } from './TypstGuide';

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
    case 'assistant':
      if (item.options) return <OptionsReply item={item} />;
      return (
        <div className={`msg assistant md${item.done ? '' : ' streaming'}`}>
          <Markdown text={item.text} />
        </div>
      );
    case 'tool':
      return (
        <details className={`tool ${item.status}`}>
          <summary>
            <span className="tool-status">{item.status === 'running' ? '◌' : item.status === 'done' ? '✓' : '✕'}</span>
            <span className="tool-name">{item.name}</span>
            <span className="tool-summary">{item.summary}</span>
          </summary>
          {item.detail && <pre className="tool-detail">{item.detail}</pre>}
        </details>
      );
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
      return <div className={`notice ${item.tone}`}>{item.text}</div>;
  }
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

function Composer() {
  const attachments = useStore(studio.store, (s) => s.agent.attachments);
  const running = useStore(studio.store, (s) => s.agent.running);
  const mode = useStore(studio.store, (s) => s.agent.mode);
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready');
  const sendKey = useStore(studio.store, (s) => s.settings.sendKey);
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

  const send = async () => {
    const message = text;
    if (await studio.send(message)) setText('');
  };

  return (
    <div className="composer">
      <PlanActions />
      {attachments.length > 0 && (
        <div className="chips">
          {attachments.map((a) => (
            <span key={a.id} className="chip" title={a.selection.selectedText || 'cursor position'}>
              {a.label}
              <button aria-label={`Remove ${a.label}`} onClick={() => studio.removeAttachment(a.id)}>
                ×
              </button>
            </span>
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
          if (composerKeyAction({ ...e, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, sendKey) === 'send') {
            e.preventDefault();
            void send();
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
        <span className="spacer" />
        {running ? (
          <button onClick={() => void studio.cancel()}>Stop</button>
        ) : (
          <button className="primary" disabled={!ready || !text.trim()} onClick={() => void send()}>
            Send
          </button>
        )}
      </div>
      <div className="composer-hint" title="Change in Settings (⌘,)">
        ⌘I attach selection · {sendHint(sendKey)}
      </div>
    </div>
  );
}

function EditPolicyToggle() {
  const policy = useStore(studio.store, (s) => s.settings.agentEdits);
  const allow = policy === 'allow';
  return (
    <button
      className={`chip-toggle${allow ? ' on' : ''}`}
      title={allow ? 'The agent edits files without asking. Click to ask first.' : 'The agent asks before editing files. Click to allow edits without asking.'}
      onClick={() => studio.updateSettings({ agentEdits: allow ? 'ask' : 'allow' })}
    >
      {allow ? 'Edits: automatic' : 'Edits: ask first'}
    </button>
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
  return (
    <div className="starter">
      <h3>Your writing assistant</h3>
      <p>
        It reads your book, follows your style guide, and can edit for you. Every change shows up in the preview, and History keeps a version from before it.
      </p>
      <div className="starter-label">Try asking</div>
      {SUGGESTIONS.map((s) => (
        <button key={s} className="suggestion" disabled={!ready} onClick={() => studio.fillComposer(s)}>
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
  }, [agent.items]);

  return (
    <section className="pane agent-pane">
      {guideOpen && <TypstGuide onClose={() => studio.closeGuide()} />}
      {/* Hidden, not unmounted, while the guide is open: keeps the draft message and scroll position. */}
      <div className="agent-body" hidden={guideOpen}>
        <header className="pane-header">
          <span className="pane-title session-title" title={agent.title ?? undefined}>
            {agent.title ?? 'Assistant'}
          </span>
          {agent.running && <span className="working">working…</span>}
          <span className="spacer" />
          <button className="icon" title="New conversation" aria-label="New conversation" disabled={agent.running} onClick={() => studio.newSession()}>
            ＋
          </button>
        </header>
        <div className="agent-status">
          {agent.status === 'starting' && 'Starting OpenCode…'}
          {agent.status === 'error' && <span className="bad">OpenCode: {agent.error}</span>}
          {agent.status === 'ready' && (
            <>
              <span className={agent.connection === 'lost' ? 'bad' : ''}>{agent.connection === 'lost' ? 'Event stream reconnecting…' : 'Ready'}</span>
              <span className="spacer" />
              <EditPolicyToggle />
            </>
          )}
          {agent.status === 'error' && (
            <button className="link" onClick={() => void studio.startAgent()}>
              Retry
            </button>
          )}
        </div>
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
        </div>
        <Composer />
      </div>
    </section>
  );
}
