import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/opencode-events.jsonl?raw';
import { mapOpenCodeEvent } from './opencode-events';
import type { AgentEvent } from './types';

// Recorded from OpenCode 2.0.20 with litellm/gemini-3.8-flash: turn 1 reads
// main.typ and answers; turn 2 attempts an edit, which is rejected.
const recorded: unknown[] = fixture
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const mapped = recorded.map(mapOpenCodeEvent).filter((e): e is AgentEvent => e !== null);
const ofType = <T extends AgentEvent['type']>(t: T) => mapped.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === t);

describe('mapOpenCodeEvent (recorded session)', () => {
  it('maps every event to the same session', () => {
    const ids = new Set(mapped.map((e) => ('sessionId' in e ? e.sessionId : '')));
    expect(ids).toEqual(new Set(['ses_eba5a451effeajn5r0kguCSxJb']));
  });

  it('reports the read tool call with its input and output', () => {
    const [started] = ofType('tool-started');
    expect(started.name).toBe('read');
    const called = ofType('tool-called').find((e) => e.callId === started.callId)!;
    expect(called.input).toEqual({ path: 'main.typ' });
    const ok = ofType('tool-succeeded').find((e) => e.callId === started.callId)!;
    expect(ok.output).toContain('Read file main.typ');
  });

  it('streams text deltas that add up to the final text', () => {
    const deltas = ofType('text-delta').map((e) => e.delta).join('');
    const [ended] = ofType('text-ended');
    expect(deltas).toBe(ended.text);
    expect(ended.text).toContain('chapters/ch2-eigenvalues.typ');
  });

  it('ends turn 1 with succeeded', () => {
    expect(ofType('turn-finished')).toEqual([{ type: 'turn-finished', sessionId: 'ses_eba5a451effeajn5r0kguCSxJb', outcome: 'succeeded', error: undefined }]);
  });

  it('surfaces the edit permission with the proposed patch, then the rejection', () => {
    const [asked] = ofType('permission-asked');
    expect(asked.action).toBe('edit');
    expect(asked.resources).toEqual(['chapters/ch1-vectors.typ']);
    expect(asked.patches[0].file).toBe('chapters/ch1-vectors.typ');
    expect(asked.patches[0].patch).toContain('@@');
    const [replied] = ofType('permission-replied');
    expect(replied).toMatchObject({ requestId: asked.requestId, reply: 'reject' });
    const failed = ofType('tool-failed').at(-1)!;
    expect(failed.error).toBe('Exploration run: rejecting edit.');
  });

  it('keeps event order: tool before text, permission before tool failure', () => {
    const order = mapped.map((e) => e.type);
    expect(order.indexOf('tool-succeeded')).toBeLessThan(order.indexOf('text-delta'));
    expect(order.indexOf('permission-asked')).toBeLessThan(order.lastIndexOf('tool-failed'));
  });
});

describe('mapOpenCodeEvent (synthetic)', () => {
  it('maps bridge connection markers', () => {
    expect(mapOpenCodeEvent({ $connection: 'open' })).toEqual({ type: 'connection', status: 'open' });
    expect(mapOpenCodeEvent({ $connection: 'lost' })).toEqual({ type: 'connection', status: 'lost' });
  });

  it('treats unknown execution endings as finished, never as still running', () => {
    expect(mapOpenCodeEvent({ type: 'session.execution.failed', data: { sessionID: 's', error: { message: 'model 404' } } })).toEqual({
      type: 'turn-finished',
      sessionId: 's',
      outcome: 'failed',
      error: 'model 404',
    });
    expect(mapOpenCodeEvent({ type: 'session.execution.interrupted', data: { sessionID: 's' } })).toMatchObject({ outcome: 'interrupted' });
  });

  it('maps thinking and retries (as recorded from OpenCode 2.0.20)', () => {
    const m = 'msg_1';
    expect(mapOpenCodeEvent({ type: 'session.step.started', data: { sessionID: 's', assistantMessageID: m } })).toEqual({ type: 'step-started', sessionId: 's' });
    expect(mapOpenCodeEvent({ type: 'session.reasoning.delta', data: { sessionID: 's', assistantMessageID: m, ordinal: 0, delta: 'The task' } })).toEqual({
      type: 'reasoning-delta',
      sessionId: 's',
      messageId: m,
      ordinal: 0,
      delta: 'The task',
    });
    expect(mapOpenCodeEvent({ type: 'session.reasoning.ended', data: { sessionID: 's', assistantMessageID: m, ordinal: 0, text: 'The task: read it.' } })).toMatchObject({
      type: 'reasoning-ended',
      text: 'The task: read it.',
    });
    expect(
      mapOpenCodeEvent({
        type: 'session.retry.scheduled',
        data: { sessionID: 's', attempt: 2, at: 1792230262146, error: { type: 'provider.rate-limit', message: 'Upstream request failed: Endpoint is unavailable.', status: 429 } },
      }),
    ).toEqual({ type: 'retry-scheduled', sessionId: 's', attempt: 2, at: 1792230262146, message: 'Upstream request failed: Endpoint is unavailable.' });
  });

  it('ignores heartbeats and unrelated events', () => {
    expect(mapOpenCodeEvent(null)).toBeNull();
    expect(mapOpenCodeEvent({ type: 'project.updated', data: {} })).toBeNull();
  });
});
