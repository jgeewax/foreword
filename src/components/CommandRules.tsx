// The author's rules for commands, by where they apply: this task, this book,
// every book. Each says how often it has let a command run, and can be
// removed (with Undo) or, in Settings, added. Below them, what never asks or
// never runs whatever the rules, and the rules the assistant keeps of its own,
// which Foreword can only show.
import { useEffect, useState } from 'react';
import { commandAnatomy } from '../app/command-anatomy';
import { ASSISTANT_NAMES } from '../app/settings';
import { studio } from '../app/studio';
import { ipc } from '../lib/ipc';
import { useStore } from '../lib/store';
import type { OwnRule } from '../services/agent/assistant-rules';
import { coversMore, ruleCommand, sanitizeRule, type CommandRule, type RuleEffect, type RuleScope } from '../services/agent/command-rules';
import { LOOK_COMMANDS } from '../services/agent/permissions';
import { RulePattern } from './CommandPermission';
import { Icon } from './icons';

/** A rule in words: "lint.py, with any arguments", "figures.py, exactly as written", "Python code it writes". */
export function ruleTitle(r: { pattern: string; effect: RuleEffect }): string {
  const a = commandAnatomy(ruleCommand(r.pattern));
  const code = a.inline && a.lang && coversMore(r.pattern) ? (a.lang === 'shell' ? 'Shell commands it writes' : `${a.lang} code it writes`) : null;
  const what = code ?? (coversMore(r.pattern) ? `${a.name}, with any arguments` : a.name === a.command ? a.name : `${a.name}, exactly as written`);
  return r.effect === 'deny' ? `Never ${what}` : what;
}

const when = (ms: number) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const sameRule = (a: CommandRule, b: CommandRule) => a.pattern === b.pattern && a.scope === b.scope && a.effect === b.effect;

