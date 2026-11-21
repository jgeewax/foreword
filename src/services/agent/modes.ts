// Agent modes for a conversation, told apart by what comes back (and Auto,
// which picks one of them for each message, auto-mode.ts): Write (the
// change, made), Ask (an answer, and nothing to change), Discuss (a view, the
// questions that would settle it, and directions to take), Review (changes to
// make one by one), Options (alternatives to choose from, as many as the
// author chose) and Figures (diagrams, charts, illustrations as code). Each mode is the app's own: the agent stays in its
// usual mode (never Claude Code's or Codex's plan mode, which write their
// answer to a file and ask to leave), the app's rules block changes when it's
// read-only, and an instruction entry shapes the reply.
import { ASK_INSTRUCTIONS, ASK_REMINDER } from './ask-mode';
import { DISCUSS_INSTRUCTIONS, DISCUSS_REMINDER, WRITE_FROM_DISCUSSION_PROMPT } from './discuss-mode';
import { FIGURES_INSTRUCTIONS } from './figures-mode';
import { OPTIONS_INSTRUCTIONS } from './options-mode';
import { REVIEW_INSTRUCTIONS, REVIEW_REMINDER } from './review-mode';
import { WRITE_INSTRUCTIONS, WRITE_REMINDER } from './write-mode';

export type AgentMode = 'write' | 'ask' | 'discuss' | 'review' | 'options' | 'figures';

export const AGENT_MODES: AgentMode[] = ['write', 'ask', 'discuss', 'review', 'options', 'figures'];

/**
 * What the mode menu offers: Auto, where Foreword picks one of the modes for
 * each message the author types (auto-mode.ts), and the modes themselves.
 */
export type ChatMode = AgentMode | 'auto';

export const CHAT_MODES: ChatMode[] = ['auto', ...AGENT_MODES];

/** Auto in the mode menu, the message box and the chat. */
export const AUTO_MENU = {
  label: 'Auto',
  icon: '✦',
  description: 'Picks the mode for each message from what you ask: a change made, an answer, a review, a discussion, versions or a figure.',
  placeholder: 'Ask about the book, or ask for a change…',
  notice: 'Auto: each message goes in the mode that fits what you ask, shown beside the box before you send. Only a request for a change goes in Write.',
};

/** The mode menu's entry for a mode, or for Auto. */
export const menuEntry = (m: ChatMode): Pick<ModeConfig, 'label' | 'icon' | 'description' | 'placeholder' | 'notice'> => (m === 'auto' ? AUTO_MENU : modeConfig(m));

/** A mode or Auto by name ("auto", "Review", "plan"), or null. */
export function chatModeNamed(word: string): ChatMode | null {
  return word.trim().toLowerCase() === 'auto' ? 'auto' : modeNamed(word);
}

/**
 * The mode a button's request goes in (Fix this error, a TODO…), whatever mode
 * the chat was left in: one of them, or 'edit', a change to the book, made in
 * Write, or in Figures if the chat is in it (it edits too).
 */
export type RequestMode = AgentMode | 'edit';

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
  /** Sent with every message in the mode, after the author's words: how to reply (null: nothing). */
  reminder: string | null;
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

/** The next in the mode menu, Auto first (⇧Tab in the composer cycles through them). */
export const nextMode = (mode: ChatMode): ChatMode => CHAT_MODES[(CHAT_MODES.indexOf(mode) + 1) % CHAT_MODES.length];

export function modeConfig(mode: AgentMode): ModeConfig {
  switch (mode) {
    case 'ask':
      return {
        readOnly: true,
        instructions: ASK_INSTRUCTIONS,
        label: 'Ask',
        icon: '?',
        description: 'Questions about the book, a passage or a change, answered in the chat. Suggests no changes.',
        placeholder: 'Ask about the book, a passage, a change, a TODO…',
        notice: 'Ask mode: the agent answers in the chat. It suggests no changes, and can’t make any.',
        carryOut: null,
        go: 'Just answer',
        reminder: ASK_REMINDER,
      };
    case 'discuss':
      return {
        readOnly: true,
        instructions: DISCUSS_INSTRUCTIONS,
        label: 'Discuss',
        icon: '⇄',
        description: 'Think a passage or a direction through: it says what it thinks, asks what would settle it, and offers directions.',
        placeholder: 'What should we think through? “I’m not sure this section adds anything”…',
        notice: 'Discuss mode: the agent weighs it with you, argues back and offers directions to take. It can’t change files.',
        carryOut: { question: 'Settled?', label: 'Write it', prompt: WRITE_FROM_DISCUSSION_PROMPT },
        go: 'Talk it through',
        reminder: DISCUSS_REMINDER,
      };
    case 'review':
      return {
        readOnly: true,
        instructions: REVIEW_INSTRUCTIONS,
        label: 'Review',
        icon: '✓',
        description: 'What isn’t working in the selection, or in what you name: a change for each problem, to make or skip.',
        placeholder: 'What should it review, and for what? “Chapter 3, for clarity”…',
        notice: 'Review mode: the agent reviews what you point it to and suggests a change for each problem; you make the ones you want.',
        carryOut: null,
        go: 'Review it',
        reminder: REVIEW_REMINDER,
      };
    case 'options':
      return {
        readOnly: true,
        instructions: OPTIONS_INSTRUCTIONS,
        label: 'Options',
        icon: '⑂',
        description: 'Versions of the selected text to pick from, as many as you choose. Can’t change files.',
        placeholder: 'Select text, then say what to change (e.g. “make it punchier”)…',
        notice: 'Options mode: select text and ask for a change; you’ll get versions to choose from (how many is beside the mode).',
        carryOut: null,
        go: 'Show versions',
        // How many to write: studio's modeReminder (optionsReminder), from the settings.
        reminder: null,
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
        reminder: null,
      };
    case 'write':
      return {
        readOnly: false,
        instructions: WRITE_INSTRUCTIONS,
        label: 'Write',
        icon: '✎',
        description: 'Write and edit the book.',
        placeholder: 'Ask about the selection, or request an edit…',
        notice: 'Write mode: the agent writes and edits the book.',
        carryOut: null,
        go: 'Write it',
        reminder: WRITE_REMINDER,
      };
  }
}
