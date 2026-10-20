// What the assistant may do, as OpenCode session permission rules.
//
// OpenCode 2.x actions (verified against the server's built-in agents, 2.0.20):
// read, glob, grep, edit (also covers creating files), shell, external_directory
// (any path outside the project), webfetch, websearch, subagent, question.
// Rules are last-match-wins.
//
// Shell: OpenCode splits a command line into its commands and checks each one
// (`ls a && wc -l b; echo x | cat` asks about "ls a", "wc -l b", "echo x",
// "cat"; `$(…)` and backticks are checked on their own too). Redirections
// and flags stay in the command ("echo hi > f.txt"). Verified live, 2.0.20.

import { splitCommands } from './shell-words';
import { STUDIO_LOOK_TOOLS, STUDIO_TOOL_ACTION, STUDIO_TOOL_NAMES, STUDIO_TOOLS } from './studio-tool';

export type Level = 'allow' | 'ask' | 'deny';

export type AgentPermissions = {
  /** Edit and create files in the book. */
  edit: Level;
  /** Rename or move files (mv). */
  move: Level;
  /** Delete files (rm and friends). */
  delete: Level;
  /** Read or change files outside the book. */
  outside: Level;
  /** Any other terminal command. */
  shell: Level;
  /** Web search and fetching pages. */
  web: Level;
  /** Change Typst Studio's settings with its tools (studio-tools.ts): preferences, model, effort, mode, which assistant. */
  settings: Level;
};

export type PermissionRule = { action: string; resource: string; effect: Level };

export const PERMISSION_ITEMS: { key: keyof AgentPermissions; label: string; detail: string }[] = [
  { key: 'edit', label: 'Edit and create files', detail: 'Changes to the book’s files, and new files in it.' },
  { key: 'move', label: 'Rename or move files', detail: 'The mv command.' },
  { key: 'delete', label: 'Delete files', detail: 'rm and similar commands. History keeps a copy.' },
  { key: 'outside', label: 'Files outside this book', detail: 'Reading or changing other folders on this Mac.' },
  { key: 'shell', label: 'Run other commands', detail: 'Anything else in a terminal. Commands that only look (ls, cat, grep, git status…) always run; building the book is always blocked.' },
  { key: 'web', label: 'Search and read the web', detail: 'Web search and fetching pages.' },
  {
    key: 'settings',
    label: 'Change Typst Studio’s settings',
    detail: 'Preferences like the text size, and its own model, effort, mode or assistant, when you ask. Looking at them is always fine; these permissions are only yours to change.',
  },
];

export type PresetId = 'ask' | 'edit' | 'readonly';

export const PRESETS: Record<PresetId, { label: string; description: string; permissions: AgentPermissions }> = {
  ask: {
    label: 'Ask first',
    description: 'Asks before every change. You see each edit first.',
    permissions: { edit: 'ask', move: 'ask', delete: 'ask', outside: 'ask', shell: 'ask', web: 'ask', settings: 'ask' },
  },
  edit: {
    label: 'Edit freely',
    description: 'Edits, creates and renames files in the book, and changes Typst Studio’s settings, without asking; asks for the rest.',
    permissions: { edit: 'allow', move: 'allow', delete: 'ask', outside: 'ask', shell: 'ask', web: 'ask', settings: 'allow' },
  },
  readonly: {
    label: 'Read-only',
    description: 'Reads and answers, never changes anything.',
    permissions: { edit: 'deny', move: 'deny', delete: 'deny', outside: 'deny', shell: 'deny', web: 'ask', settings: 'deny' },
  },
};

export const DEFAULT_PERMISSIONS = PRESETS.ask.permissions;

export function presetOf(p: AgentPermissions): PresetId | 'custom' {
  for (const [id, preset] of Object.entries(PRESETS) as [PresetId, (typeof PRESETS)[PresetId]][]) {
    if ((Object.keys(p) as (keyof AgentPermissions)[]).every((k) => p[k] === preset.permissions[k])) return id;
  }
  return 'custom';
}

