// Messages Foreword writes for the author when they press a button (Write it,
// Fix This Error, Work on this TODO…): the assistant gets the whole brief, but
// the chat shows what the author asked for, as a step, not the words sent for
// it. Each is read back from its text, so a conversation reopened later (or a
// task named after its first message) shows the same.
import { AUTHOR_EDITS_INTRO } from '../services/agent/author-edits';
import { AGENT_MODES, modeConfig, type AgentMode } from '../services/agent/modes';
import { STYLE_DRAFT_MESSAGE, STYLE_INTERVIEW_MESSAGE, STYLE_REDRAFT_MESSAGE } from '../services/agent/style-guide';

/** The icons an action can have (all of them the chat's own). */
export type ActionIcon = 'edit' | 'error' | 'bulb' | 'todos' | 'comments' | 'branch' | 'check' | 'help' | 'code' | 'book' | 'passed';

/** What the author asked for with a button, as the chat shows it. */
export type StockAction = {
  /** The request, in the button's words ("Write it"). */
  verb: string;
  /** A few words after it ("what we agreed"). */
  note?: string;
  /** What it's about, a line each: the error, the TODO, the comments, the answers (`label`: the question answered). */
  rows?: { label?: string; text: string }[];
  /** Its colour on the line, as the steps': it changes the book, it only looks, it checks, or something else. */
  tone: 'change' | 'look' | 'done' | 'other';
  icon: ActionIcon;
  /** An action that picks a mode: drawn with the mode's glyph and colour. */
  mode?: AgentMode;
};

// ---- the messages ------------------------------------------------------------------------

/** "Fix This Error with the Assistant": the error's line goes with it as the selection. */
export const fixErrorPrompt = (message: string) => `Typst reports an error here: “${message}”. Explain in a sentence or two, in plain words, what's wrong, then fix it.`;

/** "Explain This" on a selection. */
export const EXPLAIN_PROMPT = "Explain this passage in plain words, including what any Typst markup in it does. Don't change anything.";

/** "Resolve with the assistant" on a passage changed two ways at once: the author's is the selection. */
export const mergePrompt = (path: string, theirs: string, yours: boolean) => {
  const quoted = theirs.trim() ? theirs.trim().split('\n').map((l) => `> ${l}`).join('\n') : '> (nothing: that version doesn’t have this passage)';
  return `This passage of ${path} was changed two ways at once. Mine is the selection; the other version${yours ? ' (yours)' : ''} is:\n\n${quoted}\n\nCombine them into one passage in the file, in place of mine, keeping what each changed. Where they can't both stand, keep mine and tell me what you left out.`;
};

/** "Ask it to edit instead", on a command that would change the book. */
export const EDIT_INSTEAD_PROMPT = 'Please make that change by editing the file instead of running code, so I can see each change.';

/** "Ask the assistant to fix them", after code examples fail: one problem a line ("- … (path:line)"). */
export const failingExamplesPrompt = (lines: string[]) =>
  `These code examples fail when Foreword runs them:\n${lines.join('\n')}\n\nFix each one so it runs and prints what the book says it does. Change the example code (or its expect: value, if the expectation itself is wrong). Don't run the code yourself: Foreword re-runs it after your changes.`;

/**
 * The empty chat's "Try asking", each in the colour of what it does: look
 * (blue), check (green), write (purple), Typst (its teal). One that's sent as
 * written isn't an action.
 */
export const STARTERS: { icon: ActionIcon; tone: 'look' | 'check' | 'change' | 'typst'; label: string; prompt: string }[] = [
  { icon: 'book', tone: 'look', label: 'Explain how this book fits together', prompt: 'Explain how the files of this book fit together.' },
  { icon: 'passed', tone: 'check', label: 'Proofread the open chapter', prompt: "Read the open chapter and point out typos, repeated words and unclear sentences. Don't change anything yet." },
  { icon: 'edit', tone: 'change', label: 'Outline my next chapter', prompt: 'Suggest an outline for my next chapter.' },
  { icon: 'help', tone: 'typst', label: 'How do I add a footnote?', prompt: 'How do I add a footnote?' },
];

