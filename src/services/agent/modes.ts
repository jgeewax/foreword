// Agent modes for a conversation: Write (edits the book), Plan (discuss and
// outline first), Options (three alternatives to choose from) and Figures
// (diagrams, charts, illustrations as code). Each mode picks an OpenCode agent,
// whether edits are blocked, and an instruction entry.
import { FIGURES_INSTRUCTIONS } from './figures-mode';
import { OPTIONS_INSTRUCTIONS } from './options-mode';
import { PLAN_INSTRUCTIONS } from './plan-mode';

export type AgentMode = 'write' | 'plan' | 'options' | 'figures';

export const AGENT_MODES: AgentMode[] = ['write', 'plan', 'options', 'figures'];

export const MODE_INSTRUCTIONS_KEY = 'mode';

export type ModeConfig = {
  agent: 'build' | 'plan';
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
};

/** The next mode in the menu (⇧Tab in the composer cycles through them). */
export const nextMode = (mode: AgentMode): AgentMode => AGENT_MODES[(AGENT_MODES.indexOf(mode) + 1) % AGENT_MODES.length];

export function modeConfig(mode: AgentMode): ModeConfig {
  switch (mode) {
    case 'plan':
      return {
        agent: 'plan',
        readOnly: true,
        instructions: PLAN_INSTRUCTIONS,
        label: 'Plan',
        icon: '☰',
        description: 'Talk it through and outline before writing. Can’t change files.',
        placeholder: 'What should we plan? A chapter, a section, an argument…',
        notice: 'Plan mode: the agent discusses and outlines, and can’t change files.',
      };
    case 'options':
      return {
        agent: 'build',
        readOnly: true,
        instructions: OPTIONS_INSTRUCTIONS,
        label: 'Options',
        icon: '⑂',
        description: 'Three versions of the selected text to pick from. Can’t change files.',
        placeholder: 'Select text, then say what to change (e.g. “make it punchier”)…',
        notice: 'Options mode: select text and ask for a change; you’ll get three versions to choose from.',
      };
    case 'figures':
      return {
        agent: 'build',
        readOnly: false,
        instructions: FIGURES_INSTRUCTIONS,
        label: 'Figures',
        icon: '◫',
        description: 'Diagrams, charts, illustrations and tables, drawn as code you can see in the preview.',
        placeholder: 'Describe a figure: a flowchart of…, a chart of data/sales.csv, a diagram of…',
        notice: 'Figures mode: diagrams, charts, illustrations and tables, drawn as code you can see in the preview.',
      };
    case 'write':
      return {
        agent: 'build',
        readOnly: false,
        instructions: null,
        label: 'Write',
        icon: '✎',
        description: 'Write and edit the book.',
        placeholder: 'Ask about the selection, or request an edit…',
        notice: 'Write mode: the agent writes and edits the book.',
      };
  }
}
