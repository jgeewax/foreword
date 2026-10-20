// Agent modes for a conversation: Write (edits the book), Ask (questions and
// discussion), Plan (outline first), Options (three alternatives to choose
// from) and Figures (diagrams, charts, illustrations as code). Each mode is the
// app's own: the agent stays in its usual mode (never Claude Code's or Codex's
// plan mode, which write their answer to a file and ask to leave), the app's
// rules block changes when it's read-only, and an instruction entry shapes the reply.
import { ASK_INSTRUCTIONS, GO_AHEAD_PROMPT } from './ask-mode';
import { FIGURES_INSTRUCTIONS } from './figures-mode';
import { OPTIONS_INSTRUCTIONS } from './options-mode';
import { PLAN_INSTRUCTIONS, WRITE_FROM_PLAN_PROMPT } from './plan-mode';

export type AgentMode = 'write' | 'ask' | 'plan' | 'options' | 'figures';

export const AGENT_MODES: AgentMode[] = ['write', 'ask', 'plan', 'options', 'figures'];

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
};

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
        description: 'Questions and discussion, answered in the chat. Can’t change files.',
        placeholder: 'Ask about the book, a passage, a TODO…',
        notice: 'Ask mode: the agent answers and discusses in the chat, and can’t change files.',
        carryOut: { question: 'Want it changed?', label: 'Go ahead', prompt: GO_AHEAD_PROMPT },
      };
    case 'plan':
      return {
        readOnly: true,
        instructions: PLAN_INSTRUCTIONS,
        label: 'Plan',
        icon: '☰',
        description: 'Talk it through and outline before writing. Can’t change files.',
        placeholder: 'What should we plan? A chapter, a section, an argument…',
        notice: 'Plan mode: the agent discusses and outlines, and can’t change files.',
        carryOut: { question: 'Happy with the plan?', label: 'Write it', prompt: WRITE_FROM_PLAN_PROMPT },
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
      };
  }
}
