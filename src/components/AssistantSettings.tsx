// Settings ▸ Assistant: which program is the writing assistant, as cards that
// say how each would run on this Mac, and a panel for the one chosen: how it
// is now, its account (with sign-in in Terminal, or Antigravity's with Google)
// and its program. Its model is chosen in the chat.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { studio, type StudioState } from '../app/studio';
import { ASSISTANT_NAMES, ASSISTANTS, type AssistantId } from '../app/settings';
import { errorMessage, ipc, type AssistantSetup, type AssistantsSetup, type InstallPlan, type ToolInfo } from '../lib/ipc';
import { tildePath } from '../lib/paths';
import { useStore } from '../lib/store';
import { Icon } from './icons';
import { ToolPicker } from './ToolPicker';

/** Who makes each one, and the account it runs on. */
export const ABOUT: Record<AssistantId, { maker: string; account: string }> = {
  opencode: { maker: 'Open source', account: 'Any model you’ve set up in it: OpenAI, Anthropic, Google, or one on this Mac' },
  claude: { maker: 'Anthropic', account: 'Claude, with your Claude plan or an API key' },
  // Gemini CLI stopped serving personal Google logins in June 2026, when Antigravity replaced it.
  gemini: { maker: 'Google', account: 'Gemini, with a paid API key or a Gemini Code Assist work account' },
  codex: { maker: 'OpenAI', account: 'OpenAI’s models, with your ChatGPT plan or an API key' },
  antigravity: { maker: 'Google', account: 'Gemini and more, with your Google account, a Gemini API key or Gemini Enterprise' },
};

/** Each one's mark: a glyph on a tile of its own colour (not its maker's logo). */
const GLYPHS: Record<AssistantId, ReactNode> = {
  opencode: <path d="M8.5 4.5C6.8 4.5 6 5.3 6 7v2.6c0 1.3-.7 2.4-2 2.4 1.3 0 2 1.1 2 2.4V17c0 1.7.8 2.5 2.5 2.5M15.5 4.5c1.7 0 2.5.8 2.5 2.5v2.6c0 1.3.7 2.4 2 2.4-1.3 0-2 1.1-2 2.4V17c0 1.7-.8 2.5-2.5 2.5" />,
  claude: <path d="M12 3.5v17M3.5 12h17M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7" />,
  gemini: <path d="M12 2.5c.7 5 4.5 8.8 9.5 9.5-5 .7-8.8 4.5-9.5 9.5-.7-5-4.5-8.8-9.5-9.5 5-.7 8.8-4.5 9.5-9.5z" fill="currentColor" stroke="none" />,
  codex: <path d="M5.5 7l5 5-5 5M12.5 17.5h6" />,
  // Lift.
  antigravity: <path d="M6 12.5l6-6 6 6M6 18.5l6-6 6 6" />,
};

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

