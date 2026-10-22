// Agent modes for a conversation: Write (edits the book), Ask (questions about
// the book), Discuss (think a direction through, before writing), Options
// (three alternatives to choose from) and Figures (diagrams, charts,
// illustrations as code). Each mode is the app's own: the agent stays in its
// usual mode (never Claude Code's or Codex's plan mode, which write their
// answer to a file and ask to leave), the app's rules block changes when it's
// read-only, and an instruction entry shapes the reply.
import { ASK_INSTRUCTIONS, GO_AHEAD_PROMPT } from './ask-mode';
import { DISCUSS_INSTRUCTIONS, WRITE_FROM_DISCUSSION_PROMPT } from './discuss-mode';
import { FIGURES_INSTRUCTIONS } from './figures-mode';
import { OPTIONS_INSTRUCTIONS } from './options-mode';

export type AgentMode = 'write' | 'ask' | 'discuss' | 'options' | 'figures';

export const AGENT_MODES: AgentMode[] = ['write', 'ask', 'discuss', 'options', 'figures'];

/** Old names still understood: Discuss was Plan until 2026-10-22. */
const MODE_ALIASES: Record<string, AgentMode> = { plan: 'discuss' };

/** The mode a word names ("Discuss", "plan"), or null. */
export function modeNamed(word: string): AgentMode | null {
  const w = word.trim().toLowerCase();
  return AGENT_MODES.includes(w as AgentMode) ? (w as AgentMode) : (MODE_ALIASES[w] ?? null);
}

export const MODE_INSTRUCTIONS_KEY = 'mode';

export type ModeConfig = {
  /** No file changes and no commands, whatever the edit setting. */
  readOnly: boolean;
  instructions: string | null;
  label: string;
  icon: string;
  /** Shown in the mode menu. */
  description: string;
  /** Composer placeholder. */
  placeholder: string;
  /** Chat notice when switching to the mode mid-conversation. */
  notice: string;
  /** After a reply: the button that switches to Write and sends `prompt`, to make what was agreed. */
  carryOut: { question: string; label: string; prompt: string } | null;
  /** Going on in this mode, on the button of the assistant's offer of it (modeOffer). */
  go: string;
};

/**
 * The assistant's offer of another mode for the author's last message (a
 * ```mode block ending its reply): what it would do there, and what it would
 * do staying here. The author picks one under the reply.
 */
export type ModeSuggestion = { mode: AgentMode; from: AgentMode; there: string; here: string; state: 'pending' | 'switched' | 'stayed' };

/** Where a reply's offer starts: a ```mode fence on a line of its own. */
const OFFER_OPEN = /(^|\n)[ \t]*```+[ \t]*mode[ \t]*\n/i;
const OFFER_CLOSE = /(^|\n)[ \t]*```+[ \t]*(?=\n|$)/;

/** One way on, in the assistant's words (its card shows a few lines; the author's pick sends them all): never an essay. */
const sentence = (t: string) => {
  const s = t.trim().replace(/\s+/g, ' ');
  return s.length > 600 ? `${s.slice(0, 599).trimEnd()}…` : s;
};

/** A reply's offer of another mode: its ```mode block's mode, there and here; null without a whole one. */
export function modeOffer(text: string): Pick<ModeSuggestion, 'mode' | 'there' | 'here'> | null {
  const open = OFFER_OPEN.exec(text);
  if (!open) return null;
  const rest = text.slice(open.index + open[0].length);
  const close = OFFER_CLOSE.exec(rest);
  if (!close) return null;
  const body = rest.slice(0, close.index);
  const field = (key: string) => sentence(new RegExp(`^[ \\t*-]*${key}[ \\t*]*:(.*)$`, 'im').exec(body)?.[1]?.replace(/^[\s"“]+|[\s"”]+$/g, '') ?? '');
  const mode = modeNamed(field('mode'));
  const [there, here] = [field('there'), field('here')];
  return mode && there && here ? { mode, there, here } : null;
}

/** The reply as the chat shows it: without its offer block, or the start of one still being written. */
export function withoutModeOffer(text: string): string {
  const open = OFFER_OPEN.exec(text);
  if (!open) return text;
  const rest = text.slice(open.index + open[0].length);
  const close = OFFER_CLOSE.exec(rest);
  const after = close ? rest.slice(close.index + close[0].length) : '';
  return [text.slice(0, open.index + open[1].length).trimEnd(), after.trim()].filter(Boolean).join('\n\n');
}

/** The author's pick of an offer's two ways on, sent as their next message: the way in the assistant's own words. */
export function modeChoiceMessage(s: Pick<ModeSuggestion, 'mode' | 'from' | 'there' | 'here'>, go: boolean): string {
  return `${go ? 'Go on' : 'Stay'} in ${modeConfig(go ? s.mode : s.from).label} mode, as you offered: “${go ? s.there : s.here}”`;
}

/** The next mode in the menu (⇧Tab in the composer cycles through them). */
export const nextMode = (mode: AgentMode): AgentMode => AGENT_MODES[(AGENT_MODES.indexOf(mode) + 1) % AGENT_MODES.length];

export function modeConfig(mode: AgentMode): ModeConfig {
  switch (mode) {
    case 'ask':
      return {
        readOnly: true,
        instructions: ASK_INSTRUCTIONS,
        label: 'Ask',
        icon: '?',
        description: 'Questions about the book, answered in the chat. Can’t change files.',
        placeholder: 'Ask about the book, a passage, a TODO…',
        notice: 'Ask mode: the agent answers in the chat, and can’t change files.',
        carryOut: { question: 'Want it changed?', label: 'Go ahead', prompt: GO_AHEAD_PROMPT },
        go: 'Just answer',
      };
    case 'discuss':
      return {
        readOnly: true,
        instructions: DISCUSS_INSTRUCTIONS,
        label: 'Discuss',
        icon: '⇄',
        description: 'Think ideas and directions through: it says what it would do, and argues back. Can’t change files.',
        placeholder: 'What should we think through? A direction, a chapter’s shape, a character…',
        notice: 'Discuss mode: the agent weighs ideas with you and argues back, and can’t change files.',
        carryOut: { question: 'Settled?', label: 'Write it', prompt: WRITE_FROM_DISCUSSION_PROMPT },
        go: 'Talk it through',
      };
    case 'options':
      return {
        readOnly: true,
        instructions: OPTIONS_INSTRUCTIONS,
        label: 'Options',
        icon: '⑂',
        description: 'Three versions of the selected text to pick from. Can’t change files.',
        placeholder: 'Select text, then say what to change (e.g. “make it punchier”)…',
        notice: 'Options mode: select text and ask for a change; you’ll get three versions to choose from.',
        carryOut: null,
        go: 'Show three versions',
      };
    case 'figures':
      return {
        readOnly: false,
        instructions: FIGURES_INSTRUCTIONS,
        label: 'Figures',
        icon: '◫',
        description: 'Diagrams, charts, illustrations and tables, drawn as code you can see in the preview.',
        placeholder: 'Describe a figure: a flowchart of…, a chart of data/sales.csv, a diagram of…',
        notice: 'Figures mode: diagrams, charts, illustrations and tables, drawn as code you can see in the preview.',
        carryOut: null,
        go: 'Draw it',
      };
    case 'write':
      return {
        readOnly: false,
        instructions: null,
        label: 'Write',
        icon: '✎',
        description: 'Write and edit the book.',
        placeholder: 'Ask about the selection, or request an edit…',
        notice: 'Write mode: the agent writes and edits the book.',
        carryOut: null,
        go: 'Write it',
      };
  }
}
