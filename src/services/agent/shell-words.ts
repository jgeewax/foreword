// A shell command line, taken apart the way the shell reads it, without
// running anything: the commands of a chained line, and each command's words.
// The permission rules check a line command by command, and the chat describes
// each one, so both read it the same way.

/** Here-documents' bodies (`cat > f <<'EOF'` … `EOF`) are text, not commands. */
export const withoutHeredocs = (line: string) => line.replace(/(<<-?\s*(['"]?)(\w+)\2)[^\n]*\n[\s\S]*?\n\s*\3[ \t]*(?=\n|$)/g, '$1');

/**
 * Commands, split at && || ; & and newlines outside quotes, and at | too unless
 * `pipes` is false (then a pipeline stays one piece). A lone & (running in the
 * background) splits too, but not the & of a redirection (`2>&1`, `&>`).
 */
export function splitCommands(line: string, { pipes = true } = {}): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  const text = withoutHeredocs(line);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') {
        cur += c + (text[i + 1] ?? '');
        i++;
        continue;
      }
      if (c === quote) quote = null;
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    if (c === '\\') {
      cur += c + (text[i + 1] ?? '');
      i++;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    const redirect = c === '&' && (text[i - 1] === '>' || text[i - 1] === '<' || text[i + 1] === '>');
    if (c === ';' || c === '\n' || (pipes && c === '|') || (c === '&' && !redirect)) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Words, with quotes removed ("grep -n 'two words' f" → grep, -n, two words, f). */
export function words(command: string): string[] {
  return tokens(command).map((t) => t.value);
}

/** A word as typed (`raw`, quotes and all), what it means (`value`), and where it ends in the command. */
export type Token = { raw: string; value: string; end: number };

/** A command's words with where each one is, so a prefix of them can be cut from the command as typed. */
export function tokens(command: string): Token[] {
  const out: Token[] = [];
  for (const m of command.matchAll(/(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^\s'"\\])+/g)) {
    const raw = m[0];
    const value = raw.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"|\\(.)/g, (_, single, double, escaped) =>
      single !== undefined ? single : double !== undefined ? double.replace(/\\(.)/g, '$1') : escaped,
    );
    out.push({ raw, value, end: (m.index ?? 0) + raw.length });
  }
  return out;
}
