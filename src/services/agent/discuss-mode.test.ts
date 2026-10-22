import { describe, expect, it } from 'vitest';
import { DISCUSS_INSTRUCTIONS, WRITE_FROM_DISCUSSION_PROMPT } from './discuss-mode';

describe('discuss mode text', () => {
  it('has a view and argues back, in short turns, with no outline unless asked', () => {
    expect(DISCUSS_INSTRUCTIONS).toMatch(/must not edit, create, or delete files/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/say which you'd pick and why/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/Push back/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/No outline, plan or draft unless the author asks for one/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/When something is settled, say so in a line/);
  });

  it('still outlines when asked: the short form first, then the part picked', () => {
    expect(DISCUSS_INSTRUCTIONS).toMatch(/give the short form first/);
    expect(DISCUSS_INSTRUCTIONS).toMatch(/expand a part when they pick it/);
  });

  it('"Write it" says what was agreed, then writes it in the book voice, or says nothing was', () => {
    expect(WRITE_FROM_DISCUSSION_PROMPT).toMatch(/First say, in a few short lines, what we agreed/);
    expect(WRITE_FROM_DISCUSSION_PROMPT).toMatch(/style guide/);
    expect(WRITE_FROM_DISCUSSION_PROMPT).toMatch(/If we didn't settle on anything to write, say so/);
  });
});
