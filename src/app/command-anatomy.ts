// A command taken apart for the permission card: each part with what it is,
// written under it ("through uv", "Python", "the script, in this book",
// "argument"), and the rules it could become, narrowest first: exactly this
// command, the script with any arguments, any Python, anything through uv.
// So "uv run python src/scripts/lint.py 17" reads as running lint.py, not as
// running "uv".

import { tokens, type Token } from '../services/agent/shell-words';

export type PartKind = 'env' | 'wrapper' | 'program' | 'interpreter' | 'script' | 'module' | 'code' | 'subcommand' | 'args';

/** A run of the command's words: as typed (a script's folder apart, to show quieter), what it is, and where it ends in the command. */
export type Part = { kind: PartKind; text: string; dir?: string; label: string; end: number };

/** A rule the card offers: its pattern (command-rules.ts), in words, and what to know before choosing it. */
export type RuleChoice = { pattern: string; title: string; risk?: string; danger?: boolean; suggested?: boolean };

export type Anatomy = {
  /** The command (inside its shell, when it came as `zsh -lc "…"`). */
  command: string;
  /** "zsh -lc", when the command came wrapped in a shell. */
  wrappedIn?: string;
  parts: Part[];
  /** What it runs, for titles: "lint.py", "git add", "pandoc", "7 lines of Python". */
  name: string;
  /** The rest of the title: ", a Python script in this book". */
  what: string;
  /** Code written on the spot (`python3 -c`, a here-document): no rule could cover the next one. */
  inline: boolean;
  choices: RuleChoice[];
};

type Wrapper = { words: string[]; tool: string; valueFlags?: string[]; label?: string; danger?: boolean };

/** Commands that run another one: the program they run is what the command is about. */
const WRAPPERS: Wrapper[] = [
  { words: ['uv', 'run'], tool: 'uv', valueFlags: ['--package', '--with', '--with-requirements', '--python', '-p', '--project', '--directory', '--extra', '--group', '--env-file', '--index', '--from'] },
  { words: ['uv', 'tool', 'run'], tool: 'uv', valueFlags: ['--from', '--with', '--python', '-p'] },
  { words: ['uvx'], tool: 'uvx', valueFlags: ['--from', '--with', '--python', '-p'] },
  { words: ['npx'], tool: 'npx', valueFlags: ['-p', '--package'] },
  { words: ['pnpm', 'exec'], tool: 'pnpm' },
  { words: ['pnpm', 'dlx'], tool: 'pnpm' },
  { words: ['yarn', 'exec'], tool: 'yarn' },
  { words: ['yarn', 'dlx'], tool: 'yarn' },
  { words: ['bunx'], tool: 'bunx' },
  { words: ['bun', 'x'], tool: 'bun' },
  { words: ['poetry', 'run'], tool: 'Poetry' },
  { words: ['pipenv', 'run'], tool: 'Pipenv' },
  { words: ['pdm', 'run'], tool: 'PDM' },
  { words: ['hatch', 'run'], tool: 'Hatch' },
  { words: ['rye', 'run'], tool: 'Rye' },
  { words: ['pixi', 'run'], tool: 'pixi' },
  { words: ['conda', 'run'], tool: 'conda', valueFlags: ['-n', '--name', '-p', '--prefix'] },
  { words: ['bundle', 'exec'], tool: 'Bundler' },
  { words: ['xcrun'], tool: 'Xcode' },
  { words: ['env'], tool: 'env', label: 'with settings' },
  { words: ['time'], tool: 'time', label: 'timed' },
  { words: ['nice'], tool: 'nice', label: 'at low priority', valueFlags: ['-n'] },
  { words: ['nohup'], tool: 'nohup', label: 'kept running' },
  { words: ['sudo'], tool: 'sudo', label: 'as an administrator', danger: true, valueFlags: ['-u', '-g'] },
];

