import { describe, expect, it } from 'vitest';
import { FIGURES_INSTRUCTIONS, FIGURE_PACKAGES } from './figures-mode';
import { AGENT_MODES, modeConfig } from './modes';
import { OPTIONS_INSTRUCTIONS } from './options-mode';
import { PLAN_INSTRUCTIONS } from './plan-mode';

describe('modeConfig', () => {
  it('only Write and Figures can change files', () => {
    expect(AGENT_MODES.filter((m) => !modeConfig(m).readOnly)).toEqual(['write', 'figures']);
  });

  it('Figures mode names exact, verified package versions', () => {
    expect(modeConfig('figures')).toMatchObject({ agent: 'build', instructions: FIGURES_INSTRUCTIONS });
    for (const spec of Object.values(FIGURE_PACKAGES)) expect(FIGURES_INSTRUCTIONS).toContain(spec);
    expect(FIGURES_INSTRUCTIONS).toMatch(/can't paint or retouch pixels/);
  });

  it('uses the plan agent for Plan, and each read-only mode has its own instructions', () => {
    expect(modeConfig('plan')).toMatchObject({ agent: 'plan', instructions: PLAN_INSTRUCTIONS });
    expect(modeConfig('options')).toMatchObject({ agent: 'build', instructions: OPTIONS_INSTRUCTIONS });
    expect(modeConfig('write')).toMatchObject({ agent: 'build', instructions: null });
  });
});
