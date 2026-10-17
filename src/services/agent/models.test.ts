import { describe, expect, it } from 'vitest';
import { chooseModel } from './models';
import type { ModelInfo } from './types';

const m = (providerID: string, id: string, supportsTools = true): ModelInfo => ({
  providerID,
  id,
  name: id,
  providerName: providerID,
  supportsTools,
});

// Shaped like the real list: LM Studio sorts first and includes models without tool support.
const models = [m('lmstudio', 'muse-glimmer-30b', false), m('lmstudio', 'qwen3.8-27b-mlx'), m('litellm', 'gemini-3.8-flash'), m('openai', 'gpt-x')];

describe('chooseModel', () => {
  it('never auto-picks a model without tool support (the reported bug)', () => {
    expect(chooseModel(models, { serverDefault: { providerID: 'opencode', id: 'exo-free' } })?.id).toBe('gemini-3.8-flash');
  });

  it('keeps the current model, then the saved one, then the server default', () => {
    const saved = { providerID: 'openai', id: 'gpt-x' };
    expect(chooseModel(models, { current: { providerID: 'lmstudio', id: 'qwen3.8-27b-mlx' }, saved })?.id).toBe('qwen3.8-27b-mlx');
    expect(chooseModel(models, { saved })?.id).toBe('gpt-x');
    expect(chooseModel(models, { serverDefault: saved })?.id).toBe('gpt-x');
  });

  it('ignores a saved choice that lost tool support or disappeared', () => {
    expect(chooseModel(models, { saved: { providerID: 'lmstudio', id: 'muse-glimmer-30b' } })?.id).toBe('gemini-3.8-flash');
    expect(chooseModel(models, { saved: { providerID: 'gone', id: 'x' } })?.id).toBe('gemini-3.8-flash');
  });

  it('falls back to any tool-capable model, or null', () => {
    expect(chooseModel([m('openai', 'a', false), m('openai', 'b')], {})?.id).toBe('b');
    expect(chooseModel([m('openai', 'a', false)], {})).toBeNull();
  });
});
