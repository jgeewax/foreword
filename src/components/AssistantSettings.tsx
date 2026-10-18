// Settings ▸ Assistant: which program is the writing assistant, as cards that
// say how each would run on this Mac, and a panel for the one chosen: how it
// is now, its model, its account (with sign-in in Terminal) and its program.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { studio, type StudioState } from '../app/studio';
import { ASSISTANT_NAMES, ASSISTANTS, type AssistantId } from '../app/settings';
import { errorMessage, ipc, type AssistantSetup, type AssistantsSetup, type ToolInfo } from '../lib/ipc';
import { tildePath } from '../lib/paths';
import { useStore } from '../lib/store';
import { Icon } from './icons';
import { ModelPicker } from './ModelPicker';

/** Who makes each one, and the account it runs on. */
const ABOUT: Record<AssistantId, { maker: string; account: string }> = {
  opencode: { maker: 'Open source', account: 'Any model you’ve set up in it: OpenAI, Anthropic, Google, or one on this Mac' },
  claude: { maker: 'Anthropic', account: 'Claude, with your Claude plan or an API key' },
  // Gemini CLI stopped serving personal Google logins in June 2026.
  gemini: { maker: 'Google', account: 'Gemini, with a paid API key or a Gemini Code Assist work account' },
  codex: { maker: 'OpenAI', account: 'OpenAI’s models, with your ChatGPT plan or an API key' },
};

/** Each one's mark: a glyph on a tile of its own colour (not its maker's logo). */
const GLYPHS: Record<AssistantId, ReactNode> = {
  opencode: <path d="M8.5 4.5C6.8 4.5 6 5.3 6 7v2.6c0 1.3-.7 2.4-2 2.4 1.3 0 2 1.1 2 2.4V17c0 1.7.8 2.5 2.5 2.5M15.5 4.5c1.7 0 2.5.8 2.5 2.5v2.6c0 1.3.7 2.4 2 2.4-1.3 0-2 1.1-2 2.4V17c0 1.7-.8 2.5-2.5 2.5" />,
  claude: <path d="M12 3.5v17M3.5 12h17M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7" />,
  gemini: <path d="M12 2.5c.7 5 4.5 8.8 9.5 9.5-5 .7-8.8 4.5-9.5 9.5-.7-5-4.5-8.8-9.5-9.5 5-.7 8.8-4.5 9.5-9.5z" fill="currentColor" stroke="none" />,
  codex: <path d="M5.5 7l5 5-5 5M12.5 17.5h6" />,
};

