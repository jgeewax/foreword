// Agent modes for a conversation: Write (edits the book), Plan (discuss and
// outline first) and Options (three alternatives to choose from). Each mode
// picks an OpenCode agent, whether edits are blocked, and an instruction entry.
import { OPTIONS_INSTRUCTIONS } from './options-mode';
import { PLAN_INSTRUCTIONS } from './plan-mode';

export type AgentMode = 'write' | 'plan' | 'options';

export const AGENT_MODES: AgentMode[] = ['write', 'plan', 'options'];

export const MODE_INSTRUCTIONS_KEY = 'mode';

export type ModeConfig = {
  agent: 'build' | 'plan';
  /** No file changes and no commands, whatever the edit setting. */
  readOnly: boolean;
  instructions: string | null;
  label: string;
  /** Tooltip on the mode switch. */
  description: string;
  /** Chat notice when switching to the mode mid-conversation. */
  notice: string;
};

export function modeConfig(mode: AgentMode): ModeConfig {
  switch (mode) {
    case 'plan':
      return {
        agent: 'plan',
        readOnly: true,
        instructions: PLAN_INSTRUCTIONS,
        label: 'Plan',
        description: 'Discuss and outline first; the agent can’t change files',
        notice: 'Plan mode: the agent discusses and outlines, and can’t change files.',
      };
    case 'options':
      return {
        agent: 'build',
        readOnly: true,
        instructions: OPTIONS_INSTRUCTIONS,
        label: 'Options',
        description: 'Get three versions of the selected text and pick one; the agent can’t change files',
        notice: 'Options mode: select text and ask for a change; you’ll get three versions to choose from.',
      };
    case 'write':
      return {
        agent: 'build',
        readOnly: false,
        instructions: null,
        label: 'Write',
        description: 'The agent writes and edits the book',
        notice: 'Write mode: the agent can edit the book again.',
      };
  }
}
