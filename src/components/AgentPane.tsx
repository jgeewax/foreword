import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { composerKeyAction, sendHint } from '../app/settings';
import { studio, type ChatItem } from '../app/studio';
import { useStore } from '../lib/store';
import type { ModelInfo } from '../services/agent/types';

const modelKey = (m: { providerID: string; id: string }) => `${m.providerID}/${m.id}`;

function ModelPicker() {
  const models = useStore(studio.store, (s) => s.agent.models);
  const model = useStore(studio.store, (s) => s.agent.model);
  const running = useStore(studio.store, (s) => s.agent.running);
  const groups = new Map<string, ModelInfo[]>();
  for (const m of models) groups.set(m.providerName, [...(groups.get(m.providerName) ?? []), m]);
  return (
    <select
      className="model-picker"
      aria-label="Model"
      value={model ? modelKey(model) : ''}
      disabled={running || !models.length}
      onFocus={() => void studio.loadModels()}
      onChange={(e) => {
        const m = models.find((x) => modelKey(x) === e.target.value);
        if (m) void studio.selectModel(m);
      }}
    >
      {!models.length && <option value="">Loading models…</option>}
      {[...groups].map(([provider, ms]) => (
        <optgroup key={provider} label={provider}>
          {ms.map((m) => (
            <option key={modelKey(m)} value={modelKey(m)} disabled={!m.supportsTools}>
              {m.name}
              {m.supportsTools ? '' : ' — no tool support'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

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
      return <div className={`msg assistant${item.done ? '' : ' streaming'}`}>{item.text}</div>;
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

function Composer() {
  const attachments = useStore(studio.store, (s) => s.agent.attachments);
  const running = useStore(studio.store, (s) => s.agent.running);
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
        placeholder={ready ? 'Ask about the selection, or request an edit…' : 'Agent not available'}
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
        <span className="spacer" />
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
          </>
        )}
        {agent.status === 'error' && (
          <button className="link" onClick={() => void studio.startAgent()}>
            Retry
          </button>
        )}
      </div>
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