const LEVELS: Level[] = ['allow', 'ask', 'deny'];
export function sanitizePermissions(raw: unknown): AgentPermissions | null {
  if (!raw || typeof raw !== 'object') return null;
  const out = { ...DEFAULT_PERMISSIONS };
  for (const k of Object.keys(out) as (keyof AgentPermissions)[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (LEVELS.includes(v as Level)) out[k] = v as Level;
  }
  // From before there was a settings permission: as for editing files.
  if (!LEVELS.includes((raw as Record<string, unknown>).settings as Level)) out.settings = out.edit;
  return out;
}

/** The preview compiles live, so Typst build commands are always denied, last. */
export const NO_COMPILE_RULES: readonly PermissionRule[] = [
  { action: 'shell', resource: 'typst *', effect: 'deny' },
  { action: 'shell', resource: '*typst compile*', effect: 'deny' },
  { action: 'shell', resource: '*typst c *', effect: 'deny' },
  { action: 'shell', resource: '*typst watch*', effect: 'deny' },
  { action: 'shell', resource: '*typst w *', effect: 'deny' },
  { action: 'shell', resource: '*tinymist*', effect: 'deny' },
  // Book projects get a Makefile for the author; make would build the book too.
  { action: 'shell', resource: 'make', effect: 'deny' },
  { action: 'shell', resource: 'make *', effect: 'deny' },
  { action: 'shell', resource: '* make', effect: 'deny' },
  { action: 'shell', resource: '* make *', effect: 'deny' },
  { action: 'shell', resource: '*;make*', effect: 'deny' },
  { action: 'shell', resource: '*&&make*', effect: 'deny' },
];

/** The book's settings (its command rules) and Claude Code's (its own rules), in the book. */
const PERMISSION_FILES = ['.typst-studio.json', '*/.typst-studio.json', '.claude/*', '*/.claude/*'];

/** Plan and Options modes: no file changes and no commands, whatever the settings. */
export const READ_ONLY_RULES: readonly PermissionRule[] = [
  { action: 'edit', resource: '*', effect: 'deny' },
  { action: 'shell', resource: '*', effect: 'deny' },
];

/**
 * Commands that only look (list, read, search, compare) and never need asking:
 * in every mode, like the read and search tools. Each command of a chained
 * line is checked on its own, so `ls; rm x` still asks about `rm x`.
 */
export const LOOK_COMMANDS = [
  'ls', 'pwd', 'cd', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'du', 'tree', 'which', 'echo', 'printf', 'date', 'basename', 'dirname',
  'realpath', 'diff', 'cmp', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'sort', 'cut', 'tr', 'nl', 'column', 'jq', 'shasum', 'md5', 'true',
  'git status', 'git log', 'git diff', 'git show', 'git blame', 'git ls-files',
] as const;

const lookRules = (): PermissionRule[] =>
  LOOK_COMMANDS.flatMap((c) => [
    { action: 'shell', resource: c, effect: 'allow' },
    { action: 'shell', resource: `${c} *`, effect: 'allow' },
  ]);

/**
 * Forms of those commands that write after all: redirection into a file, find's
 * -delete/-exec, sort -o, --output. They fall back to the shell setting.
 */
const WRITING_FORMS = ['*>*', 'find *-delete*', 'find *-exec*', 'find *-ok*', 'find *-fprint*', 'find *-fls*', 'sort *-o*', '*--output*', 'tree *-o *'];
const writingRules = (effect: Level): PermissionRule[] => WRITING_FORMS.map((resource) => ({ action: 'shell', resource, effect }));

/** Shell patterns for a command at the start or after a separator ("cd x && rm y"). */
const commandPatterns = (cmds: string[]) => cmds.flatMap((c) => [`${c} *`, `* ${c} *`, `*;${c} *`, `*&&${c} *`, `*|${c} *`]);

/**
 * `extra`: the author's own rules on top of these (command-rules.ts: commands
 * they always or never allow, and what they allowed for this task). They win
 * over the kinds of action above them; read-only modes and the build commands
 * still win over an allow, and a "never" holds in every mode.
 */
export function sessionRules(p: AgentPermissions, readOnly = false, extra: readonly PermissionRule[] = []): PermissionRule[] {
  const studioEffect: Level = p.settings === 'ask' ? 'ask' : 'allow';
  return [
    // Anything not named below asks.
    { action: '*', resource: '*', effect: 'ask' },
    { action: 'read', resource: '*', effect: 'allow' },
    { action: 'glob', resource: '*', effect: 'allow' },
    { action: 'grep', resource: '*', effect: 'allow' },
    { action: 'list', resource: '*', effect: 'allow' },
    { action: 'read', resource: '*.env', effect: 'ask' },
    { action: 'read', resource: '*.env.*', effect: 'ask' },
    { action: 'external_directory', resource: '*', effect: p.outside },
    { action: 'edit', resource: '*', effect: p.edit },
    ...(p.edit === 'allow'
      ? ([
          { action: 'edit', resource: '*.env', effect: 'ask' },
          { action: 'edit', resource: '*.env.*', effect: 'ask' },
        ] as PermissionRule[])
      : []),
    { action: 'shell', resource: '*', effect: p.shell },
    ...lookRules(),
    ...writingRules(p.shell),
    ...commandPatterns(['mv', 'git mv']).map((resource): PermissionRule => ({ action: 'shell', resource, effect: p.move })),
    ...commandPatterns(['rm', 'rmdir', 'unlink', 'trash', 'git rm', 'shred']).map((resource): PermissionRule => ({ action: 'shell', resource, effect: p.delete })),
    { action: 'webfetch', resource: '*', effect: p.web },
    { action: 'websearch', resource: '*', effect: p.web },
    // Subagents run under their own allow-all rules. The question tool asks the author
    // (multiple choice or free text, in the chat): asking needs no permission.
    { action: 'subagent', resource: '*', effect: 'deny' },
    { action: 'task', resource: '*', effect: 'deny' },
    { action: 'question', resource: '*', effect: 'allow' },
    // Typst Studio's own tools: changing its settings is the author's call (never these rules: the tools can't);
    // looking at them, and opening Settings for the author, never needs asking. Never is the tools' own to
    // say: they refuse, with the reason, so the assistant can tell the author (a refusal here says nothing).
    { action: STUDIO_TOOL_ACTION, resource: '*', effect: studioEffect },
    ...STUDIO_LOOK_TOOLS.map((t): PermissionRule => ({ action: STUDIO_TOOL_ACTION, resource: t, effect: 'allow' })),
    ...STUDIO_TOOL_NAMES.map((t): PermissionRule => ({ action: `${STUDIO_TOOLS}_${t}`, resource: '*', effect: STUDIO_LOOK_TOOLS.includes(t) ? 'allow' : studioEffect })),
    ...authorRules(extra, p.shell),
    // Files that say what the assistant may do: changing them is the author's to allow, each time, whatever else is allowed.
    ...PERMISSION_FILES.map((resource): PermissionRule => ({ action: 'edit', resource, effect: p.edit === 'deny' ? 'deny' : 'ask' })),
    // Read-only: commands that only look still run; writing forms never do.
    ...(readOnly ? [...READ_ONLY_RULES, ...lookRules(), ...writingRules('deny'), ...extra.filter((r) => r.effect === 'deny')] : []),
    ...NO_COMPILE_RULES,
  ];
}

/**
 * The author's rules, allows before nevers. A rule that covers a command with
 * anything after it ("lint.py *") doesn't cover writing into a file with ">"
 * ("lint.py --help > ~/.zshrc"): that's for the setting for other commands.
 */
function authorRules(extra: readonly PermissionRule[], shell: Level): PermissionRule[] {
  const allows = extra.filter((r) => r.effect !== 'deny');
  const guards = allows.filter((r) => r.action === 'shell' && r.resource.endsWith(' *')).map((r): PermissionRule => ({ action: 'shell', resource: `${r.resource} *>*`.replace(/ \* \*>\*$/, ' *>*'), effect: shell }));
  return [...allows, ...guards, ...extra.filter((r) => r.effect === 'deny')];
}

/** OpenCode's wildcard matching for permission resources (`*` = any run of characters). */
export function ruleMatches(pattern: string, value: string): boolean {
  return new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's').test(value);
}

