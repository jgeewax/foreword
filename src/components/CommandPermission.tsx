// Asking to run a command, in the chat: what it runs, each part of it named
// ("through uv", "Python", "the script, in this book"), what it reaches beyond
// the book, and the answers: once, always (a rule, as narrow or as broad as you
// choose, for this task, this book or every book), or not, with what to do
// instead. Afterwards, the answer stays as a line with the rule it made and
// Undo; a command a rule let through carries "by your rule" (RuleChip).
import { useMemo, useState } from 'react';
import { commandAnatomy, commandFacts, type Anatomy, type Fact, type RuleChoice } from '../app/command-anatomy';
import { describeCommand } from '../app/command-words';
import type { BookNames } from '../app/tool-labels';
import { ASSISTANT_NAMES } from '../app/settings';
import { studio, type ChatItem } from '../app/studio';
import { useStore } from '../lib/store';
import { coversMore, ruleCommand, type CommandRule, type RuleScope } from '../services/agent/command-rules';
import { PERMISSION_ITEMS, type AgentPermissions } from '../services/agent/permissions';
import { splitCommands, tokens } from '../services/agent/shell-words';
import { Icon, type IconName } from './icons';

type PermissionItem = Extract<ChatItem, { kind: 'permission' }>;

export const SCOPES: { id: RuleScope; label: string }[] = [
  { id: 'task', label: 'This task' },
  { id: 'book', label: 'This book' },
  { id: 'all', label: 'Every book' },
];

export const scopeWords = (scope: RuleScope, book: string) => (scope === 'task' ? 'for the rest of this task' : scope === 'book' ? `in ${book}` : 'in every book');

const scopeHelp = (scope: RuleScope, book: string) =>
  scope === 'task' ? 'Until this task ends; nothing is kept.' : scope === 'book' ? `Only in ${book}, until you remove it.` : 'In every book on this Mac, until you remove it.';

/** Where the last "always" went, for the next one. */
const SCOPE_KEY = 'studio.ruleScope';
function lastScope(): RuleScope {
  try {
    const s = localStorage.getItem(SCOPE_KEY);
    return s === 'task' || s === 'book' || s === 'all' ? s : 'book';
  } catch {
    return 'book';
  }
}

/** The rules and settings a card depends on, as one value to watch. */
function useRulesVersion() {
  return useStore(studio.store, (s) =>
    JSON.stringify([s.settings.alwaysAllow, s.settings.neverAllow, s.settings.permissions, s.project.settings.alwaysAllow, s.project.settings.neverAllow, s.taskRules, s.agent.mode]),
  );
}

/** A rule's command, with "anything" for what it lets come after it. */
export function RulePattern({ pattern, effect = 'allow' }: { pattern: string; effect?: 'allow' | 'deny' }) {
  return (
    <span className={`rule-pattern ${effect}`}>
      <code>{ruleCommand(pattern)}</code>
      {coversMore(pattern) && <span className="rule-any">anything</span>}
    </span>
  );
}