export function AssistantMark({ id, size = 34 }: { id: AssistantId; size?: number }) {
  return (
    <span className={`assistant-mark mark-${id}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[id]}
      </svg>
    </span>
  );
}

type Tone = 'ok' | 'busy' | 'warn' | 'bad' | 'off';
type Agent = StudioState['agent'];

/** Where the chosen assistant is. */
type Now = 'no-book' | 'starting' | 'running' | 'signed-out' | 'no-node' | 'not-installed' | 'failed' | 'off';

function nowOf(id: AssistantId, agent: Agent, setup: AssistantSetup | undefined, hasBook: boolean): Now {
  if (!hasBook) return 'no-book';
  if (agent.status === 'starting') return 'starting';
  if (agent.status === 'ready') return 'running';
  if (agent.status !== 'error') return 'off';
  if (agent.signedOut) return 'signed-out';
  if (setup && id === 'opencode' && !setup.program) return 'not-installed';
  if (setup && id !== 'opencode' && !setup.program && !setup.package) return 'no-node';
  return 'failed';
}

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

const signedInWith = (s: AssistantSetup) => (s.account ? `Signed in with ${s.account}` : 'Signed in');

/** A card's status line: how the chosen one is now; for the others, how they'd run. */
function cardStatus(id: AssistantId, now: Now | null, setup: AssistantSetup | undefined, model: string | null, version: string | null): { tone: Tone; text: string } {
  switch (now) {
    case 'no-book':
      return { tone: 'off', text: 'Starts when you open a book' };
    case 'starting':
      return { tone: 'busy', text: 'Starting…' };
    case 'running':
      return { tone: 'ok', text: model ? `Running · ${model}` : 'Running' };
    case 'signed-out':
      return { tone: 'warn', text: 'Not signed in' };
    case 'no-node':
      return { tone: 'bad', text: 'Needs Node.js' };
    case 'not-installed':
      return { tone: 'bad', text: 'Not installed' };
    case 'failed':
      return { tone: 'bad', text: 'Didn’t start' };
    case 'off':
      return { tone: 'off', text: 'Off' };
  }
  if (!setup) return { tone: 'off', text: 'Looking…' };
  if (id === 'opencode') return setup.program ? { tone: 'off', text: version ? `Installed · ${version}` : 'Installed' } : { tone: 'warn', text: 'Not installed' };
  if (!setup.program && !setup.package) return { tone: 'bad', text: 'Needs Node.js' };
  if (setup.signedIn === false) return { tone: 'warn', text: 'Not signed in' };
  if (setup.signedIn) return { tone: 'ok', text: signedInWith(setup) };
  return { tone: 'off', text: setup.program ? 'Installed' : 'Downloads the first time' };
}

/** A command to type in Terminal, with Copy. */
function Command({ text }: { text: string }) {
  return (
    <span className="assistant-command">
      <code className="selectable">{text}</code>
      <button className="link" onClick={() => void ipc.clipboardWrite(text).then(() => studio.toast('Copied.'))}>
        Copy
      </button>
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="assistant-row-label">{label}</div>
      <div className="assistant-row-value">{children}</div>
    </>
  );
}

export function AssistantPage({ goToTools }: { goToTools: () => void }) {
  const settings = useStore(studio.store, (s) => s.settings);
  const agent = useStore(studio.store, (s) => s.agent);
  const hasBook = useStore(studio.store, (s) => !!s.workspace);
  const opencode = useStore(studio.store, (s) => s.tools?.opencode);
  const [setups, setSetups] = useState<AssistantsSetup | null>(null);
  // Terminal was opened to sign in: on coming back, check again and start again (a new login, or a new OpenCode provider).
  const [waiting, setWaiting] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const chosen = settings.assistant;

  const refresh = useCallback(() => void ipc.assistantsStatus().then(setSetups, (e) => console.warn('assistants status', e)), []);
  // Again once it has started or failed: signing in elsewhere, or installing, changes what's true.
  useEffect(refresh, [refresh, agent.status]);
  useEffect(() => {
    const onFocus = () => {
      refresh();
      if (!waiting) return;
      setWaiting(false);
      if (studio.state.workspace) void studio.restartAgent();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, waiting]);

  const setup = setups?.[chosen];
  const now = nowOf(chosen, agent, setup, hasBook);
  const current = agent.model ? agent.models.find((m) => m.providerID === agent.model?.providerID && m.id === agent.model?.id) : undefined;
  const modelName = current?.name ?? agent.model?.id ?? null;
  const name = ASSISTANT_NAMES[chosen];

  const choose = (id: AssistantId) => id !== chosen && studio.updateSettings({ assistant: id });
  const signIn = async () => {
    try {
      await ipc.assistantSignIn(chosen);
      setWaiting(true);
    } catch (e) {
      studio.toast(errorMessage(e), 'error');
    }
  };
  // Arrows move between the cards; Space or Enter chooses (choosing starts the program).
  const onCardKey = (e: React.KeyboardEvent, i: number) => {
    const step = ARROWS[e.key];
    if (!step) return;
    e.preventDefault();
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[(i + step + ASSISTANTS.length) % ASSISTANTS.length]?.focus();
  };

  const headline: Record<Now, string> = {
    'no-book': `${name} starts when you open a book.`,
    starting: `Starting ${name}…`,
    running: `${name} is running.`,
    'signed-out': `${name} isn’t signed in.`,
    'no-node': `${name} needs Node.js.`,
    'not-installed': 'OpenCode isn’t installed.',
    failed: `${name} didn’t start.`,
    off: `${name} is off.`,
  };
  const tone: Record<Now, Tone> = { 'no-book': 'off', starting: 'busy', running: 'ok', 'signed-out': 'warn', 'no-node': 'bad', 'not-installed': 'bad', failed: 'bad', off: 'off' };
  // Signed in: what the program says, or what a start showed.
  const signedIn = agent.signedOut && now === 'signed-out' ? false : (setup?.signedIn ?? (now === 'running' ? true : null));

  return (
    <>
      <section className="settings-section">
        <h2>Which assistant</h2>
        <div className="assistant-cards" role="radiogroup" aria-label="Which assistant" ref={groupRef}>
          {ASSISTANTS.map((id, i) => {
            const status = cardStatus(id, id === chosen ? now : null, setups?.[id], modelName, opencode?.version ?? null);
            return (
              <button
                key={id}
                role="radio"
                aria-checked={id === chosen}
                tabIndex={id === chosen ? 0 : -1}
                data-assistant={id}
                className={`assistant-card${id === chosen ? ' chosen' : ''}`}
                onClick={() => choose(id)}
                onKeyDown={(e) => onCardKey(e, i)}
              >
                <AssistantMark id={id} />
                <span className="assistant-card-text">
                  <span className="assistant-card-name">
                    {ASSISTANT_NAMES[id]} <span className="assistant-card-maker">{ABOUT[id].maker}</span>
                  </span>
                  <span className="assistant-card-account">{ABOUT[id].account}</span>
                  <span className={`assistant-status tone-${status.tone}`}>
                    <span className="assistant-dot" />
                    {status.text}
                  </span>
                </span>
                {id === chosen && (
                  <span className="assistant-card-check">
                    <Icon name="check" size={11} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className={`assistant-now tone-${tone[now]}`} aria-live="polite">
          <div className="assistant-now-head">
            <span className="assistant-dot" />
            <span className="assistant-now-title">{headline[now]}</span>
            <span className="spacer" />
            {hasBook && now !== 'starting' && (
              <button className="small assistant-restart" onClick={() => void studio.restartAgent()}>
                <Icon name="refresh" size={12} /> Start again
              </button>
            )}
          </div>

          {now === 'starting' && setup && chosen !== 'opencode' && !setup.program && setup.package && (
            <p className="assistant-now-note">The first start downloads it, which can take a minute.</p>
          )}
          {now === 'signed-out' && (
            <div className="assistant-fix">
              <p>
                Sign in once, in Terminal, and {name} keeps the login.
                {chosen === 'gemini' && ' It needs a paid Gemini API key, or a Gemini Code Assist work account: since June 2026 it doesn’t take personal Google logins.'}
              </p>
              <div className="assistant-fix-actions">
                <button className="primary" onClick={() => void signIn()}>
                  <Icon name="terminal" size={14} /> Sign in in Terminal
                </button>
                {setup?.signIn && (
                  <span className="muted">
                    or type <Command text={setup.signIn} />
                  </span>
                )}
              </div>
              {waiting && <p className="assistant-now-note">When you come back from Terminal, {name} starts again.</p>}
            </div>
          )}
          {now === 'no-node' && (
            <div className="assistant-fix">
              <p>
                Its connector runs on Node.js, which isn’t installed. In Terminal: <Command text="brew install node" />, then Start again.
              </p>
            </div>
          )}
          {now === 'not-installed' && (
            <div className="assistant-fix">
              <p>
                In Terminal: <Command text="brew install opencode" />, then Start again. Or{' '}
                <button className="link" onClick={goToTools}>
                  choose a copy in Tools
                </button>
                .
              </p>
            </div>
          )}
          {now === 'failed' && agent.error && <p className="assistant-error selectable">{agent.error}</p>}

          <div className="assistant-rows">
            <Row label="Model">
              {now === 'running' && agent.models.length > 0 ? (
                <>
                  <div className="assistant-model">
                    <ModelPicker />
                  </div>
                  <span className="assistant-row-help">Each conversation keeps its own; it’s under the message box too.</span>
                </>
              ) : (
                <span className="muted">{now === 'running' || now === 'starting' ? 'Listed once it’s started' : 'Listed when it’s running'}</span>
              )}
            </Row>
            {chosen === 'opencode' ? (
              <Row label="Providers">
                <span className="assistant-row-actions">
                  <span>The accounts and API keys you’ve added to OpenCode</span>
                  <button className="small" disabled={!setup?.signIn} onClick={() => void signIn()}>
                    <Icon name="terminal" size={12} /> Add a provider…
                  </button>
                </span>
                {setup?.signIn && (
                  <span className="assistant-row-help">
                    In Terminal: <Command text={setup.signIn} />
                  </span>
                )}
              </Row>
            ) : (
              <Row label="Account">
                <span className="assistant-row-actions">
                  <span className={`assistant-account ${signedIn === false ? 'warn' : ''}`}>
                    {signedIn === true ? (setup ? signedInWith(setup) : 'Signed in') : signedIn === false ? 'Not signed in' : now === 'starting' ? 'Checking…' : 'Checked when it starts'}
                  </span>
                  {now !== 'signed-out' && (
                    <button className="small" disabled={!setup?.signIn} onClick={() => void signIn()}>
                      <Icon name="terminal" size={12} /> {signedIn ? 'Sign in again…' : 'Sign in…'}
                    </button>
                  )}
                </span>
                {now !== 'signed-out' && setup?.signIn && (
                  <span className="assistant-row-help">
                    In Terminal: <Command text={setup.signIn} />
                  </span>
                )}
              </Row>
            )}
            <Row label="Program">
              <ProgramRow id={chosen} setup={setup} opencode={opencode} goToTools={goToTools} />
            </Row>
          </div>
        </div>
        <p className="settings-help">Switching starts a new conversation, with the other assistant.</p>
      </section>
      <section className="settings-section">
        <h2>The assistant’s marks in the editor</h2>
        <div className="settings-field">
          <label className="settings-option">
            <input type="checkbox" checked={settings.markAiEdits} onChange={(e) => studio.updateSettings({ markAiEdits: e.target.checked })} />
            <span>
              Lines the assistant changed <span className="ai-swatch edit" />
              <span className="muted"> — until you rewrite them; hover the line number for what was there before</span>
            </span>
          </label>
          <label className="settings-option">
            <input type="checkbox" checked={settings.markAiReads} onChange={(e) => studio.updateSettings({ markAiReads: e.target.checked })} />
            <span>
              Lines the assistant read <span className="ai-swatch read" />
              <span className="muted"> — in the current conversation</span>
            </span>
          </label>
        </div>
      </section>
    </>
  );
}

/** The program that runs it: installed, run by npx, or missing. */
function ProgramRow({ id, setup, opencode, goToTools }: { id: AssistantId; setup: AssistantSetup | undefined; opencode: ToolInfo | undefined; goToTools: () => void }) {
  if (!setup) return <span className="muted">Looking…</span>;
  if (id === 'opencode') {
    const copy = opencode?.copies?.find((c) => c.path === opencode.path);
    return (
      <>
        {setup.program ? (
          <span className="assistant-program">
            <span>{[opencode?.version, copy?.source ?? (opencode?.fromSettings ? 'your choice' : null)].filter(Boolean).join(' · ') || 'Installed'}</span>
            <code className="selectable">{tildePath(setup.program)}</code>
          </span>
        ) : (
          <span className="bad">Not installed</span>
        )}
        <span className="assistant-row-help">
          <button className="link" onClick={goToTools}>
            Choose another copy in Tools
          </button>
        </span>
      </>
    );
  }
  if (setup.program) {
    return (
      <>
        <span className="assistant-program">
          <span>Installed</span>
          <code className="selectable">{tildePath(setup.program)}</code>
        </span>
        <span className="assistant-row-help">Typst Studio talks to it over the Agent Client Protocol.</span>
      </>
    );
  }
  if (setup.package) {
    return (
      <>
        <span className="assistant-program">
          <span>Run by Node.js</span>
          <code className="selectable">npx {setup.package}</code>
        </span>
        <span className="assistant-row-help">
          {id === 'gemini' ? 'It isn’t installed' : 'Its connector isn’t installed'}, so the first start downloads it. Typst Studio talks to it over the Agent Client Protocol.
        </span>
      </>
    );
  }
  return <span className="bad">Needs Node.js, which isn’t installed</span>;
}