/** What `rules` say about one request: the last matching rule wins, as in OpenCode. */
export function ruleEffect(action: string, resource: string, rules: readonly PermissionRule[]): Level | null {
  let result: Level | null = null;
  for (const r of rules) if ((r.action === '*' || r.action === action) && ruleMatches(r.resource, resource)) result = r.effect;
  return result;
}

/** Redirections that write no file: into /dev/null, or one output into another (`2>&1`). */
export function withoutHarmlessRedirects(command: string): string {
  return command
    .replace(/(^|\s)(?:\d|&)?>>?\s*\/dev\/null(?=\s|$)/g, '$1')
    .replace(/(^|\s)\d?>&\d(?=\s|$)/g, '$1')
    // Spaces only: a newline ends a command, and must still split the line.
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * `sed -n '205,242p' file`: printing lines, which only looks. Models reach for
 * it to read part of a file. sed can also write (-i, the w command), so only
 * line addresses with p, and plain file names, count.
 */
const SED_PRINT = /^sed -n +(['"]?)\d+(,(\d+|\$))?p(;\d+(,(\d+|\$))?p)*\1( +[\w./-]+)+$/;

/**
 * Requests OpenCode asks about although they only look, which the app answers
 * for the author:
 * - with a ">" (OpenCode asks about any), when every redirection writes nothing
 *   ("ls figures 2>/dev/null") and the session's own rules allow the commands
 *   without them;
 * - `sed -n` printing line ranges of files.
 * Anything that could hide a command (`$(…)`, backticks) or still redirects
 * keeps asking.
 */
export function onlyLooks(action: string, resources: readonly string[], rules: readonly PermissionRule[]): boolean {
  if (action !== 'shell' || !resources.length) return false;
  return resources.every((r) => {
    if (/\$\(|`/.test(r)) return false;
    const parts = splitCommands(r).map(withoutHarmlessRedirects);
    return parts.length > 0 && parts.every((bare) => !/[<>]/.test(bare) && (SED_PRINT.test(bare) || ruleEffect('shell', bare, rules) === 'allow'));
  });
}

/** A short sentence for the chat when permissions change mid-conversation. */
export function describePermissions(p: AgentPermissions): string {
  const preset = presetOf(p);
  if (preset !== 'custom') return `Permissions: ${PRESETS[preset].label}. ${PRESETS[preset].description}`;
  // Lower case to go mid-sentence, but not the names in it ("Typst Studio").
  const by = (level: Level) => PERMISSION_ITEMS.filter((i) => p[i.key] === level).map((i) => i.label.charAt(0).toLowerCase() + i.label.slice(1));
  const parts = [
    by('allow').length ? `allowed: ${by('allow').join(', ')}` : '',
    by('ask').length ? `asks first: ${by('ask').join(', ')}` : '',
    by('deny').length ? `never: ${by('deny').join(', ')}` : '',
  ].filter(Boolean);
  return `Permissions changed (${parts.join('; ')}).`;
}
