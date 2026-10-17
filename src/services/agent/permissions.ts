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
};

export type PermissionRule = { action: string; resource: string; effect: Level };

export const PERMISSION_ITEMS: { key: keyof AgentPermissions; label: string; detail: string }[] = [
  { key: 'edit', label: 'Edit and create files', detail: 'Changes to the book’s files, and new files in it.' },
  { key: 'move', label: 'Rename or move files', detail: 'The mv command.' },
  { key: 'delete', label: 'Delete files', detail: 'rm and similar commands. History keeps a copy.' },
  { key: 'outside', label: 'Files outside this book', detail: 'Reading or changing other folders on this Mac.' },
  { key: 'shell', label: 'Run other commands', detail: 'Anything else in a terminal. Commands that only look (ls, cat, grep, git status…) always run; building the book is always blocked.' },
  { key: 'web', label: 'Search and read the web', detail: 'Web search and fetching pages.' },
];

export type PresetId = 'ask' | 'edit' | 'readonly';

export const PRESETS: Record<PresetId, { label: string; description: string; permissions: AgentPermissions }> = {
  ask: {
    label: 'Ask first',
    description: 'Asks before every change. You see each edit first.',
    permissions: { edit: 'ask', move: 'ask', delete: 'ask', outside: 'ask', shell: 'ask', web: 'ask' },
  },
  edit: {
    label: 'Edit freely',
    description: 'Edits, creates and renames files in the book without asking; asks for the rest.',
    permissions: { edit: 'allow', move: 'allow', delete: 'ask', outside: 'ask', shell: 'ask', web: 'ask' },
  },
  readonly: {
    label: 'Read-only',
    description: 'Reads and answers, never changes anything.',
    permissions: { edit: 'deny', move: 'deny', delete: 'deny', outside: 'deny', shell: 'deny', web: 'ask' },
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

const lookRules = (extra: readonly string[] = []): PermissionRule[] =>
  [...LOOK_COMMANDS, ...extra].flatMap((c) => [
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
 * `allowCommands`: more commands the author lets run without asking (from the
 * config file, e.g. "python3"), on top of LOOK_COMMANDS.
 */
export function sessionRules(p: AgentPermissions, readOnly = false, allowCommands: readonly string[] = []): PermissionRule[] {
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
    ...lookRules(allowCommands),
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
    // Read-only: commands that only look still run; writing forms never do.
    ...(readOnly ? [...READ_ONLY_RULES, ...lookRules(), ...writingRules('deny')] : []),
    ...NO_COMPILE_RULES,
  ];
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
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * OpenCode asks about any command with a ">" in it, so "ls figures 2>/dev/null"
 * asks although it only looks. True when, without the redirections that write
 * nothing, the session's own rules allow every command in the request; the app
 * then answers for the author. Anything else that could hide a command
 * (`$(…)`, backticks) or still redirects keeps asking.
 */
export function allowedWithoutRedirects(action: string, resources: readonly string[], rules: readonly PermissionRule[]): boolean {
  if (action !== 'shell' || !resources.length) return false;
  return resources.every((r) => {
    if (/\$\(|`/.test(r)) return false;
    const bare = withoutHarmlessRedirects(r);
    return !/[<>]/.test(bare) && ruleEffect('shell', bare, rules) === 'allow';
  });
}

/** A short sentence for the chat when permissions change mid-conversation. */
export function describePermissions(p: AgentPermissions): string {
  const preset = presetOf(p);
  if (preset !== 'custom') return `Permissions: ${PRESETS[preset].label}. ${PRESETS[preset].description}`;
  const by = (level: Level) => PERMISSION_ITEMS.filter((i) => p[i.key] === level).map((i) => i.label.toLowerCase());
  const parts = [
    by('allow').length ? `allowed: ${by('allow').join(', ')}` : '',
    by('ask').length ? `asks first: ${by('ask').join(', ')}` : '',
    by('deny').length ? `never: ${by('deny').join(', ')}` : '',
  ].filter(Boolean);
  return `Permissions changed (${parts.join('; ')}).`;
}
