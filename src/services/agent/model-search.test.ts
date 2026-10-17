import { describe, expect, it } from 'vitest';
import { formatContext, matchesQuery, modelSections, moveHighlight, pushRecent, selectableRows } from './model-search';
import type { ModelInfo } from './types';

const m = (providerID: string, providerName: string, id: string, supportsTools = true): ModelInfo => ({ providerID, providerName, id, name: id, supportsTools });
const models = [
  m('litellm', 'LiteLLM', 'gemini-3.8-flash'),
  m('litellm', 'LiteLLM', 'glm-5.3'),
  m('litellm', 'LiteLLM', 'kimi-k2.6'),
  m('lmstudio', 'LM Studio', 'muse-glimmer-30b', false),
  m('lmstudio', 'LM Studio', 'qwen3.8-27b-mlx'),
  m('openai', 'OpenAI', 'gpt-5.5'),
];

describe('matchesQuery', () => {
  it('matches every word anywhere in name, provider or id', () => {
    expect(matchesQuery(models[0], 'gemini')).toBe(true);
    expect(matchesQuery(models[0], 'flash lite')).toBe(true);
    expect(matchesQuery(models[0], 'FLASH')).toBe(true);
    expect(matchesQuery(models[0], 'flash openai')).toBe(false);
    expect(matchesQuery(models[0], '   ')).toBe(true);
  });
});

describe('modelSections', () => {
  it('groups by provider, alphabetically, with tool-capable models first', () => {
    const s = modelSections(models, '', []);
    expect(s.map((x) => x.title)).toEqual(['LiteLLM', 'LM Studio', 'OpenAI']);
    expect(s[1].models.map((x) => x.id)).toEqual(['qwen3.8-27b-mlx', 'muse-glimmer-30b']);
  });

  it('puts recent models first when not searching, skipping missing or tool-less ones', () => {
    const recent = [
      { providerID: 'openai', id: 'gpt-5.5' },
      { providerID: 'gone', id: 'x' },
      { providerID: 'lmstudio', id: 'muse-glimmer-30b' },
      { providerID: 'litellm', id: 'glm-5.3' },
    ];
    const s = modelSections(models, '', recent);
    expect(s[0]).toEqual({ title: 'Recent', models: [models[5], models[1]] });
    expect(modelSections(models, 'glm', recent).map((x) => x.title)).toEqual(['LiteLLM']);
  });

  it('only offers tool-capable models as selectable rows', () => {
    const rows = selectableRows(modelSections(models, 'studio', []));
    expect(rows.map((r) => r.model.id)).toEqual(['qwen3.8-27b-mlx']);
  });
});

describe('helpers', () => {
  it('moves the highlight with wrap-around', () => {
    expect(moveHighlight(3, -1, 1)).toBe(0);
    expect(moveHighlight(3, -1, -1)).toBe(2);
    expect(moveHighlight(3, 2, 1)).toBe(0);
    expect(moveHighlight(3, 0, -1)).toBe(2);
    expect(moveHighlight(0, 0, 1)).toBe(-1);
  });

  it('keeps a short most-recent-first list without duplicates', () => {
    const a = { providerID: 'p', id: 'a' };
    const b = { providerID: 'p', id: 'b' };
    expect(pushRecent([a, b], b)).toEqual([b, a]);
    expect(pushRecent(Array.from({ length: 8 }, (_, i) => ({ providerID: 'p', id: `${i}` })), a)).toHaveLength(8);
  });

  it('formats context windows', () => {
    expect(formatContext(200000)).toBe('200K');
    expect(formatContext(1048576)).toBe('1M');
    expect(formatContext(1500000)).toBe('1.5M');
    expect(formatContext(undefined)).toBe('');
  });
});
