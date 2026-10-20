// Shell commands in words, for writers: "Read “The Storm” (chapter 1) · lines
// 205–242" rather than `sed -n '205,242p' chapters/01-storm.typ`. Used for the
// chat's tool rows, the progress line and permission questions; the command
// itself stays one click away.
import { bookPath } from './ai-marks';
import { fileName, type BookNames } from './tool-labels';
import { splitCommands, words } from '../services/agent/shell-words';
import { commandAnatomy, unwrapped } from './command-anatomy';

export { splitCommands, words };

export type CommandWords = {
  /** "Read “The Storm” (chapter 1)". */
  done: string;
  /** "Reading “The Storm” (chapter 1)". */
  running: string;
  /** For a question: "read “The Storm” (chapter 1), lines 205–242". */
  ask: string;
  /** Lines read, and the like. */
  note?: string;
  /** The one file it's about, if any (book-relative). */
  path?: string;
};

type Step = { past: string; ing: string; base: string; note?: string; path?: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const step = (verb: [past: string, ing: string, base: string], object: string, extra: Partial<Step> = {}): Step => ({
  past: `${verb[0]} ${object}`.trim(),
  ing: `${verb[1]} ${object}`.trim(),
  base: `${verb[2]} ${object}`.trim(),
  ...extra,
});
const READ: [string, string, string] = ['read', 'reading', 'read'];

/** A list in words: "a", "a and b", "a, b and 2 more". */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length <= 3) return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  return `${items.slice(0, 2).join(', ')} and ${items.length - 2} more`;
}

