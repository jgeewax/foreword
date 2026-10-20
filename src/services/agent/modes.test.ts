import { describe, expect, it } from 'vitest';
import { ASK_INSTRUCTIONS } from './ask-mode';
import { FIGURES_INSTRUCTIONS, FIGURE_PACKAGES } from './figures-mode';
import { AGENT_MODES, modeConfig, nextMode } from './modes';
import { OPTIONS_INSTRUCTIONS } from './options-mode';
import { PLAN_INSTRUCTIONS } from './plan-mode';

describe('modeConfig', () => {
  it('only Write and Figures can change files', () => {
    expect(AGENT_MODES.filter((m) => !modeConfig(m).readOnly)).toEqual(['write', 'figures']);
  });

  it('Ask comes after Write; ⇧Tab goes round', () => {
    expect(AGENT_MODES).toEqual(['write', 'ask', 'plan', 'options', 'figures']);
    expect(nextMode('write')).toBe('ask');
    expect(nextMode('figures')).toBe('write');
  });

  it('Figures mode names exact, verified package versions', () => {
    expect(modeConfig('figures')).toMatchObject({ instructions: FIGURES_INSTRUCTIONS });
    for (const spec of Object.values(FIGURE_PACKAGES)) expect(FIGURES_INSTRUCTIONS).toContain(spec);
    expect(FIGURES_INSTRUCTIONS).toMatch(/can't paint or retouch pixels/);
  });

  it('each read-only mode has its own instructions', () => {
    expect(modeConfig('ask')).toMatchObject({ instructions: ASK_INSTRUCTIONS });
    expect(modeConfig('plan')).toMatchObject({ instructions: PLAN_INSTRUCTIONS });
    expect(modeConfig('options')).toMatchObject({ instructions: OPTIONS_INSTRUCTIONS });
    expect(modeConfig('write')).toMatchObject({ instructions: null });
  });

  it('Ask and Plan keep everything in the chat, and end in Write', () => {
    for (const mode of ['ask', 'plan'] as const) {
      const c = modeConfig(mode);
      expect(c.instructions).toMatch(/must not edit, create, or delete files/);
      expect(c.instructions).toMatch(/goes in your reply, where the author reads it/);
      expect(c.carryOut?.prompt).toMatch(/edit(ing)? the files directly/);
    }
    expect(modeConfig('ask').carryOut?.label).toBe('Go ahead');
    expect(modeConfig('plan').carryOut?.label).toBe('Write it');
    for (const mode of ['write', 'options', 'figures'] as const) expect(modeConfig(mode).carryOut).toBeNull();
  });

  it('Ask answers first, and leaves the change for Go ahead', () => {
    const { instructions, carryOut } = modeConfig('ask');
    expect(instructions).toMatch(/Answer the question first/);
    expect(instructions).toMatch(/Don't make the change/);
    expect(carryOut?.prompt).toMatch(/If we didn't settle on a change, say so/);
  });
});
