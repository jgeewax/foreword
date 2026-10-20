// Commands the author lets run without asking, or never: rules made from a
// permission card ("Always allow…") or in Settings. They're kept as a person
// would type them, in the settings file (every book) and the book's
// .typst-studio.json (this book):
//
//   "alwaysAllow": ["uv run python src/scripts/lint.py *", "python3 scripts/figures.py --all"],
//   "neverAllow": ["git push *"]
//
// A rule is a command. Ending in " *", it also covers that command with
// anything after it; without, only the command exactly. A "*" elsewhere
// matches any run of characters, as in OpenCode's rules, which these become.
// A line of several commands is checked command by command, so a rule for
// "lint.py *" never covers "lint.py 17; rm -rf ~".
//
// Rules for one task (a conversation) live only as long as it does. The
// assistants' own "always" options are never used: they keep rules of their
// own (Claude Code in the book's .claude/settings.local.json, Codex in
// ~/.codex/rules) that the app couldn't show or take back.

import { ruleMatches, type Level, type PermissionRule } from './permissions';
import { splitCommands } from './shell-words';

export type RuleScope = 'task' | 'book' | 'all';
export type RuleEffect = 'allow' | 'deny';
export type CommandRuleLists = { alwaysAllow: string[]; neverAllow: string[] };

/** A rule with where it's kept. */
export type CommandRule = { pattern: string; effect: RuleEffect; scope: RuleScope };

export const NO_RULES: CommandRuleLists = { alwaysAllow: [], neverAllow: [] };

const MAX_RULES = 200;

/** A rule as kept, or null: one line, not too long, and more than wildcards. */
export function sanitizeRule(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const r = raw.trim();
  if (!r || /[\n\r]/.test(r) || r.length > 1000 || !/[^*?\s]/.test(r)) return null;
  return r;
}

export function sanitizeRules(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    const rule = sanitizeRule(r);
    if (rule && !out.includes(rule)) out.push(rule);
  }
  return out.slice(0, MAX_RULES);
}

/**
 * Rules from a settings object, and from the list there was before rules:
 * "allowCommands": ["python3"] let python3 run with anything after it.
 */
export function rulesFrom(raw: Record<string, unknown>): CommandRuleLists {
  const legacy = Array.isArray(raw.allowCommands) ? raw.allowCommands.filter((c): c is string => typeof c === 'string' && /^[\w.+-]+( [\w.+-]+)?$/.test(c.trim())).map((c) => `${c.trim()} *`) : [];
  return { alwaysAllow: sanitizeRules([...sanitizeRules(raw.alwaysAllow), ...legacy]), neverAllow: sanitizeRules(raw.neverAllow) };
}

/** Whether a rule also covers what comes after its command ("lint.py *"). */
export const coversMore = (pattern: string) => /\s\*$/.test(pattern);

/** The command a rule names, without the trailing " *". */
export const ruleCommand = (pattern: string) => pattern.replace(/\s+\*$/, '');

/** A rule as OpenCode permission rules: the command alone, and with more after it when it ends in " *". */
export function permissionRulesOf(pattern: string, effect: Level): PermissionRule[] {
  const command = ruleCommand(pattern);
  return coversMore(pattern)
    ? [
        { action: 'shell', resource: command, effect },
        { action: 'shell', resource: `${command} *`, effect },
      ]
    : [{ action: 'shell', resource: pattern, effect }];
}

/** Every rule as permission rules: allows first, so a "never" for the same command wins. */
export function commandPermissionRules(rules: readonly CommandRule[]): PermissionRule[] {
  return [...rules.filter((r) => r.effect === 'allow'), ...rules.filter((r) => r.effect === 'deny')].flatMap((r) => permissionRulesOf(r.pattern, r.effect));
}

/** Whether a rule covers one command (not a line of several). */
export function ruleCovers(pattern: string, command: string): boolean {
  return permissionRulesOf(pattern, 'allow').some((r) => ruleMatches(r.resource, command.trim()));
}

/**
 * The author's rules that let a command line run: for each of its commands,
 * the last rule that covers it ("never" over "always", as they apply). Empty
 * when a part is hidden from rules (`$(…)`, backticks).
 */
export function rulesUsed(line: string, rules: readonly CommandRule[]): CommandRule[] {
  if (/\$\(|`|<\(|>\(/.test(line)) return [];
  const used: CommandRule[] = [];
  for (const part of splitCommands(line)) {
    const deny = rules.filter((r) => r.effect === 'deny' && ruleCovers(r.pattern, part)).at(-1);
    const rule = deny ?? rules.filter((r) => r.effect === 'allow' && ruleCovers(r.pattern, part)).at(-1);
    if (rule && !used.includes(rule)) used.push(rule);
  }
  return used;
}

/** Where a rule's uses are counted (in the app, not in the settings files): its scope, which book or task, and itself. */
export const ruleKey = (r: { pattern: string; effect: RuleEffect; scope: RuleScope }, where = '') => `${r.scope}:${where}:${r.effect}:${r.pattern}`;
