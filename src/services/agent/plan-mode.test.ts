import { describe, expect, it } from 'vitest';
import { PLAN_INSTRUCTIONS, WRITE_FROM_PLAN_PROMPT } from './plan-mode';

describe('plan mode text', () => {
  it('asks for the short form first (narrative + one-line outline), then expansion on request', () => {
    expect(PLAN_INSTRUCTIONS).toMatch(/must not edit, create, or delete files/);
    expect(PLAN_INSTRUCTIONS).toMatch(/Short form first/);
    expect(PLAN_INSTRUCTIONS).toMatch(/numbered outline with one line per section/);
    expect(PLAN_INSTRUCTIONS).toMatch(/expand only that part, in detail/);
  });

  it('"Write it" asks the agent to carry out the agreed plan in the book voice', () => {
    expect(WRITE_FROM_PLAN_PROMPT).toMatch(/Follow the plan we agreed/);
    expect(WRITE_FROM_PLAN_PROMPT).toMatch(/style guide/);
  });
});