function describeStep(typed: string, names: BookNames): Step | null {
  // What runs the program (uv run, npx, env settings, time) says nothing about it.
  const command = unwrapped(typed);
  if (command !== typed.trim()) return describeStep(command, names);
  // Redirections: into /dev/null (or 2>&1) say nothing; into a file, that file is written.
  const target = /(?:^|\s)\d?>>?\s*(?!\/dev\/null)([^\s&|;<>]+)/.exec(command.replace(/\d?>&\d/g, ''))?.[1];
  const w = words(command.replace(/(?:^|\s)(?:\d|&)?>>?\s*\S+|\d?>&\d|<<-?\s*'?\w+'?/g, ' '));
  const [cmd, ...rest] = w;
  if (!cmd) return null;
  const args = rest.filter((a) => !a.startsWith('-'));
  const flags = rest.filter((a) => a.startsWith('-'));
  const book = (p: string) => bookPath(names.root, p) ?? p;
  const folder = (p: string) => (p === '.' || p === './' ? 'the book' : `${book(p).replace(/\/?$/, '/')}`);
  // A file by its book name; a folder (no extension) as "chapters/".
  const name = (p: string) => (p === '.' || p === './' ? 'the book' : /\.[^/]+$/.test(p) ? fileName(book(p), names) : folder(p));
  const files = (ps: string[]) => list(ps.map(name));
  const one = (ps: string[]) => (ps.length === 1 ? book(ps[0]) : undefined);
  const into = target ? ` into ${name(target)}` : '';
  const prog = cmd.replace(/^.*\//, '');

  switch (prog) {
    case 'cd':
      return null;
    case 'cat':
    case 'bat':
    case 'less':
    case 'more':
    case 'nl':
      if (target && !args.length) return step(['wrote', 'writing', 'write'], name(target), { path: book(target) });
      return step(READ, files(args) || 'a file', { path: one(args) });
    case 'head':
    case 'tail': {
      const n = /^-n?(\d+)$/.exec(flags.find((f) => /^-n?\d+$/.test(f)) ?? '')?.[1] ?? (rest[rest.indexOf('-n') + 1] && rest.includes('-n') ? rest[rest.indexOf('-n') + 1] : undefined);
      const fileArgs = args.filter((a) => a !== n);
      const which = prog === 'head' ? (n ? `the first ${n} lines` : 'the start') : n ? `the last ${n} lines` : 'the end';
      return step(READ, files(fileArgs) || 'a file', { note: which, path: one(fileArgs) });
    }
    case 'sed': {
      // The script comes from -e or is the first argument (after macOS's `-i ''`); the rest are files.
      const plain = args.filter(Boolean);
      const script = rest.includes('-e') ? rest[rest.indexOf('-e') + 1] : plain[0];
      const sfiles = plain.filter((a) => a !== script);
      if (flags.includes('-n') && sfiles.length && /^\d+(,(\d+|\$))?p(;\d+(,(\d+|\$))?p)*$/.test(script ?? '')) {
        const ranges = script.split(';').map((r) => r.replace(/p$/, '').replace(',', '–').replace('$', 'the end'));
        return step(READ, files(sfiles), { note: `${ranges.length === 1 && !ranges[0].includes('–') ? 'line' : 'lines'} ${list(ranges)}`, path: one(sfiles) });
      }
      if (flags.some((f) => f.startsWith('-i'))) return step(['changed', 'changing', 'change'], files(sfiles) || 'a file', { path: one(sfiles) });
      return step(['went through', 'going through', 'go through'], files(sfiles) || 'some text');
    }
    case 'ls':
    case 'tree':
      return step(['listed', 'listing', 'list'], `the files in ${list((args.length ? args : ['.']).map(folder))}`);
    case 'find': {
      const pattern = rest[rest.indexOf('-name') + 1] ?? rest[rest.indexOf('-iname') + 1];
      const where = args[0] && !args[0].startsWith('*') ? ` in ${folder(args[0])}` : '';
      const kind = rest.includes('d') && rest.includes('-type') ? 'folders' : 'files';
      return step(['looked for', 'looking for', 'look for'], `${kind}${pattern && (rest.includes('-name') || rest.includes('-iname')) ? ` named ${pattern}` : ''}${where}`);
    }
    case 'grep':
    case 'egrep':
    case 'fgrep':
    case 'rg':
    case 'ag': {
      // Flags that take a value (-A 3, -m 1) don't count as the pattern.
      const plain = rest.filter((a, i) => !a.startsWith('-') && !/^-[ABCmf]$/.test(rest[i - 1] ?? ''));
      const e = rest.indexOf('-e');
      const pattern = e >= 0 ? rest[e + 1] : plain[0];
      const paths = (e >= 0 ? plain.filter((a) => a !== pattern) : plain.slice(1)).filter((p) => p !== '.');
      return step(['searched for', 'searching for', 'search for'], `“${pattern ?? ''}”${paths.length ? ` in ${files(paths)}` : ''}`);
    }
    case 'wc': {
      const what = flags.includes('-l') ? 'lines' : flags.includes('-c') || flags.includes('-m') ? 'characters' : 'words';
      return step(['counted', 'counting', 'count'], `the ${what}${args.length ? ` in ${files(args)}` : ''}`);
    }
    case 'diff':
    case 'cmp':
      return step(['compared', 'comparing', 'compare'], args.length >= 2 ? `${name(args[0])} with ${name(args[1])}` : 'two files');
    case 'git': {
      const sub = args[0];
      const git: Record<string, [string, string, string, string]> = {
        status: ['checked', 'checking', 'check', 'what has changed (Git)'],
        diff: ['looked at', 'looking at', 'look at', 'the changes (Git)'],
        log: ['looked at', 'looking at', 'look at', 'the Git history'],
        show: ['looked at', 'looking at', 'look at', 'a past version (Git)'],
        blame: ['looked at', 'looking at', 'look at', 'who changed each line (Git)'],
        'ls-files': ['listed', 'listing', 'list', 'the files Git tracks'],
        add: ['staged', 'staging', 'stage', 'changes in Git'],
        commit: ['made', 'making', 'make', 'a Git commit'],
      };
      const g = git[sub ?? ''];
      return g ? step([g[0], g[1], g[2]], g[3]) : step(['used', 'using', 'use'], `Git${sub ? ` (${sub})` : ''}`);
    }
    case 'mv': {
      if (args.length < 2) break;
      const [from, to] = [args[0], args[args.length - 1]];
      const sameFolder = from.replace(/[^/]*$/, '') === to.replace(/[^/]*$/, '') && !to.endsWith('/');
      return sameFolder
        ? step(['renamed', 'renaming', 'rename'], `${name(from)} to ${to.replace(/^.*\//, '')}`)
        : step(['moved', 'moving', 'move'], `${name(from)} to ${folder(to.endsWith('/') ? to : to.replace(/[^/]*$/, '') || '.')}`);
    }
    case 'cp':
      return args.length >= 2 ? step(['copied', 'copying', 'copy'], `${files(args.slice(0, -1))} to ${name(args[args.length - 1])}`) : null;
    case 'rm':
    case 'trash':
    case 'unlink':
      return step(['deleted', 'deleting', 'delete'], files(args) || 'files', { path: one(args) });
    case 'rmdir':
      return step(['deleted', 'deleting', 'delete'], `the folder ${list(args.map(folder))}`);
    case 'mkdir':
      return step(['made', 'making', 'make'], `the folder ${list(args.map(folder))}`);
    case 'touch':
      return step(['created', 'creating', 'create'], files(args), { path: one(args) });
    case 'echo':
    case 'printf':
      return target ? step(['wrote', 'writing', 'write'], name(target), { path: book(target) }) : null;
    case 'python':
    case 'python3':
    case 'node':
    case 'ruby':
    case 'perl':
    case 'Rscript':
    case 'julia': {
      const lang = { python: 'Python', python3: 'Python', node: 'JavaScript', ruby: 'Ruby', perl: 'Perl', Rscript: 'R', julia: 'Julia' }[prog];
      if (flags.includes('-c') || flags.includes('-e') || !args.length) return step(['ran', 'running', 'run'], `some ${lang} code${into}`);
      return step(['ran', 'running', 'run'], `the ${lang} script ${name(args[0])}${into}`);
    }
    case 'pip':
    case 'pip3':
    case 'brew':
    case 'npm':
    case 'cargo':
      return args[0] === 'install' ? step(['installed', 'installing', 'install'], list(args.slice(1)) || 'software') : step(['ran', 'running', 'run'], prog);
    case 'curl':
    case 'wget': {
      const url = args.find((a) => /^https?:\/\//.test(a));
      let host = url ?? 'the web';
      try {
        if (url) host = new URL(url).host;
      } catch {
        // keep the text
      }
      return step(['downloaded', 'downloading', 'download'], `from ${host}${into}`);
    }
    case 'typst':
    case 'tinymist':
    case 'make':
      return step(['tried to build', 'trying to build', 'build'], 'the book');
    case 'sort':
    case 'uniq':
    case 'cut':
    case 'awk':
    case 'tr':
    case 'jq':
    case 'column':
      return args.length && prog !== 'tr' && prog !== 'awk' ? step(['went through', 'going through', 'go through'], `${files(args.slice(prog === 'jq' || prog === 'cut' ? 1 : 0))}${into}`) : null;
    case 'pwd':
      return step(['checked', 'checking', 'check'], 'which folder it’s in');
    case 'date':
      return step(['checked', 'checking', 'check'], 'the date');
    case 'which':
      return step(['checked', 'checking', 'check'], `whether ${list(args)} is installed`);
    case 'true':
    case 'sleep':
      return null;
  }
  return step(['ran', 'running', 'run'], `the command “${prog}”${into}`);
}

/** A shell command line in words. Steps that only arrange the others (cd, echo) are left out. */
export function describeCommand(typed: string, names: BookNames): CommandWords {
  // A line the shell is given whole (`zsh -lc "cd x && …"`) is the line it runs.
  const command = commandAnatomy(typed).command;
  // In a pipeline, the first command does the work (reads, searches); the rest only shapes its output.
  const all = splitCommands(command, { pipes: false }).map((c) => splitCommands(c)[0] ?? c);
  const steps = all.map((c) => describeStep(c, names)).filter((s): s is Step => !!s);
  const shown = steps.filter((s, i) => steps.findIndex((t) => t.past === s.past) === i).slice(0, 2);
  if (!shown.length) return { done: 'Ran a command', running: 'Running a command', ask: 'run a command' };
  const more = steps.length - shown.length > 0 && new Set(steps.map((s) => s.past)).size > shown.length ? ` and ${new Set(steps.map((s) => s.past)).size - shown.length} more` : '';
  const join = (k: 'past' | 'ing' | 'base') => shown.map((s) => s[k] + (s.note && shown.length > 1 ? ` (${s.note})` : '')).join(', then ') + more;
  const single = shown.length === 1 && !more ? shown[0] : null;
  return {
    done: cap(join('past')),
    running: cap(join('ing')),
    ask: join('base') + (single?.note ? `, ${single.note}` : ''),
    note: single?.note,
    path: single?.path,
  };
}
