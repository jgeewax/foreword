import { describe, expect, it } from 'vitest';
import { AGENT_MODES, modeConfig } from './modes';
import { OPTIONS_INSTRUCTIONS } from './options-mode';
import { PLAN_INSTRUCTIONS } from './plan-mode';

describe('modeConfig', () => {
  it('only Write mode can change files', () => {
    expect(AGENT_MODES.filter((m) => !modeConfig(m).readOnly)).toEqual(['write']);
  });

  it('uses the plan agent for Plan, and each read-only mode has its own instructions', () => {
    expect(modeConfig('plan')).toMatchObject({ agent: 'plan', instructions: PLAN_INSTRUCTIONS });
    expect(modeConfig('options')).toMatchObject({ agent: 'build', instructions: OPTIONS_INSTRUCTIONS });
    expect(modeConfig('write')).toMatchObject({ agent: 'build', instructions: null });
  });
});
