// The rules an assistant keeps of its own: what it does without asking
// anyone, Foreword included, so the app never sees those requests. Claude
// Code keeps them in its settings files ("permissions": {"allow":
// ["Bash(npm run test:*)", "Edit"]}), in the book's .claude folder and in
// ~/.claude; Codex in its rules files (prefix_rule(pattern=["uv", "run"],
// decision="allow")). Foreword only shows them: they're the assistant's.

/** One of them, for the list: the command (or the tool, for one that isn't a command), and whether it covers what comes after. */
export type OwnRule = { text: string; command: boolean; more: boolean; effect: 'allow' | 'deny' };

/** Claude Code's settings file: its allow and deny lists. */
export function claudeRules(text: string): OwnRule[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const permissions = (json as { permissions?: Record<string, unknown> } | null)?.permissions ?? {};
  const rules = (list: unknown, effect: OwnRule['effect']): OwnRule[] =>
    (Array.isArray(list) ? list : [])
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .map((x) => {
        const bash = /^Bash\((.*)\)$/s.exec(x.trim());
        if (!bash) return { text: x.trim(), command: false, more: false, effect };
        const more = /(:\*|\s\*)$/.test(bash[1]);
        return { text: bash[1].replace(/(:\*|\s\*)$/, ''), command: true, more, effect };
      });
  return [...rules(permissions.allow, 'allow'), ...rules(permissions.deny, 'deny')];
}

/** Codex's rules file: a prefix_rule per line, its words a prefix of the command. */
export function codexRules(text: string): OwnRule[] {
  const out: OwnRule[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*prefix_rule\(\s*pattern\s*=\s*\[(.*)\]\s*,\s*decision\s*=\s*"(\w+)"/s.exec(line);
    if (!m || (m[2] !== 'allow' && m[2] !== 'forbidden' && m[2] !== 'deny')) continue;
    const words = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((w) => {
      try {
        return JSON.parse(`"${w[1]}"`) as string;
      } catch {
        return w[1];
      }
    });
    // A command a shell was given whole is the command it runs.
    const shell = words.length === 3 && /(^|\/)(ba|z)?sh$/.test(words[0]) && /^-\w*c$/.test(words[1]);
    if (words.length) out.push({ text: shell ? words[2] : words.join(' '), command: true, more: true, effect: m[2] === 'allow' ? 'allow' : 'deny' });
  }
  return out;
}