export function CommandRules({ scopes, add = [], builtIn = false, own = false }: { scopes: RuleScope[]; add?: RuleScope[]; builtIn?: boolean; own?: boolean }) {
  // The rules, and how they've been used, as they change.
  useStore(studio.store, (s) => JSON.stringify([s.settings.alwaysAllow, s.settings.neverAllow, s.project.settings.alwaysAllow, s.project.settings.neverAllow, s.taskRules, s.agent.taskId]));
  useStore(studio.store, (s) => s.ruleStats);
  const book = useStore(studio.store, (s) => s.workspace?.name ?? null);
  const task = useStore(studio.store, (s) => s.agent.taskId);
  const [gone, setGone] = useState<CommandRule[]>([]);
  const rules = studio.commandRules();
  const groups = scopes
    .filter((scope) => (scope === 'task' ? !!task : scope === 'book' ? !!book : true))
    .map((scope) => ({ scope, rules: [...rules.filter((r) => r.scope === scope), ...gone.filter((g) => g.scope === scope && !rules.some((r) => sameRule(r, g)))] }));

  const remove = async (r: CommandRule) => {
    try {
      await studio.forgetCommands([r.pattern], r.scope, r.effect);
      setGone((g) => [...g, r]);
    } catch (e) {
      studio.toast(`Couldn't remove the rule: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };
  const restore = async (r: CommandRule) => {
    try {
      await studio.rememberCommands([r.pattern], r.scope, r.effect);
      setGone((g) => g.filter((x) => !sameRule(x, r)));
    } catch (e) {
      studio.toast(`Couldn't put the rule back: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };

  return (
    <div className="command-rules">
      {groups.map(({ scope, rules: list }) => (
        <section key={scope} className="rule-group">
          <div className="rule-group-head">
            <span className="rule-group-title">{scope === 'task' ? 'This task' : scope === 'book' ? 'This book' : 'Every book'}</span>
            <span className="rule-group-note">{scope === 'task' ? 'until it ends' : scope === 'book' ? book : 'on this Mac'}</span>
          </div>
          {list.length === 0 ? (
            <div className="rule-empty">{scope === 'task' ? 'None. “Always allow…” on a request can make one for this task.' : 'None yet.'}</div>
          ) : (
            <ul className="rule-list">
              {list.map((r) => {
                const removed = gone.some((g) => sameRule(g, r)) && !rules.some((x) => sameRule(x, r));
                const stat = studio.ruleStat(r);
                const usage = !stat ? '' : stat.uses ? `${stat.uses === 1 ? 'used once' : `used ${stat.uses} times`}${stat.last ? ` · ${when(stat.last)}` : ''}` : 'not used yet';
                return (
                  <li key={`${r.effect}:${r.pattern}`} className={`rule-row ${r.effect}${removed ? ' removed' : ''}`}>
                    <span className="rule-mark" aria-hidden>
                      <Icon name={r.effect === 'allow' ? 'check' : 'close'} size={11} />
                    </span>
                    <div className="rule-text">
                      <div className="rule-title">{ruleTitle(r)}</div>
                      <RulePattern pattern={r.pattern} effect={r.effect} />
                      {usage && !removed && <div className="rule-meta">{usage}</div>}
                    </div>
                    {removed ? (
                      <>
                        <span className="rule-meta">Removed</span>
                        <button className="link" onClick={() => void restore(r)}>
                          Undo
                        </button>
                      </>
                    ) : (
                      <button className="icon rule-remove" aria-label={`Remove the rule ${r.pattern}`} title="Remove this rule" onClick={() => void remove(r)}>
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
      {add.length > 0 && <AddRule scopes={add.filter((s) => s !== 'book' || !!book)} />}
      {builtIn && (
        <section className="rule-group">
          <div className="rule-group-head">
            <span className="rule-group-title">Built in</span>
          </div>
          <ul className="rule-list">
            <li className="rule-row builtin look">
              <span className="rule-mark" aria-hidden>
                <Icon name="eye" size={11} />
              </span>
              <div className="rule-text">
                <div className="rule-title">Commands that only look never ask</div>
                <div className="rule-meta">
                  {LOOK_COMMANDS.slice(0, 4).join(', ')} and {LOOK_COMMANDS.length - 4} more
                </div>
              </div>
            </li>
            <li className="rule-row builtin deny">
              <span className="rule-mark" aria-hidden>
                <Icon name="close" size={11} />
              </span>
              <div className="rule-text">
                <div className="rule-title">Building the book never runs</div>
                <div className="rule-meta">typst, tinymist, make: the preview builds it</div>
              </div>
            </li>
          </ul>
        </section>
      )}
      {own && <AssistantOwnRules />}
      <p className="rule-footnote">A rule covers one command at a time: never a chain of commands as a whole, or what’s inside $(…).</p>
    </div>
  );
}

/** A rule typed in: a command, ending in " *" for anything after it; always or never; here or in every book. */
function AddRule({ scopes }: { scopes: RuleScope[] }) {
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<RuleScope>(scopes[0] ?? 'all');
  const rule = sanitizeRule(draft);
  const add = async (effect: RuleEffect) => {
    if (!rule) return;
    try {
      await studio.rememberCommands([rule], scope, effect);
      setDraft('');
    } catch (e) {
      studio.toast(`Couldn't add the rule: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };
  if (!scopes.length) return null;
  return (
    <form
      className="rule-add"
      onSubmit={(e) => {
        e.preventDefault();
        void add('allow');
      }}
    >
      <input className="settings-input" aria-label="A command" placeholder="e.g. python3 scripts/figures.py *" value={draft} onChange={(e) => setDraft(e.target.value)} />
      {scopes.length > 1 && (
        <select className="settings-input" aria-label="Where" value={scope} onChange={(e) => setScope(e.target.value as RuleScope)}>
          {scopes.map((s) => (
            <option key={s} value={s}>
              {s === 'book' ? 'This book' : 'Every book'}
            </option>
          ))}
        </select>
      )}
      <button type="submit" disabled={!rule}>
        Always allow
      </button>
      <button type="button" disabled={!rule} onClick={() => void add('deny')}>
        Never
      </button>
      <span className="rule-add-help">End with * for anything after the command; without, only exactly that.</span>
    </form>
  );
}

const PROGRAMS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };

/** The assistant's own rules: it acts on these without asking, so Foreword never sees those requests. Read only. */
function AssistantOwnRules() {
  const assistant = useStore(studio.store, (s) => s.settings.assistant);
  const root = useStore(studio.store, (s) => s.workspace?.root);
  const [files, setFiles] = useState<{ path: string; inBook: boolean; rules: OwnRule[] }[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    void studio.assistantOwnRules().then((f) => live && setFiles(f));
    return () => {
      live = false;
    };
  }, [assistant, root]);
  const rules = files.flatMap((f) => f.rules);
  if (!rules.length) return null;
  const program = PROGRAMS[assistant] ?? ASSISTANT_NAMES[assistant];
  const shown = all ? rules : rules.slice(0, 6);
  const elsewhere = files.some((f) => !f.inBook);
  const home = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');
  return (
    <section className="own-rules">
      <div className="own-rules-head">
        <Icon name="warning" size={14} />
        <span>
          {program} has {rules.length === 1 ? 'a rule' : `${rules.length} rules`} of its own
        </span>
      </div>
      <p>
        It does these without asking, so Foreword never sees them first.{elsewhere ? ' Those outside the book apply in every project you use it in.' : ''} They’re {program}’s, from before or from using it
        elsewhere: change them there.
      </p>
      <ul className="own-rules-list">
        {shown.map((r, i) => (
          <li key={i} title={r.text}>
            {r.command ? <RulePattern pattern={`${r.text.split('\n')[0]}${r.text.includes('\n') ? ' …' : ''}${r.more ? ' *' : ''}`} /> : <code>{r.text}</code>}
          </li>
        ))}
      </ul>
      <div className="own-rules-actions">
        {rules.length > 6 && (
          <button className="link" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${rules.length}`}
          </button>
        )}
        {files.map((f) => (
          <button key={f.path} className="link" onClick={() => void (f.inBook ? studio.openFile(f.path) : ipc.assistantRuleReveal(assistant, f.path))}>
            {f.inBook ? `Open ${f.path}` : `Show ${home(f.path)} in Finder`}
          </button>
        ))}
      </div>
    </section>
  );
}
