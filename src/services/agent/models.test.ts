import { describe, expect, it } from 'vitest';
import { chooseModel, effortFor, effortOption } from './models';
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

describe('effort levels', () => {
  it('have our names for the known ones, and the agent’s description when it gives one', () => {
    expect(effortOption('xhigh', 'Xhigh')).toEqual({ value: 'xhigh', name: 'Extra high', description: 'Thinks longer still, for the hardest passages' });
    expect(effortOption('low', 'Low', 'Fast responses with lighter reasoning')).toEqual({ value: 'low', name: 'Low', description: 'Fast responses with lighter reasoning' });
    expect(effortOption('turbo', 'Turbo mode')).toEqual({ value: 'turbo', name: 'Turbo mode' });
    expect(effortOption('turbo')).toEqual({ value: 'turbo', name: 'Turbo' });
  });

  it('are found by a word, for /effort', () => {
    const levels = ['default', 'low', 'medium', 'high', 'xhigh', 'max'].map((v) => effortOption(v));
    expect(effortFor('high', levels)?.value).toBe('high');
    expect(effortFor('xhigh', levels)?.value).toBe('xhigh');
    expect(effortFor('Extra high', levels)?.value).toBe('xhigh');
    expect(effortFor('extra-high', levels)?.value).toBe('xhigh');
    expect(effortFor('extra', levels)?.value).toBe('xhigh');
    expect(effortFor('med', levels)?.value).toBe('medium');
    expect(effortFor('m', levels)).toBeNull();
    expect(effortFor('ultra', levels)).toBeNull();
  });
});