// ---- reading them back ---------------------------------------------------------------------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const modeLabelled = (label: string) => AGENT_MODES.find((m) => modeConfig(m).label === label);

/** After "Write it" and "Go ahead", what they make. */
const CARRY_NOTES: Partial<Record<AgentMode, string>> = { discuss: 'what we agreed', ask: 'make the changes we talked about' };

const FIX_ERROR = new RegExp(`^${esc(fixErrorPrompt('\0')).replace('\0', '([\\s\\S]*)')}$`);
const TODO = /^Work on this TODO in .+ \(line \d+\): “([\s\S]*)”\. When it's done, remove the TODO itself\.$/;
const MODE_CHOICE = /^(Go on|Stay) in (\S+) mode, as you offered: “([\s\S]*)”$/;
const REVIEW = /^Please address (?:this review comment|these review comments) on the book\. /;
const REVIEW_ENTRY = /^\[c\d+\] .+?(?:, line \d+| \(the passage has changed since\)), on “[\s\S]*?”:\n([\s\S]*?)(?=\n\n\[c\d+\] |\n\nWhen you're done, end your reply)/gm;
const MERGE = new RegExp(`^${esc(mergePrompt('\0', '\x01', false)).replace('\0', '.+?').replace(esc('> \x01'), '[\\s\\S]*').replace(' is:', '(?: \\(yours\\))? is:')}$`);
const ANSWERS = /^My answers?:\n- /;
const EXAMPLES = new RegExp(`^${esc(failingExamplesPrompt(['\0'])).replace('\0', '((?:- [^\\n]*\\n?)+)')}$`);
const REVISE = /^Revise my style guide:(?: |\n\n)([\s\S]+)$/;

/** Each kind of message, read back: what it asked for, or null if it isn't that one. */
const READERS: ((text: string) => StockAction | null)[] = [
  (text) => {
    const mode = AGENT_MODES.find((m) => modeConfig(m).carryOut?.prompt === text);
    const carry = mode && modeConfig(mode).carryOut;
    return carry ? { verb: carry.label, note: CARRY_NOTES[mode], tone: 'change', icon: 'edit' } : null;
  },
  (text) => {
    const m = FIX_ERROR.exec(text);
    return m ? { verb: 'Fix this error', rows: [{ text: m[1] }], tone: 'change', icon: 'error' } : null;
  },
  (text) => (text === EXPLAIN_PROMPT ? { verb: 'Explain this passage', note: 'in plain words', tone: 'look', icon: 'bulb' } : null),
  (text) => {
    const m = TODO.exec(text);
    return m ? { verb: 'Work on this TODO', rows: [{ text: m[1] }], tone: 'change', icon: 'todos' } : null;
  },
  (text) => {
    if (!REVIEW.test(text)) return null;
    const comments = [...text.matchAll(REVIEW_ENTRY)].map((m) => ({ text: m[1].trim() }));
    if (!comments.length) return null;
    return { verb: comments.length === 1 ? 'Fix this review comment' : `Fix ${comments.length} review comments`, rows: comments, tone: 'change', icon: 'comments' };
  },
  (text) => (MERGE.test(text) ? { verb: 'Combine both versions', note: 'yours and the other', tone: 'change', icon: 'branch' } : null),
  (text) => {
    const m = MODE_CHOICE.exec(text);
    const mode = m && modeLabelled(m[2]);
    return m && mode ? { verb: `${m[1]} in ${m[2]}`, rows: [{ text: m[3] }], tone: 'other', icon: 'check', mode } : null;
  },
  (text) => {
    if (!ANSWERS.test(text)) return null;
    const rows = text
      .slice(text.indexOf('\n') + 1)
      .split(/\n(?=- )/)
      .map((line) => {
        const said = line.slice(2);
        // "Which tone? Warm": the question, then the answer.
        const m = /^(.+?\?)\s+([\s\S]+)$/.exec(said);
        return m ? { label: m[1], text: m[2] } : { text: said };
      });
    return { verb: rows.length > 1 ? 'Answered the questions' : 'Answered the question', rows, tone: 'other', icon: 'check' };
  },
  (text) => {
    const m = EXAMPLES.exec(text);
    if (!m) return null;
    const rows = m[1].trim().split('\n').map((l) => ({ text: l.replace(/^- /, '') }));
    return { verb: rows.length > 1 ? 'Fix the failing code examples' : 'Fix the failing code example', rows, tone: 'change', icon: 'code' };
  },
  (text) => (text === EDIT_INSTEAD_PROMPT ? { verb: 'Edit the file instead', note: 'not with a command', tone: 'change', icon: 'edit' } : null),
  (text) =>
    text === STYLE_DRAFT_MESSAGE
      ? { verb: 'Draft my style guide', note: 'from the chapters', tone: 'change', icon: 'edit' }
      : text === STYLE_REDRAFT_MESSAGE
        ? { verb: 'Redraft my style guide', note: 'from the chapters', tone: 'change', icon: 'edit' }
        : text === STYLE_INTERVIEW_MESSAGE
          ? { verb: 'Interview me', note: 'for my style guide', tone: 'other', icon: 'help' }
          : null,
  (text) => {
    const m = REVISE.exec(text);
    return m ? { verb: 'Revise my style guide', rows: [{ text: m[1].trim() }], tone: 'change', icon: 'edit' } : null;
  },
  (text) => {
    const s = STARTERS.find((x) => x.prompt === text && x.prompt !== x.label);
    return s ? { verb: s.label, tone: s.tone === 'check' ? 'done' : s.tone === 'typst' ? 'other' : s.tone, icon: s.icon } : null;
  },
];

/** The action a message is, if Foreword wrote it for a button; null for the author's own words. */
export function stockAction(message: string): StockAction | null {
  const text = message.trim();
  for (const read of READERS) {
    const action = read(text);
    if (action) return action;
  }
  return null;
}

const oneLine = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The action in a line, for History's label and the folded turn: “Work on this TODO: “Add a figure””. */
export function actionLine(a: StockAction): string {
  return a.rows?.length === 1 ? `${a.verb}: “${oneLine(a.rows[0].text)}”` : a.verb;
}

/** The action as text, for copying: its line, then what it's about. */
export function actionText(a: StockAction): string {
  const head = `${a.verb}${a.note ? ` (${a.note})` : ''}`;
  return [head, ...(a.rows ?? []).map((r) => `- ${r.label ? `${r.label} ` : ''}${r.text}`)].join('\n');
}

/** A message in a line: an action's words, or the message itself. */
export function messageLine(message: string): string {
  const a = stockAction(message);
  return a ? actionLine(a) : message;
}

/**
 * Codex names a task after its first message, and Claude Code does until it
 * has a better name (on one line, cut at 256 characters, the selection's
 * words after it): a stock message's title is its action's words instead.
 */
const TITLE_OPENINGS: [string, string][] = [
  ['Typst reports an error here: “', 'Fix this error'],
  ['Work on this TODO in ', 'Work on this TODO'],
  ['Please address this review comment on the book.', 'Fix this review comment'],
  ['Please address these review comments on the book.', 'Fix review comments'],
  ['These code examples fail when Foreword runs them:', 'Fix the failing code examples'],
];
const TITLE_TAIL = new RegExp(` (?:Selected in the editor: |The cursor is in |${esc(AUTHOR_EDITS_INTRO)})[\\s\\S]*$`);

export function stockTitle(title: string): string {
  const line = title.replace(/\s+/g, ' ').trim();
  const text = line.replace(TITLE_TAIL, '');
  const a = stockAction(text);
  if (a) return actionLine(a);
  if (/^This passage of .+ was changed two ways at once\./.test(text)) return 'Combine both versions';
  return TITLE_OPENINGS.find(([opening]) => text.startsWith(opening))?.[1] ?? title;
}