/** Programs that run code, by language, and their flags for code given on the spot. */
const LANGUAGES: { name: RegExp; lang: string; code: string[] }[] = [
  { name: /^(python[\d.]*|pypy[\d.]*)$/, lang: 'Python', code: ['-c'] },
  { name: /^(node|deno|tsx|ts-node)$/, lang: 'JavaScript', code: ['-e', '--eval', '-p', '--print'] },
  { name: /^ruby$/, lang: 'Ruby', code: ['-e'] },
  { name: /^perl$/, lang: 'Perl', code: ['-e', '-E'] },
  { name: /^Rscript$/, lang: 'R', code: ['-e'] },
  { name: /^julia$/, lang: 'Julia', code: ['-e'] },
  { name: /^php$/, lang: 'PHP', code: ['-r'] },
  { name: /^lua$/, lang: 'Lua', code: ['-e'] },
  { name: /^osascript$/, lang: 'AppleScript', code: ['-e'] },
  { name: /^(bash|sh|zsh|dash|fish)$/, lang: 'shell', code: ['-c'] },
];

/** Programs that do several things, named by their next word ("git add", "npm test"). */
const TOOLS: Record<string, string> = {
  git: 'Git',
  npm: 'npm',
  pnpm: 'pnpm',
  yarn: 'Yarn',
  bun: 'Bun',
  cargo: 'Cargo',
  brew: 'Homebrew',
  gh: 'GitHub’s gh',
  docker: 'Docker',
  uv: 'uv',
  pip: 'pip',
  pip3: 'pip',
  go: 'Go',
  gem: 'RubyGems',
  poetry: 'Poetry',
  conda: 'conda',
  kubectl: 'kubectl',
  quarto: 'Quarto',
  dotnet: '.NET',
  rustup: 'rustup',
  swift: 'Swift',
};

/** What a broad rule for these programs lets in. */
const PROGRAM_RISKS: [RegExp, string, boolean][] = [
  [/^(rm|rmdir|trash|unlink|shred|srm)$/, 'Can delete any file.', true],
  [/^(curl|wget|http|xh)$/, 'Can download from, or send to, any site.', false],
  [/^(chmod|chown)$/, 'Can change who may use any file.', true],
];

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const looksLikePath = (s: string) => /\//.test(s) || /\.[A-Za-z0-9]{1,6}$/.test(s);
const article = (lang: string) => (/^[AEIOU]/.test(lang) ? 'an' : 'a');

/** A path that's in the book, as far as the command says: relative without "..", or under the book's folder. */
const inBook = (path: string, root?: string) => (path.startsWith('/') ? !!root && path.startsWith(`${root}/`) : !path.startsWith('../') && !path.startsWith('~'));