/** The commands of a request (a line the shell is given whole, opened; a here-document kept with its command). */
function commandsOf(resources: string[]): { commands: string[]; wrappedIn?: string } {
  let wrappedIn: string | undefined;
  const commands = resources.flatMap((r) => {
    const a = commandAnatomy(r);
    wrappedIn ??= a.wrappedIn;
    return /<<-?\s*['"]?\w+/.test(a.command) ? [a.command] : splitCommands(a.command);
  });
  return { commands: [...new Set(commands)], wrappedIn };
}

/** The code a part holds (`-c '…'`, a here-document's lines). */
function codeOf(text: string): string {
  if (text.startsWith('<<')) return text.split('\n').slice(1, -1).join('\n');
  return tokens(text)[1]?.value ?? text;
}

/** Why it asks: the kind of action that's set to ask, or a file it writes. */
function whyAsking(commands: string[], facts: Fact[], p: AgentPermissions): string | null {
  const key: keyof AgentPermissions = facts.some((f) => f.kind === 'deletes') ? 'delete' : commands.some((c) => /^(git )?mv\s/.test(c)) ? 'move' : 'shell';
  const item = PERMISSION_ITEMS.find((i) => i.key === key)!;
  if (p[key] === 'ask') return `Asking because “${item.label}” is set to Ask.`;
  if (facts.some((f) => f.kind === 'writes' || f.kind === 'outside')) return 'Asking because it writes into a file.';
  return null;
}

const FACT_ICONS: Record<Fact['kind'], IconName> = { internet: 'cloud', writes: 'edit', outside: 'folder', deletes: 'warning' };

/** A command, part by part, with what each part is under it; with a rule chosen, what the rule fixes and what it leaves open. */
function CommandParts({ anatomy, cover }: { anatomy: Anatomy; cover?: string }) {
  const [allCode, setAllCode] = useState(false);
  const fixedTo = cover ? ruleCommand(cover).length : 0;
  const open = cover ? coversMore(cover) : false;
  const code = anatomy.parts.find((p) => p.kind === 'code');
  const lines = code ? codeOf(code.text).split('\n') : [];
  const shown = allCode ? lines : lines.slice(0, 8);
  return (
    <div className="cmd-anatomy">
      {anatomy.wrappedIn && (
        <div className="cmd-wrapped">
          Given to <code>{anatomy.wrappedIn}</code> whole; shown as it runs.
        </div>
      )}
      <div className="cmd-line">
        <span className="cmd-prompt" aria-hidden>
          $
        </span>
        <div className="cmd-parts">
          {anatomy.parts.map((p, i) => {
            const state = !cover ? '' : p.end <= fixedTo || !open ? ' fixed' : ' any';
            return (
              <span key={i} className={`cmd-part kind-${p.kind}${state}`}>
                <code>
                  {p.kind === 'code' ? (
                    `${p.text.startsWith('<<') ? p.text.split('\n')[0] : tokens(p.text)[0]?.raw} …`
                  ) : (
                    <>
                      {p.dir && <span className="cmd-dir">{p.dir}</span>}
                      {p.text}
                    </>
                  )}
                </code>
                <span className="cmd-label">{state === ' any' ? (p.kind === 'code' ? 'any code' : 'anything') : p.label}</span>
              </span>
            );
          })}
        </div>
      </div>
      {code && (
        <div className="cmd-code">
          <pre>
            {shown.map((l, i) => (
              <div key={i}>
                <span className="cmd-code-n">{i + 1}</span>
                {l || ' '}
              </div>
            ))}
          </pre>
          {lines.length > 8 && (
            <button className="link cmd-code-more" onClick={() => setAllCode(!allCode)}>
              {allCode ? 'Show less' : `Show all ${lines.length} lines`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A request to run a command: the card while it waits, the line it leaves once answered. */
export function CommandPermission({ item }: { item: PermissionItem }) {
  useRulesVersion();
  const root = useStore(studio.store, (s) => s.workspace?.root);
  const book = useStore(studio.store, (s) => s.workspace?.name ?? 'this book');
  const names = useStore(studio.store, (s) => s.names);
  const assistant = useStore(studio.store, (s) => ASSISTANT_NAMES[s.settings.assistant]);
  const permissions = useStore(studio.store, (s) => s.settings.permissions);
  const latest = useStore(studio.store, (s) => s.agent.items.filter((i) => i.kind === 'permission').at(-1)?.id === item.id);
  const { commands, wrappedIn } = useMemo(() => commandsOf(item.resources), [item.resources]);
  const pending = item.state === 'pending' || item.state === 'sending';
  const statuses = commands.map((c) => studio.commandStatus(c));
  const asking = commands.filter((_, i) => statuses[i] === 'asks');
  const main = useMemo(() => {
    const c = asking[0] ?? commands.find((_, i) => statuses[i] !== 'looks') ?? commands[0] ?? '';
    return { ...commandAnatomy(c, root), wrappedIn };
  }, [asking.join('\n'), commands.join('\n'), root, wrappedIn]);
  const anatomies = useMemo(() => asking.map((c) => commandAnatomy(c, root)), [asking.join('\n'), root]);
  const facts = useMemo(() => commandFacts(asking.length ? asking.join('\n') : commands.join('\n'), root), [asking.join('\n'), commands.join('\n'), root]);

  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [scope, setScope] = useState<RuleScope>(lastScope);
  const withChoices = anatomies.filter((a) => a.choices.length);
  const chosen = withChoices.map((a, k) => a.choices.find((c) => c.pattern === picks[k]) ?? a.choices.find((c) => c.suggested) ?? a.choices[0]);

  const runs = <strong>{main.name}</strong>;
  if (!pending) return <CommandRecord item={item} runs={runs} anatomy={main} assistant={assistant} book={book} latest={latest} />;

  const interpreted = main.inline || main.parts.some((p) => p.kind === 'script' || p.kind === 'module');
  const words = describeCommand(main.command, names).ask;
  const several = commands.length > 1;
  const title = several ? (
    <>
      {assistant} wants to run {commands.length} commands.{' '}
      <span className="permission-quiet">{asking.length === 1 ? 'One needs you.' : asking.length ? `${asking.length} need you.` : ''}</span>
    </>
  ) : interpreted || words.startsWith('run the command') ? (
    <>
      {assistant} wants to run {runs}
      <span className="permission-quiet">{main.what}</span>
    </>
  ) : (
    <>
      {assistant} wants to {words}
    </>
  );
  const why = whyAsking(asking, facts, permissions);
  const inlineOnly = anatomies.length > 0 && withChoices.length === 0;
  const mentionsBook = anatomies.some((a) => a.inline && /\.(typ|md|bib|ya?ml|toml|csv|txt)\b/.test(a.command));
  const sending = item.state === 'sending';
  const cover = (k: number) => (open ? chosen[k]?.pattern : undefined);
  const alwaysName = withChoices.length !== 1 ? 'these' : withChoices[0].inline ? codeWords(withChoices[0]) : withChoices[0].name;

  const confirm = () => {
    try {
      localStorage.setItem(SCOPE_KEY, scope);
    } catch {
      // Remembering the place is a nicety.
    }
    void studio.replyPermission(item.id, 'always', { patterns: chosen.map((c) => c.pattern), scope, label: chosen.map((c) => phrase(c)).join(' and ') });
  };

  return (
    <div className="permission pending command">
      <div className="permission-title">{title}</div>
      {several ? (
        <div className="cmd-list">
          {commands.map((c, i) => {
            const s = statuses[i];
            const k = asking.indexOf(c);
            return (
              <div key={c} className={`cmd-row ${s}`}>
                <span className="cmd-row-mark" aria-hidden>
                  {s === 'asks' ? <span className="cmd-row-dot" /> : s === 'never' ? <Icon name="close" size={12} /> : <Icon name="check" size={12} />}
                </span>
                <div className="cmd-row-body">
                  <div className="cmd-row-words">
                    {rowWords(c, names)}
                    {s !== 'asks' && <span className="permission-quiet"> · {s === 'looks' ? 'only looks' : s === 'rule' ? 'your rule' : s === 'never' ? 'never allowed' : 'allowed'}</span>}
                  </div>
                  {s === 'asks' && k >= 0 ? <CommandParts anatomy={anatomies[k]} cover={withChoices.includes(anatomies[k]) ? cover(withChoices.indexOf(anatomies[k])) : undefined} /> : <code className="cmd-row-code">{c}</code>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <CommandParts anatomy={anatomies[0] ? { ...anatomies[0], wrappedIn } : main} cover={cover(0)} />
      )}
      {facts.length > 0 && (
        <div className="cmd-facts">
          {facts.map((f) => (
            <span key={f.text} className={`cmd-fact ${f.kind}`}>
              <Icon name={FACT_ICONS[f.kind]} size={11} />
              {f.text}
            </span>
          ))}
        </div>
      )}
      {(why || !item.local) && (
        <div className="permission-why">
          {why ?? 'Asking because you chose to be asked first.'}{' '}
          <button className="link" onClick={() => studio.openSettings('permissions')}>
            Change
          </button>
        </div>
      )}
      {inlineOnly && <div className="perm-note">New code every time, so there’s no “always” for it.</div>}
      <div className="permission-actions">
        <button className="primary" disabled={sending} title="Just this once; it asks again next time" onClick={() => void studio.replyPermission(item.id, 'once')}>
          Allow once
        </button>
        {withChoices.length > 0 && (
          <button className={`perm-always-toggle${open ? ' open' : ''}`} disabled={sending} aria-expanded={open} onClick={() => setOpen(!open)}>
            Always allow {alwaysName}…
            <Icon name="chevronDown" size={11} />
          </button>
        )}
        {mentionsBook && (
          <button
            disabled={sending}
            title="Turn this down, and ask it to change the book with its editing tool, so you see each change"
            onClick={() =>
              void studio.replyPermission(item.id, 'reject').then(() => studio.send('Please make that change by editing the file instead of running code, so I can see each change.', { delivery: 'steer' }))
            }
          >
            Ask it to edit instead
          </button>
        )}
        <button className="ghost" disabled={sending} onClick={() => void studio.replyPermission(item.id, 'reject')}>
          Don’t allow
        </button>
      </div>
      {open && withChoices.length > 0 && (
        <div className="perm-builder">
          {withChoices.map((a, k) => (
            <fieldset key={a.command} className="perm-choices">
              <legend>{withChoices.length > 1 ? `For ${a.name}, never ask again for` : 'Never ask again for'}</legend>
              <div className="perm-choice-list">
                {a.choices.map((c) => (
                  <ChoiceRow key={c.pattern} choice={c} name={`${item.id}-${k}`} selected={chosen[k]?.pattern === c.pattern} onPick={() => setPicks((p) => Object.assign([...p], { [k]: c.pattern }))} />
                ))}
              </div>
            </fieldset>
          ))}
          <div className="perm-where">Where</div>
          <div className="perm-scope" role="radiogroup" aria-label="Where the rule applies">
            {SCOPES.map((s) => (
              <button key={s.id} role="radio" aria-checked={scope === s.id} className={scope === s.id ? 'active' : ''} onClick={() => setScope(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="perm-scope-help">{scopeHelp(scope, book)}</div>
          {facts.some((f) => f.kind === 'writes' || f.text.startsWith('Writes outside')) && chosen.some((c) => coversMore(c.pattern)) && (
            <div className="perm-note">Writing into a file with &gt; still asks each time.</div>
          )}
          {anatomies.some((a) => !a.choices.length) && <div className="perm-note">The code it wrote still asks each time.</div>}
          <div className="perm-confirm">
            <span>
              {assistant} won’t ask again for {chosen.map((c) => phrase(c)).join(' and ')}, {scopeWords(scope, book)}.
            </span>
            <button className="perm-confirm-button" disabled={sending} onClick={confirm}>
              Always allow
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One command of a line, in words, before it runs: "Search for “x” in chapters/", "Go into chapters/". */
function rowWords(command: string, names: BookNames): string {
  const cd = /^cd\s+(\S+)/.exec(command);
  const words = cd ? `go into ${cd[1].replace(/\/?$/, '/')}` : describeCommand(command, names).ask;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Code written on the spot, for "Always allow …": "Python code", "shell commands". */
const codeWords = (a: Anatomy) => (a.lang === 'shell' ? 'shell commands' : a.lang ? `${a.lang} code` : 'code like this');

/** A choice in a sentence: "lint.py, with any arguments", "this exact command", "any Python script, through uv". */
function phrase(c: RuleChoice): string {
  if (c.title === 'Exactly this command') return 'this exact command';
  return /^(Any|Anything|The) /.test(c.title) ? c.title.charAt(0).toLowerCase() + c.title.slice(1) : c.title;
}

function ChoiceRow({ choice, name, selected, onPick }: { choice: RuleChoice; name: string; selected: boolean; onPick: () => void }) {
  return (
    <label className={`perm-choice${selected ? ' selected' : ''}${choice.danger ? ' danger' : choice.risk ? ' risky' : ''}`}>
      <input type="radio" name={name} checked={selected} onChange={onPick} />
      <span className="perm-choice-text">
        <span className="perm-choice-title">
          {choice.title}
          {choice.suggested && <span className="perm-suggested">Suggested</span>}
        </span>
        <RulePattern pattern={choice.pattern} />
        {choice.risk && <span className="perm-risk">{choice.risk}</span>}
      </span>
    </label>
  );
}

/** The answer, as a line: once, by a rule, remembered (with its rule and Undo), or not (with what to do instead). */
function CommandRecord({ item, runs, anatomy, assistant, book, latest }: { item: PermissionItem; runs: React.ReactNode; anatomy: Anatomy; assistant: string; book: string; latest: boolean }) {
  const r = item.remembered;
  if (item.state === 'reject') {
    return (
      <div className="permission reject command">
        <div className="permission-title">
          You didn’t let {assistant} run {runs}.
        </div>
        <code className="perm-command-line">{anatomy.command}</code>
        {latest && <TellInstead assistant={assistant} />}
      </div>
    );
  }
  if (item.state === 'always' && r) {
    return (
      <div className="permission always command">
        <div className="permission-title">
          You let {assistant} run {runs}
          {r.removed ? '.' : ', and remembered it.'}
        </div>
        <div className="perm-remembered">
          {r.patterns.map((p) => (
            <RulePattern key={p} pattern={p} />
          ))}
          {r.patterns.length === 0 && <span>{r.label}</span>}
          <span className="permission-quiet">{scopeWords(r.scope, book)}</span>
          <button className="link" onClick={() => void studio.forgetRemembered(item.id, !!r.removed)}>
            {r.removed ? 'Put it back' : 'Undo'}
          </button>
        </div>
        {r.removed && <div className="perm-note">Rule removed: it asks again next time.</div>}
      </div>
    );
  }
  return (
    <div className="permission once command">
      <div className="permission-title">
        {item.byRule ? (
          <>
            Your {item.resources.some((r) => studio.rulesThatAllowed(r).length) ? 'rule' : 'settings'} let {assistant} run {runs}.
          </>
        ) : (
          <>
            You let {assistant} run {runs}
            {item.state === 'always' ? ' for this task.' : ' once.'}
          </>
        )}
      </div>
      <code className="perm-command-line">{anatomy.command}</code>
    </div>
  );
}

/** After a no: what to do instead, sent as a message (optional). */
function TellInstead({ assistant }: { assistant: string }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  if (sent) return null;
  return (
    <form
      className="perm-instead"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        void studio.send(text.trim());
        setSent(true);
      }}
    >
      <label>
        Tell {assistant} what to do instead <span className="permission-quiet">(optional)</span>
        <span className="perm-instead-row">
          <input value={text} placeholder="e.g. Fix the warnings by hand, don’t run scripts" onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={!text.trim()}>
            Send
          </button>
        </span>
      </label>
    </form>
  );
}

const when = (ms: number) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `at ${time}` : `on ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
};

/** On a command that ran without asking because of the author's rules: which, from when, used how often; Remove rule, with Undo. */
export function RuleChip({ command, at }: { command: string; at?: number }) {
  useRulesVersion();
  useStore(studio.store, (s) => s.ruleStats);
  const book = useStore(studio.store, (s) => s.workspace?.name ?? 'this book');
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState<CommandRule[] | null>(null);
  const rules = studio.rulesThatAllowed(command, at ?? Infinity);
  if (!rules.length && !removed) return null;
  const stats = rules.map((r) => studio.ruleStat(r));
  const made = stats.map((s) => s?.created ?? 0).filter(Boolean);
  const uses = stats.reduce((n, s) => n + (s?.uses ?? 0), 0);
  const last = Math.max(0, ...stats.map((s) => s?.last ?? 0));
  const remove = async () => {
    try {
      for (const r of rules) await studio.forgetCommands([r.pattern], r.scope, r.effect);
      setRemoved(rules);
    } catch (e) {
      studio.toast(`Couldn't remove the rule: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };
  const restore = async () => {
    for (const r of removed ?? []) await studio.rememberCommands([r.pattern], r.scope, r.effect);
    setRemoved(null);
  };
  return (
    <>
      <button className={`rule-chip${removed ? ' removed' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="shield" size={11} />
        {removed ? 'rule removed' : 'by your rule'}
      </button>
      {open && (
        <div className="rule-explain">
          {removed ? (
            <div>
              Rule removed: it asks before running this next time.{' '}
              <button className="link" onClick={() => void restore()}>
                Undo
              </button>
            </div>
          ) : (
            <>
              <div>
                It didn’t ask, because of {rules.length > 1 ? 'rules' : 'a rule'} you made{made.length ? ` ${when(Math.min(...made))}` : ''}:
              </div>
              <div className="perm-remembered">
                {rules.map((r) => (
                  <span key={r.pattern} className="rule-explain-rule">
                    <RulePattern pattern={r.pattern} />
                    <span className="permission-quiet">{scopeWords(r.scope, book)}</span>
                  </span>
                ))}
              </div>
              {uses > 0 && (
                <div className="permission-quiet">
                  Used {uses === 1 ? 'once' : `${uses} times`}
                  {last ? `, last ${when(last)}` : ''}.
                </div>
              )}
              <div className="rule-explain-actions">
                <button className="small" onClick={() => void remove()}>
                  Remove rule
                </button>
                <button className="small ghost" onClick={() => studio.openSettings('permissions')}>
                  All rules
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
