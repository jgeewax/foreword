import { describe, expect, it } from 'vitest';
import { ASK_INSTRUCTIONS } from './ask-mode';
import { FIGURES_INSTRUCTIONS, FIGURE_PACKAGES } from './figures-mode';
import { DISCUSS_INSTRUCTIONS } from './discuss-mode';
import { AGENT_MODES, modeChoiceMessage, modeConfig, modeNamed, modeOffer, nextMode, withoutModeOffer } from './modes';
import { REMINDER_START } from './message-context';
import { OPTIONS_INSTRUCTIONS } from './options-mode';

describe('modeConfig', () => {
  it('only Write and Figures can change files', () => {
    expect(AGENT_MODES.filter((m) => !modeConfig(m).readOnly)).toEqual(['write', 'figures']);
  });

  it('Ask comes after Write; ⇧Tab goes round', () => {
    expect(AGENT_MODES).toEqual(['write', 'ask', 'discuss', 'options', 'figures']);
    expect(nextMode('write')).toBe('ask');
    expect(nextMode('ask')).toBe('discuss');
    expect(nextMode('figures')).toBe('write');
  });

  it('knows a mode by its name in any case, and Plan as Discuss', () => {
    expect(modeNamed(' Discuss ')).toBe('discuss');
    expect(modeNamed('plan')).toBe('discuss');
    expect(modeNamed('Write')).toBe('write');
    expect(modeNamed('draft')).toBeNull();
  });

  it('Figures mode names exact, verified package versions', () => {
    expect(modeConfig('figures')).toMatchObject({ instructions: FIGURES_INSTRUCTIONS });
    for (const spec of Object.values(FIGURE_PACKAGES)) expect(FIGURES_INSTRUCTIONS).toContain(spec);
    expect(FIGURES_INSTRUCTIONS).toMatch(/can't paint or retouch pixels/);
  });

  it('each read-only mode has its own instructions', () => {
    expect(modeConfig('ask')).toMatchObject({ instructions: ASK_INSTRUCTIONS });
    expect(modeConfig('discuss')).toMatchObject({ instructions: DISCUSS_INSTRUCTIONS });
    expect(modeConfig('options')).toMatchObject({ instructions: OPTIONS_INSTRUCTIONS });
    expect(modeConfig('write')).toMatchObject({ instructions: null });
  });

  it('Ask and Discuss keep everything in the chat, and end in Write', () => {
    for (const mode of ['ask', 'discuss'] as const) {
      const c = modeConfig(mode);
      expect(c.instructions).toMatch(/must not edit, create, or delete files/);
      expect(c.instructions).toMatch(/goes in your reply, where the author reads it/);
      expect(c.carryOut?.prompt).toMatch(/edit(ing)? the files directly/);
    }
    expect(modeConfig('ask').carryOut?.label).toBe('Go ahead');
    expect(modeConfig('discuss').carryOut?.label).toBe('Write it');
    for (const mode of ['write', 'options', 'figures'] as const) expect(modeConfig(mode).carryOut).toBeNull();
  });

  it('a pick of the assistant’s two ways on goes as the author’s message, in its words', () => {
    const s = { mode: 'discuss', from: 'write', there: 'Weigh Sam against Ada with you.', here: 'Go with Sam and rewrite chapter 1.' } as const;
    expect(modeChoiceMessage(s, true)).toBe('Go on in Discuss mode, as you offered: “Weigh Sam against Ada with you.”');
    expect(modeChoiceMessage(s, false)).toBe('Stay in Write mode, as you offered: “Go with Sam and rewrite chapter 1.”');
    expect(AGENT_MODES.map((m) => modeConfig(m).go)).toEqual(['Write it', 'Just answer', 'Talk it through', 'Show three versions', 'Draw it']);
  });

  it('reads a reply’s offer of another mode, and leaves it out of the reply shown', () => {
    const reply = 'This is a question of direction.\n\n```mode\nmode: Discuss\nthere: Weigh the two orders with you.\nhere: Keep vectors first.\n```\n';
    expect(modeOffer(reply)).toEqual({ mode: 'discuss', there: 'Weigh the two orders with you.', here: 'Keep vectors first.' });
    expect(withoutModeOffer(reply)).toBe('This is a question of direction.');
    // Written loosely: bold keys, list dashes, quotes, the old name.
    expect(modeOffer('```mode\n- **mode**: plan\n- **there**: "Weigh it."\n- here: “Write it.”\n```')).toEqual({ mode: 'discuss', there: 'Weigh it.', here: 'Write it.' });
    // Still being written: hidden, but not an offer yet.
    expect(withoutModeOffer('Why.\n```mode\nmode: disc')).toBe('Why.');
    expect(modeOffer('Why.\n```mode\nmode: discuss\nthere: x\nhere: y')).toBeNull();
    // Missing a way, or a mode there isn't: no offer.
    expect(modeOffer('```mode\nmode: discuss\nthere: Weigh it.\n```')).toBeNull();
    expect(modeOffer('```mode\nmode: draft\nthere: x\nhere: y\n```')).toBeNull();
    // Words after the block stay; a ```mode-less reply is untouched.
    expect(withoutModeOffer('A.\n```mode\nmode: ask\nthere: x\nhere: y\n```\nB.')).toBe('A.\n\nB.');
    expect(withoutModeOffer('No offer here.')).toBe('No offer here.');
    // A long way is kept whole for the message (the card shows a few lines), up to a point.
    expect(modeOffer(`\`\`\`mode\nmode: options\nthere: ${'x'.repeat(400)}\nhere: y\n\`\`\``)?.there).toHaveLength(400);
    expect(modeOffer(`\`\`\`mode\nmode: options\nthere: ${'x'.repeat(900)}\nhere: y\n\`\`\``)?.there).toHaveLength(600);
  });

  it('Ask gives the question back first, as a question, and leaves the change for the card or Go ahead', () => {
    const { instructions, carryOut } = modeConfig('ask');
    expect(instructions).toMatch(/Before you read or search anything, give the question back/);
    expect(instructions).toMatch(/as a question in the author's voice .*never "Whether…"/);
    expect(instructions).toMatch(/put the other on an `other:` line, also as a question, rather than asking which/);
    expect(instructions).toMatch(/every reply in this mode as an answer card.*a request to check or review a passage/);
    expect(instructions).toMatch(/don't ask which to make or whether to, with your question tool or in words: here that takes the place of asking the author/);
    expect(instructions).toMatch(/press Make this change on the card, or Go ahead/);
    expect(carryOut?.prompt).toMatch(/If we didn't settle on a change, say so/);
  });

  it('only Ask sends a reminder with each message, and the chat knows where it starts', () => {
    expect(AGENT_MODES.filter((m) => modeConfig(m).reminder)).toEqual(['ask']);
    expect(modeConfig('ask').reminder?.startsWith(REMINDER_START)).toBe(true);
  });
});
