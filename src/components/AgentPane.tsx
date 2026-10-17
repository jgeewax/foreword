import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { composerKeyAction, sendHint } from '../app/settings';
import { studio, type ChatItem } from '../app/studio';
import { useStore } from '../lib/store';
import { Markdown } from './Markdown';
import { ModelPicker } from './ModelPicker';

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

function Item({ item }: { item: ChatItem }) {
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

function ModeSwitch() {
  const mode = useStore(studio.store, (s) => s.agent.mode);
  const running = useStore(studio.store, (s) => s.agent.running);
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Agent mode">
      {(['write', 'plan'] as const).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          className={mode === m ? 'active' : ''}
          disabled={running}
          title={m === 'write' ? 'The agent writes and edits the book' : 'Discuss and outline first; the agent can’t change files'}
          onClick={() => void studio.setMode(m)}
        >
          {m === 'write' ? 'Write' : 'Plan'}
        </button>
      ))}
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
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => studio.events.on('focus-composer', () => inputRef.current?.focus()), []);

  const send = async () => {
    const message = text;
    if (await studio.send(message)) setText('');
  };

  return (
    <div className="composer">
      <PlanActions />
      <ModeSwitch />
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
        placeholder={!ready ? 'Agent not available' : mode === 'plan' ? 'What should we plan? A chapter, a section, an argument…' : 'Ask about the selection, or request an edit…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (composerKeyAction({ ...e, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, sendKey) === 'send') {
            e.preventDefault();
            void send();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            studio.events.emit('focus-editor');
          }
        }}
      />
      <div className="composer-footer">
        <span className="hint" title="Change in Settings (⌘,)">
          ⌘I attach selection · {sendHint(sendKey)}
        </span>
        {running ? (
          <button onClick={() => void studio.cancel()}>Stop</button>
        ) : (
          <button className="primary" disabled={!ready || !text.trim()} onClick={() => void send()}>
            Send
          </button>
        )}
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

export function AgentPane() {
  const agent = useStore(studio.store, (s) => s.agent);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [agent.items]);

  return (
    <section className="pane agent-pane">
      <header className="pane-header">
        <ModelPicker />
        <button className="icon" title="New session" disabled={agent.running} onClick={() => studio.newSession()}>
          ＋
        </button>
      </header>
      <div className="agent-status">
        {agent.status === 'starting' && 'Starting OpenCode…'}
        {agent.status === 'error' && <span className="bad">OpenCode: {agent.error}</span>}
        {agent.status === 'ready' && (
          <>
            <span className={agent.connection === 'lost' ? 'bad' : ''}>{agent.connection === 'lost' ? 'Event stream reconnecting…' : agent.title ?? 'New session'}</span>
            {agent.running && <span className="working">working…</span>}
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
        {agent.items.length === 0 && (
          <div className="empty-hint">Select lines in the editor and press ⌘I to ask about them. Edits need your approval.</div>
        )}
        {agent.items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>
      <Composer />
    </section>
  );
}
