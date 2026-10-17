import { describe, expect, it } from 'vitest';
import { describeCommand, splitCommands, words } from './command-words';
import type { BookNames } from './tool-labels';

const names: BookNames = {
  root: '/b',
  entry: 'main.typ',
  chapters: ['chapters/ch01_what_is_a_vector.typ', 'chapters/02-harbour.typ'],
  titles: { 'chapters/ch01_what_is_a_vector.typ': 'What Is a Vector', 'chapters/02-harbour.typ': 'The Harbour' },
};
const say = (c: string) => describeCommand(c, names);

describe('shell commands in words', () => {
  it('splits command lines and words the way the shell does', () => {
    expect(splitCommands(`ls -la . figures 2>&1; echo; cat "a;b.typ" && grep -n 'x|y' f | wc -l`)).toEqual(['ls -la . figures 2>&1', 'echo', 'cat "a;b.typ"', "grep -n 'x|y' f", 'wc -l']);
    expect(splitCommands('grep x f | wc -l && ls', { pipes: false })).toEqual(['grep x f | wc -l', 'ls']);
    expect(words(`grep -n 'two words' "say \\"hi\\"" f`)).toEqual(['grep', '-n', 'two words', 'say "hi"', 'f']);
  });

  it('reads files by their chapter names, with the lines', () => {
    expect(say("sed -n '205,242p' chapters/ch01_what_is_a_vector.typ")).toEqual({
      done: 'Read “What Is a Vector” (chapter 1)',
      running: 'Reading “What Is a Vector” (chapter 1)',
      ask: 'read “What Is a Vector” (chapter 1), lines 205–242',
      note: 'lines 205–242',
      path: 'chapters/ch01_what_is_a_vector.typ',
    });
    expect(say('cat main.typ').done).toBe('Read the main file');
    expect(say('head -n 40 chapters/02-harbour.typ')).toMatchObject({ done: 'Read “The Harbour” (chapter 2)', note: 'the first 40 lines' });
    expect(say('tail -5 refs.bib').note).toBe('the last 5 lines');
  });

  it('lists, finds, searches and counts', () => {
    expect(say('ls -la . figures 2>&1; echo; cat style.typ 2>/dev/null').done).toBe('Listed the files in the book and figures/, then read style.typ');
    expect(say('find . -name "*.typ"').done).toBe('Looked for files named *.typ in the book');
    expect(say("grep -rn 'lighthouse' chapters/").done).toBe('Searched for “lighthouse” in chapters/');
    expect(say('grep -n -A 3 "eigen" main.typ').done).toBe('Searched for “eigen” in the main file');
    expect(say('wc -w chapters/02-harbour.typ').done).toBe('Counted the words in “The Harbour” (chapter 2)');
    expect(say('git status').done).toBe('Checked what has changed (Git)');
    // A pipeline is about its first command.
    expect(say('grep -c "x" main.typ | sort | head -3').done).toBe('Searched for “x” in the main file');
  });

  it('says what changes files', () => {
    expect(say('mv chapters/02-harbour.typ chapters/03-harbour.typ').done).toBe('Renamed “The Harbour” (chapter 2) to 03-harbour.typ');
    expect(say('mv notes.typ archive/').done).toBe('Moved notes.typ to archive/');
    expect(say('rm -f old.typ').ask).toBe('delete old.typ');
    expect(say('mkdir -p figures/plots').done).toBe('Made the folder figures/plots/');
    expect(say("echo 'hi' > notes.txt").done).toBe('Wrote notes.txt');
    expect(say("cat > figures/a.typ <<'EOF'\n#let x = 1\nEOF").done).toBe('Wrote figures/a.typ');
    expect(say("sed -i '' 's/a/b/' main.typ").done).toBe('Changed the main file');
  });

  it('names programs and builds, and falls back to the command name', () => {
    expect(say('python3 scripts/plot.py').done).toBe('Ran the Python script scripts/plot.py');
    expect(say('python3 -c "print(1)"').done).toBe('Ran some Python code');
    expect(say('cd book && typst compile main.typ').done).toBe('Tried to build the book');
    expect(say('pip install numpy').ask).toBe('install numpy');
    expect(say('curl -sL https://example.com/data.csv -o data.csv').done).toBe('Downloaded from example.com');
    expect(say('pandoc a.md -o a.docx').done).toBe('Ran the command “pandoc”');
    expect(say('cd x').done).toBe('Ran a command');
  });
});