export function AssistantMark({ id, size = 34 }: { id: AssistantId; size?: number }) {
  return (
    <span className={`assistant-mark mark-${id}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }} aria-hidden>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[id]}
      </svg>
    </span>
  );
}

export type Tone = 'ok' | 'busy' | 'warn' | 'bad' | 'off';
type Agent = StudioState['agent'];

/** Where the chosen assistant is. */
export type Now = 'no-book' | 'starting' | 'installing' | 'signing-in' | 'running' | 'signed-out' | 'not-installed' | 'failed' | 'off';

export function nowOf(_id: AssistantId, agent: Agent, setup: AssistantSetup | undefined, hasBook: boolean, installing = false): Now {
  if (installing) return 'installing';
  if (!hasBook) return setup?.install ? 'not-installed' : 'no-book';
  if (agent.status === 'starting') return agent.signingIn ? 'signing-in' : 'starting';
  if (agent.status === 'ready') return 'running';
  // Not on the Mac yet: Foreword installs its own copy.
  if (agent.notInstalled || setup?.install) return 'not-installed';
  if (agent.status !== 'error') return 'off';
  if (agent.signedOut) return 'signed-out';
  return 'failed';
}

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

const signedInWith = (s: AssistantSetup) => (s.account ? `Signed in with ${s.account}` : 'Signed in');

/** Where Foreword's own copy of each comes from (install.rs): always the maker's own release. */
export const FROM: Record<AssistantId, string> = {
  opencode: 'OpenCode’s own release, from GitHub',
  claude: 'Anthropic’s Claude Code with the connector editors use, from npm',
  codex: 'OpenAI’s Codex with the connector editors use, from npm',
  gemini: 'Google’s Gemini CLI, from npm',
  antigravity: 'Google’s connector for editors, from dl.google.com',
};
const SOURCE: Record<InstallPlan['source'], string> = { github: 'from GitHub', npm: 'from npm', google: 'from Google' };

/** A card's status line: how the chosen one is now; for the others, how they'd run. */
export function cardStatus(_id: AssistantId, now: Now | null, setup: AssistantSetup | undefined, model: string | null, version: string | null): { tone: Tone; text: string } {
  switch (now) {
    case 'no-book':
      return { tone: 'off', text: 'Starts when you open a book' };
    case 'starting':
      return { tone: 'busy', text: 'Starting…' };
    case 'installing':
      return { tone: 'busy', text: 'Installing…' };
    case 'signing-in':
      return { tone: 'busy', text: 'Signing in, in your browser…' };
    case 'running':
      return { tone: 'ok', text: model ? `Running · ${model}` : 'Running' };
    case 'signed-out':
      return { tone: 'warn', text: 'Not signed in' };
    case 'not-installed':
      return { tone: 'warn', text: setup?.install?.update ? 'Update to install' : 'Not installed' };
    case 'failed':
      return { tone: 'bad', text: 'Didn’t start' };
    case 'off':
      return { tone: 'off', text: 'Off' };
  }
  if (!setup) return { tone: 'off', text: 'Looking…' };
  if (setup.install) return { tone: 'off', text: `Not installed · ${megabytes(setup.install.bytes)} ${SOURCE[setup.install.source]}` };
  if (setup.signedIn === false) return { tone: 'warn', text: 'Not signed in' };
  if (setup.signedIn) return { tone: 'ok', text: signedInWith(setup) };
  const v = setup.version ?? version;
  return { tone: 'off', text: v ? `Installed · ${v}` : 'Installed' };
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

export function AssistantPage() {
  const settings = useStore(studio.store, (s) => s.settings);
  const agent = useStore(studio.store, (s) => s.agent);
  const hasBook = useStore(studio.store, (s) => !!s.workspace);
  const opencode = useStore(studio.store, (s) => s.tools?.opencode);
  const download = useStore(studio.store, (s) => s.assistantDownload);
  const [setups, setSetups] = useState<AssistantsSetup | null>(null);
  // Terminal was opened to sign in: on coming back, check again and start again (a new login, or a new OpenCode provider).
  const [waiting, setWaiting] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const chosen = settings.assistant;

  const refresh = useCallback(() => void ipc.assistantsStatus().then(setSetups, (e) => console.warn('assistants status', e)), []);
  // Again once it has started or failed: signing in elsewhere, or installing, changes what's true. And once a download is done.
  useEffect(refresh, [refresh, agent.status, !!download]);
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
  const installing = download?.kind === chosen && !download.error;
  const now = nowOf(chosen, agent, setup, hasBook, installing);
  const current = agent.model ? agent.models.find((m) => m.providerID === agent.model?.providerID && m.id === agent.model?.id) : undefined;
  const modelName = current?.name ?? agent.model?.id ?? null;
  const name = ASSISTANT_NAMES[chosen];

  const choose = (id: AssistantId) => studio.switchAssistant(id);
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
    installing: `Installing ${name}…`,
    'signing-in': 'Sign in with Google, in your browser.',
    running: `${name} is running.`,
    'signed-out': `${name} isn’t signed in.`,
    'not-installed': setup?.install?.update ? `${name} has an update to install.` : `${name} isn’t installed yet.`,
    failed: `${name} didn’t start.`,
    off: `${name} is off.`,
  };
  const tone: Record<Now, Tone> = {
    'no-book': 'off',
    starting: 'busy',
    installing: 'busy',
    'signing-in': 'busy',
    running: 'ok',
    'signed-out': 'warn',
    'not-installed': 'warn',
    failed: 'bad',
    off: 'off',
  };
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
            {hasBook && now !== 'starting' && now !== 'signing-in' && now !== 'installing' && now !== 'not-installed' && (
              <button className="small assistant-restart" onClick={() => void studio.restartAgent()}>
                <Icon name="refresh" size={12} /> Start again
              </button>
            )}
          </div>

          {now === 'signing-in' && (
            <div className="assistant-fix">
              <p>Your browser has opened Google’s sign-in page. Sign in there, and Antigravity starts. It keeps the login, so this is once.</p>
              <div className="assistant-fix-actions">
                <button className="small" onClick={() => void studio.restartAgent()}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {now === 'signed-out' && chosen === 'antigravity' && (
            <div className="assistant-fix">
              <p>Sign in once with your Google account, in your browser, and Antigravity keeps the login.</p>
              <div className="assistant-fix-actions">
                <button className="primary" onClick={() => void studio.signInWithGoogle()}>
                  Sign in with Google
                </button>
              </div>
              <p className="assistant-now-note">
                Or with Gemini Enterprise, a Gemini API key or Google Cloud: set <code>auth.type</code> in <code className="selectable">~/.gemini/antigravity-acp/settings.json</code>, then Start again.
              </p>
            </div>
          )}
          {now === 'signed-out' && chosen !== 'antigravity' && (
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
              {chosen === 'gemini' && (
                <p className="assistant-now-note">
                  With a personal Google account, use Antigravity, which Google made Gemini CLI’s successor.{' '}
                  <button className="link" onClick={() => choose('antigravity')}>
                    Switch to Antigravity
                  </button>
                </p>
              )}
            </div>
          )}
          {(now === 'not-installed' || now === 'installing') && <InstallPanel id={chosen} setup={setup} download={download?.kind === chosen ? download : null} />}
          {now === 'failed' && agent.error && <p className="assistant-error selectable">{agent.error}</p>}

          <div className="assistant-rows">
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
            ) : chosen === 'antigravity' ? (
              <Row label="Account">
                <span className="assistant-row-actions">
                  <span className={`assistant-account ${signedIn === false ? 'warn' : ''}`}>
                    {signedIn === true ? (setup ? signedInWith(setup) : 'Signed in') : signedIn === false ? 'Not signed in' : 'Checked when it starts'}
                  </span>
                  {now !== 'signed-out' && now !== 'signing-in' && (
                    <button className="small" disabled={!hasBook || !setup?.program} onClick={() => void studio.signInWithGoogle()}>
                      {signedIn ? 'Sign in again with Google…' : 'Sign in with Google…'}
                    </button>
                  )}
                </span>
                <span className="assistant-row-help">In your browser; Antigravity keeps the login.</span>
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
              <ProgramRow id={chosen} setup={setup} opencode={opencode} />
            </Row>
          </div>
        </div>
        <p className="settings-help">Switching keeps the chat, as switching models does: the other assistant carries the task on, and gets the chat so far with your next message. The model is chosen in the chat, under the message box.</p>
      </section>
    </>
  );
}

/** The program that runs it: OpenCode's, to choose (as Tinymist's and Git's in Tools); the others', the author's own or Foreword's copy. */
function ProgramRow({ id, setup, opencode }: { id: AssistantId; setup: AssistantSetup | undefined; opencode: ToolInfo | undefined }) {
  if (id === 'opencode') {
    return (
      <>
        <div className="assistant-tool">
          <ToolPicker tool="opencode" label="OpenCode" info={opencode} install="" notInstalled={null} />
        </div>
        <span className="assistant-row-help">Yours if you have OpenCode 2, otherwise Foreword’s own copy. Choose another and OpenCode starts again with it.</span>
      </>
    );
  }
  if (!setup) return <span className="muted">Looking…</span>;
  if (!setup.program) {
    return (
      <>
        <span>Not installed yet</span>
        <span className="assistant-row-help">
          Foreword installs its own copy: {FROM[id]}
          {setup.install ? `, about ${megabytes(setup.install.bytes)}` : ''}.
        </span>
      </>
    );
  }
  const version = setup.version ? `, ${setup.version}` : '';
  return (
    <>
      <span className="assistant-program">
        <span>{setup.ours ? `Foreword’s copy${version}` : `Yours${version}`}</span>
        <code className="selectable">{tildePath(setup.program)}</code>
      </span>
      <span className="assistant-row-help">
        {setup.ours ? `Installed by Foreword in its own folder: ${FROM[id]}.` : `Your own ${ASSISTANT_NAMES[id]}${id === 'claude' || id === 'codex' ? ', with Foreword’s copy of the connector editors use' : ''}.`} Foreword talks to it over the Agent Client Protocol.
        {id === 'antigravity' && (
          <>
            {' '}
            Using it, you agree to <TermsLink />.
          </>
        )}
      </span>
    </>
  );
}

function TermsLink() {
  return (
    <button className="link" onClick={() => void ipc.openUrl('https://antigravity.google/terms')}>
      Google’s Antigravity terms
    </button>
  );
}

/**
 * Foreword's own copy of an assistant, installed when the author asks: what
 * it is, where it comes from and how big; then its progress. The install is
 * the studio's, so it carries on with Settings closed; the assistant starts
 * when it's done.
 */
export function InstallPanel({ id, setup, download }: { id: AssistantId; setup: AssistantSetup | undefined; download: StudioState['assistantDownload'] }) {
  const plan = setup?.install;
  const name = ASSISTANT_NAMES[id];
  const working = !!download && !download.error;
  const total = download?.total ?? plan?.bytes ?? 0;
  const pct = working && total ? Math.min(100, Math.round(((download.received ?? 0) / total) * 100)) : 0;
  const checking = download?.step === 'checking';
  const program = id === 'claude' ? 'Claude Code' : 'Codex';
  return (
    <div className="assistant-fix">
      <p>
        {plan?.update ? `This release of Foreword uses a newer ${name}. ` : ''}Foreword installs its own copy of {name}: {FROM[id]}
        {plan ? `, about ${megabytes(plan.bytes)}` : ''}. It goes in Foreword’s own folder, and nothing else on your Mac changes.
        {plan?.yours && ` It runs your own ${program} (${tildePath(plan.yours)}), so it doesn’t download another.`}
        {plan?.node && ' Node.js, which runs its connector, comes too, from nodejs.org.'}
      </p>
      {working ? (
        <div className="download-progress" role="progressbar" aria-label={`Installing ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span className="download-bar">
            <span className={checking ? 'checking' : ''} style={{ width: `${checking ? 100 : pct}%` }} />
          </span>
          <span className="download-text">
            {checking
              ? id === 'antigravity'
                ? 'Checking Google’s signature…'
                : 'Checking it…'
              : `${download.step === 'node' ? 'Node.js: ' : ''}${megabytes(download.received ?? 0)}${total ? ` of ${download.step === 'node' ? '' : 'about '}${megabytes(total)}` : ''}`}
          </span>
        </div>
      ) : (
        <div className="assistant-fix-actions">
          <button className="primary" onClick={() => void studio.installAssistant(id)}>
            <Icon name="pull" size={14} /> {plan?.update ? `Update ${name}` : `Install ${name}`}
          </button>
          {id === 'antigravity' && (
            <span className="muted">
              Using it, you agree to <TermsLink />.
            </span>
          )}
        </div>
      )}
      {download?.error && <p className="assistant-error selectable">{download.error}</p>}
    </div>
  );
}