/** The program a shell runs when the command is `zsh -lc "…"`, `bash -c '…'`. */
function shellInner(toks: Token[]): { inner: string; wrappedIn: string } | null {
  if (toks.length < 3 || !/^(bash|sh|zsh|dash)$/.test(base(toks[0].value))) return null;
  const flag = toks.findIndex((t, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(t.value));
  if (flag < 0 || flag !== toks.length - 2 || !toks.slice(1, flag).every((t) => t.value.startsWith('-'))) return null;
  const inner = toks[flag + 1].value.trim();
  return inner ? { inner, wrappedIn: toks.slice(0, flag + 1).map((t) => (t === toks[0] ? base(t.value) : t.value)).join(' ') } : null;
}

/** A command taken apart; `root` is the book's folder, for saying whether a script is in it. */
export function commandAnatomy(command: string, root?: string): Anatomy {
  const typed = command.trim();
  const unwrapped = shellInner(tokens(typed));
  if (unwrapped) return { ...commandAnatomy(unwrapped.inner, root), wrappedIn: unwrapped.wrappedIn };

  // A here-document's lines are code, not words of the command.
  const heredoc = /<<-?\s*['"]?\w+['"]?/.exec(typed);
  const head = heredoc ? typed.slice(0, heredoc.index).trimEnd() : typed;
  const toks = tokens(head);
  const parts: Part[] = [];
  let i = 0;
  const take = (kind: PartKind, n: number, label: string, extra: Partial<Part> = {}) => {
    const run = toks.slice(i, i + n);
    if (!run.length) return;
    const start = run[0].end - run[0].raw.length;
    parts.push({ kind, text: head.slice(start, run[run.length - 1].end), label, end: run[run.length - 1].end, ...extra });
    i += n;
  };

  // Settings first (LANG=C), then whatever runs the program (uv run, npx, time…).
  const envs = toks.findIndex((t) => !/^[A-Za-z_]\w*=/.test(t.raw));
  if (envs > 0) take('env', envs, envs === 1 ? 'setting' : 'settings');
  const wrappers: Wrapper[] = [];
  for (let found = true; found && i < toks.length; ) {
    found = false;
    for (const w of WRAPPERS) {
      const words = toks.slice(i, i + w.words.length).map((t, k) => (k === 0 ? base(t.value) : t.value));
      if (words.length !== w.words.length || words.some((x, k) => x !== w.words[k])) continue;
      let n = w.words.length;
      // Its own options, and settings given to env.
      while (i + n < toks.length && (toks[i + n].value.startsWith('-') || (w.tool === 'env' && /^[A-Za-z_]\w*=/.test(toks[i + n].raw)))) {
        n += w.valueFlags?.includes(toks[i + n].value) ? 2 : 1;
      }
      take('wrapper', Math.min(n, toks.length - i), w.label ?? `through ${w.tool}`);
      wrappers.push(w);
      found = true;
      break;
    }
  }

  let name = head;
  let what = '';
  let inline = !!heredoc;
  const progTok = toks[i];
  const prog = progTok ? base(progTok.value) : '';
  const language = LANGUAGES.find((l) => l.name.test(prog));
  if (progTok && language) {
    const lang = language.lang;
    // The interpreter and its own options, up to the script, the module or the code.
    let n = 1;
    while (i + n < toks.length && toks[i + n].value.startsWith('-') && !language.code.includes(toks[i + n].value) && toks[i + n].value !== '-m' && toks[i + n].value !== '-') n++;
    take('interpreter', n, lang === 'shell' ? 'the shell' : lang);
    const next = toks[i];
    if (next && language.code.includes(next.value)) {
      const code = toks[i + 1]?.value ?? '';
      const lines = code.split('\n').filter((l) => l.trim()).length;
      take('code', 2, 'code it just wrote');
      name = lang === 'shell' ? 'some shell commands' : `${plural(Math.max(lines, 1), 'line')} of ${lang}`;
      what = ' it just wrote';
      inline = true;
    } else if (next?.value === '-m' && toks[i + 1]) {
      const mod = toks[i + 1].value;
      take('module', 2, 'the module');
      name = mod;
      what = `, ${article(lang)} ${lang} module`;
    } else if (next && next.value !== '-' && !heredoc) {
      const path = next.value;
      const here = inBook(path, root);
      take('script', 1, `the script${here ? ', in this book' : ''}`, { dir: path.includes('/') ? next.raw.slice(0, next.raw.lastIndexOf('/') + 1) : undefined });
      const last = parts[parts.length - 1];
      if (last.dir) last.text = last.text.slice(last.dir.length);
      name = base(path);
      what = `, ${article(lang)} ${lang} script${here ? ' in this book' : ''}`;
    } else {
      // Code on standard input: a here-document's lines, or piped in.
      const lines = heredoc ? typed.slice(heredoc.index).split('\n').slice(1, -1).filter((l) => l.trim()).length : 0;
      inline = true;
      name = lang === 'shell' ? 'some shell commands' : lines ? `${plural(lines, 'line')} of ${lang}` : `some ${lang}`;
      what = heredoc ? ' it just wrote' : '';
    }
  } else if (progTok) {
    const tool = TOOLS[prog];
    let n = 1;
    // Git's own options before what it does (-C folder, -c key=value).
    if (tool) while (i + n < toks.length && toks[i + n].value.startsWith('-')) n += prog === 'git' && /^-[Cc]$/.test(toks[i + n].value) ? 2 : 1;
    take('program', Math.min(n, toks.length - i), tool ?? 'the program');
    if (tool && toks[i] && !toks[i].value.startsWith('-')) {
      name = `${prog} ${toks[i].value}`;
      take('subcommand', 1, 'what it does');
    } else name = prog;
  }
  const rest = toks.slice(i);
  if (rest.length) {
    const label = rest.length === 1 ? (rest[0].value.startsWith('-') ? 'option' : looksLikePath(rest[0].value) ? 'a file' : 'argument') : rest.every((t) => t.value.startsWith('-')) ? 'options' : 'arguments';
    take('args', rest.length, label);
  }
  if (heredoc) parts.push({ kind: 'code', text: typed.slice(heredoc.index), label: 'code it just wrote', end: typed.length });

  return { command: typed, parts, name, what, inline, choices: inline ? [] : ruleChoices(typed, parts, wrappers, language?.lang) };
}

/** The rules a command could become, narrowest first; the one to suggest is marked. */
function ruleChoices(command: string, parts: Part[], wrappers: Wrapper[], lang?: string): RuleChoice[] {
  const out: RuleChoice[] = [];
  // A "*" or "?" in a rule matches anything, so a command that has one can't be named exactly.
  const add = (c: RuleChoice) => !/[*?]/.test(c.pattern.replace(/ \*$/, '')) && !out.some((o) => o.pattern === c.pattern) && out.push(c);
  add({ pattern: command, title: 'Exactly this command' });
  const at = (p: Part) => `${command.slice(0, p.end)} *`;
  for (const p of [...parts].reverse()) {
    switch (p.kind) {
      case 'script':
      case 'module':
        add({ pattern: at(p), title: `${p.kind === 'module' ? `The module ${p.text.replace(/^-m\s+/, '')}` : p.text}, with any arguments` });
        break;
      case 'subcommand': {
        const prog = parts.find((q) => q.kind === 'program');
        add({ pattern: at(p), title: `${prog ? base(prog.text.split(/\s/)[0]) : ''} ${p.text}, with any arguments`.trim() });
        break;
      }
      case 'program': {
        const prog = base(p.text.split(/\s/)[0]);
        const risk = PROGRAM_RISKS.find(([re]) => re.test(prog));
        const tool = TOOLS[prog];
        add({ pattern: at(p), title: tool ? `Any ${prog} command` : `${prog}, with any arguments`, risk: risk?.[1] ?? (tool ? `Everything ${tool} can do.` : undefined), danger: risk?.[2] });
        break;
      }
      case 'interpreter': {
        const through = wrappers.find((w) => !w.label);
        const name = lang === 'shell' ? 'shell script' : `${lang} script`;
        add({
          pattern: at(p),
          title: `Any ${name}${through ? `, through ${through.tool}` : ''}`,
          risk: lang === 'shell' ? 'Runs any commands, so it’s the same as allowing everything.' : `Runs any ${lang} code, so it can change any file.`,
          danger: lang === 'shell',
        });
        break;
      }
      case 'wrapper': {
        const w = wrappers[parts.filter((q) => q.kind === 'wrapper').indexOf(p)];
        if (w && !w.label) add({ pattern: at(p), title: `Anything through ${w.tool}`, risk: 'The same as letting it run every command.', danger: true });
        else if (w?.danger) add({ pattern: at(p), title: `Anything ${w.label}`, risk: 'The same as letting it run every command.', danger: true });
        break;
      }
    }
  }
  const suggested = out.find((c, k) => k > 0 && !c.risk) ?? out[0];
  if (suggested) suggested.suggested = true;
  return out;
}

/** The program a command runs, past whatever runs it (env settings, uv run, npx, time…): for describing it in words. */
export function unwrapped(command: string): string {
  const a = commandAnatomy(command);
  const first = a.parts.find((p) => p.kind !== 'env' && p.kind !== 'wrapper');
  if (!first) return a.command;
  const start = first.end - (first.dir ?? '').length - first.text.length;
  return a.command.slice(start);
}

/** Something about a command worth knowing before allowing it, shown as a chip on the card. */
export type Fact = { kind: 'internet' | 'writes' | 'outside' | 'deletes'; text: string };

const NETWORK = /^(curl|wget|http|xh|ssh|scp|rsync|ftp|sftp|nc)$/;
const INSTALLS: [string, RegExp][] = [
  ['git', /^(clone|fetch|pull|push|ls-remote)$/],
  ['pip', /^(install|download)$/],
  ['pip3', /^(install|download)$/],
  ['npm', /^(install|i|ci|add|publish)$/],
  ['pnpm', /^(install|i|add)$/],
  ['yarn', /^(install|add)$/],
  ['brew', /^(install|upgrade|update|tap)$/],
  ['uv', /^(add|sync|pip|lock)$/],
  ['cargo', /^(install|add|fetch|update|publish)$/],
  ['gem', /^install$/],
];

/**
 * What a command line reaches beyond reading the book, as far as its words
 * say: the internet, a file it writes with ">", files outside the book, files
 * it deletes. A script can do any of these unsaid; these are the ones it says.
 */
export function commandFacts(line: string, root?: string): Fact[] {
  const facts: Fact[] = [];
  const add = (f: Fact) => !facts.some((g) => g.kind === f.kind && g.text === f.text) && facts.push(f);
  // Relative paths are the book's, as far as anyone can tell ("cd chapters && ../x" is still in it).
  const outside = (p: string) => (p.startsWith('~') || (p.startsWith('/') && !(root && p.startsWith(`${root}/`)) && !/^\/(dev|tmp)\//.test(p)) ? p : null);
  for (const t of tokens(line)) {
    const url = /^https?:\/\/([^/\s'"]+)/.exec(t.value);
    if (url) add({ kind: 'internet', text: `Uses the internet: ${url[1]}` });
  }
  const parts = line.split(/\s*(?:&&|\|\||;|\||\n)\s*/).filter(Boolean);
  for (const part of parts) {
    const a = commandAnatomy(part, root);
    const prog = a.parts.find((p) => p.kind === 'program' || p.kind === 'interpreter');
    const name = prog ? base(prog.text.split(/\s/)[0]) : '';
    const sub = a.parts.find((p) => p.kind === 'subcommand')?.text ?? '';
    if (NETWORK.test(name) || INSTALLS.some(([tool, subs]) => tool === name && subs.test(sub))) {
      if (!facts.some((f) => f.kind === 'internet')) add({ kind: 'internet', text: 'Uses the internet' });
    }
    if (/^(rm|rmdir|trash|unlink|shred|srm)$/.test(name)) add({ kind: 'deletes', text: 'Deletes files' });
    const redirect = /(?:^|[^\d&])>>?\s*(['"]?)([^\s'"&|;]+)\1/.exec(a.command.replace(/\d?>&\d|&?>>?\s*\/dev\/null/g, ''));
    if (redirect) {
      const path = redirect[2];
      add(outside(path) ? { kind: 'outside', text: `Writes outside the book: ${path}` } : { kind: 'writes', text: `Writes ${path}` });
    }
    for (const t of tokens(part).slice(1)) {
      const path = t.value.replace(/^-[-\w]*=/, '');
      if (/^https?:/.test(path) || (redirect && path === redirect[2])) continue;
      const out = outside(path);
      if (out && /[/~]/.test(out)) add({ kind: 'outside', text: `Outside the book: ${out}` });
    }
  }
  // "Writes outside the book: x" says it already.
  return facts.filter((f) => !(f.kind === 'outside' && f.text.startsWith('Outside') && facts.some((g) => g.text === `Writes outside the book: ${f.text.slice('Outside the book: '.length)}`)));
}
