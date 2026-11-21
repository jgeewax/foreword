import { describe, expect, it } from 'vitest';
import { ASK_INSTRUCTIONS } from './ask-mode';
import { FIGURES_INSTRUCTIONS, FIGURE_PACKAGES } from './figures-mode';
import { DISCUSS_INSTRUCTIONS } from './discuss-mode';
import { AGENT_MODES, modeChoiceMessage, modeConfig, modeNamed, modeOffer, nextMode, withoutModeOffer } from './modes';
import { REMINDER_START } from './message-context';
import { OPTIONS_INSTRUCTIONS } from './options-mode';
import { REVIEW_INSTRUCTIONS } from './review-mode';
import { WRITE_INSTRUCTIONS } from './write-mode';
import { answerOf } from './ask-answer';

describe('modeConfig', () => {
  it('only Write and Figures can change files', () => {
    expect(AGENT_MODES.filter((m) => !modeConfig(m).readOnly)).toEqual(['write', 'figures']);
  });

  it('Ask comes after Write, Review after Discuss; ⇧Tab goes round', () => {
    expect(AGENT_MODES).toEqual(['write', 'ask', 'discuss', 'review', 'options', 'figures']);
    expect(nextMode('write')).toBe('ask');
    expect(nextMode('ask')).toBe('discuss');
    expect(nextMode('discuss')).toBe('review');
    expect(nextMode('review')).toBe('options');
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

  it('each mode has its own instructions', () => {
    expect(modeConfig('ask')).toMatchObject({ instructions: ASK_INSTRUCTIONS });
    expect(modeConfig('discuss')).toMatchObject({ instructions: DISCUSS_INSTRUCTIONS });
    expect(modeConfig('options')).toMatchObject({ instructions: OPTIONS_INSTRUCTIONS });
    expect(modeConfig('review')).toMatchObject({ instructions: REVIEW_INSTRUCTIONS });
    expect(modeConfig('write')).toMatchObject({ instructions: WRITE_INSTRUCTIONS });
  });

  it('Write answers a question about the text before it changes anything, and makes a request worded as one', () => {
    expect(WRITE_INSTRUCTIONS).toMatch(/Answer it, and don't change the book in this turn/);
    expect(WRITE_INSTRUCTIONS).toMatch(/Lead with your view in the first sentence/);
    expect(WRITE_INSTRUCTIONS).toMatch(/A request asks for a change, however politely it's put: "tighten this", "can you tighten this\?"/);
    // Its one change is a card the chat draws, as Ask's are.
    const example = /```change[\s\S]*?```/.exec(WRITE_INSTRUCTIONS)![0];
    expect(answerOf([example])?.changes).toEqual([expect.objectContaining({ at: 'chapters/04-storm.typ:114', why: 'Show him hiding it', complete: true })]);
  });

  it('Ask, Discuss and Review keep everything in the chat; only Discuss ends in Write', () => {
    for (const mode of ['ask', 'discuss', 'review'] as const) {
      const c = modeConfig(mode);
      expect(c.instructions).toMatch(/must not edit, create, or delete files/);
      expect(c.instructions).toMatch(/goes in your reply, where the author reads it/);
    }
    expect(modeConfig('discuss').carryOut).toMatchObject({ label: 'Write it', prompt: expect.stringMatching(/editing the files directly/) });
    // Ask answers, and Review's changes are made from its card: neither has a Go ahead.
    for (const mode of ['write', 'ask', 'review', 'options', 'figures'] as const) expect(modeConfig(mode).carryOut).toBeNull();
  });

  it('a pick of the assistant’s two ways on goes as the author’s message, in its words', () => {
    const s = { mode: 'discuss', from: 'write', there: 'Weigh Sam against Ada with you.', here: 'Go with Sam and rewrite chapter 1.' } as const;
    expect(modeChoiceMessage(s, true)).toBe('Go on in Discuss mode, as you offered: “Weigh Sam against Ada with you.”');
    expect(modeChoiceMessage(s, false)).toBe('Stay in Write mode, as you offered: “Go with Sam and rewrite chapter 1.”');
    expect(AGENT_MODES.map((m) => modeConfig(m).go)).toEqual(['Write it', 'Just answer', 'Talk it through', 'Review it', 'Show versions', 'Draw it']);
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

  it('Ask gives the question back first, as a question, and answers it with nothing to change', () => {
    const { instructions, reminder } = modeConfig('ask');
    expect(instructions).toMatch(/Before you read or search anything, give the question back/);
    expect(instructions).toMatch(/as a question in the author's voice .*never "Whether…"/);
    expect(instructions).toMatch(/put the other on an `other:` line, also as a question, rather than asking which/);
    expect(instructions).toMatch(/no changes, and no suggested changes/);
    expect(instructions).toMatch(/Don't suggest changes: no change blocks, no rewritten sentences or drafts, no list of fixes/);
    // What it found to fix goes to Review, a follow-up away.
    expect(instructions).toMatch(/offer it as a follow-up in Review \(`next: .* \| review`\)/);
    expect(instructions).not.toMatch(/```change/);
    expect(reminder).toMatch(/Answer only: no ```change blocks/);
  });

  it('Review says what it reviews first, then a verdict, then a change a problem, made from the card', () => {
    const { instructions, reminder, readOnly, label } = modeConfig('review');
    expect({ readOnly, label }).toEqual({ readOnly: true, label: 'Review' });
    expect(instructions).toMatch(/Before you read or search anything, say back what you'll review and for what/);
    expect(instructions).toMatch(/Only real problems/);
    expect(instructions).toMatch(/don't invent fixes/);
    expect(instructions).toMatch(/a proofread fixes mistakes and nothing else/);
    expect(instructions).toMatch(/offer it as a follow-up in Discuss/);
    expect(instructions).toMatch(/don't ask which to make or whether to, with your question tool or in words: the card does that/);
    // The author's comments are the Review list's, not this mode's.
    expect(instructions).toMatch(/in the Review list/);
    expect(reminder).toMatch(/a ```change block for each real problem/);
    // Its examples read as the card: what it reviews, the verdict, a change that cuts a sentence.
    const answer = answerOf([instructions!]);
    expect(answer).toMatchObject({ asked: expect.stringMatching(/^Is the argument in section 2\.3 clear/), answer: expect.stringMatching(/^Mostly clear/) });
    expect(answer?.next).toEqual([{ text: 'Should the lemma move to section 2.2?', mode: 'discuss' }]);
    expect(answer?.changes).toEqual([expect.objectContaining({ at: 'chapters/02-spaces.typ:152', replace: '', complete: true })]);
  });

  it('Write, Ask, Discuss and Review send a reminder with each message, and the chat knows where it starts', () => {
    expect(AGENT_MODES.filter((m) => modeConfig(m).reminder)).toEqual(['write', 'ask', 'discuss', 'review']);
    for (const m of ['write', 'ask', 'discuss', 'review'] as const) expect(modeConfig(m).reminder?.startsWith(REMINDER_START)).toBe(true);
    expect(modeConfig('write').reminder).toMatch(/a request for a change, "can you…" and "could you…" too, is made in the files now; a question about what you think of the text is answered, with nothing changed/);
  });
});
