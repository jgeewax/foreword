// Model picker logic: search, recent models, grouping by provider.
import type { ModelInfo, ModelRef } from './types';

export const modelKey = (m: ModelRef) => `${m.providerID}/${m.id}`;

export type ModelSection = { title: string; models: ModelInfo[] };

/** Every query word must appear in the name, provider, or id (any order, case-insensitive). */
export function matchesQuery(m: ModelInfo, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${m.name} ${m.providerName} ${m.providerID} ${m.id}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Sections for the picker: "Recent" (only without a query), then one per
 * provider. Within a provider, tool-capable models first, then by name.
 */
export function modelSections(models: ModelInfo[], query: string, recent: ModelRef[]): ModelSection[] {
  const hits = models.filter((m) => matchesQuery(m, query));
  const sections: ModelSection[] = [];
  if (!query.trim()) {
    const byKey = new Map(hits.map((m) => [modelKey(m), m]));
    const recentModels = recent.map((r) => byKey.get(modelKey(r))).filter((m): m is ModelInfo => !!m && m.supportsTools);
    if (recentModels.length) sections.push({ title: 'Recent', models: recentModels.slice(0, 5) });
  }
  const byProvider = new Map<string, ModelInfo[]>();
  for (const m of hits) byProvider.set(m.providerName, [...(byProvider.get(m.providerName) ?? []), m]);
  for (const [title, ms] of [...byProvider].sort(([a], [b]) => a.localeCompare(b))) {
    ms.sort((a, b) => Number(b.supportsTools) - Number(a.supportsTools) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    sections.push({ title, models: ms });
  }
  return sections;
}

/** Selectable rows in display order (a model may appear in Recent and under its provider). */
export function selectableRows(sections: ModelSection[]): { section: number; model: ModelInfo }[] {
  return sections.flatMap((s, section) => s.models.filter((m) => m.supportsTools).map((model) => ({ section, model })));
}

/** Move the highlight by `delta` rows, wrapping around. */
export function moveHighlight(count: number, current: number, delta: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** Most-recently-used list, newest first, without duplicates. */
export function pushRecent(recent: ModelRef[], m: ModelRef, max = 8): ModelRef[] {
  return [{ providerID: m.providerID, id: m.id }, ...recent.filter((r) => modelKey(r) !== modelKey(m))].slice(0, max);
}

/** "200K", "1M" for context windows. */
export function formatContext(tokens: number | undefined): string {
  if (!tokens) return '';
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`;
  return `${Math.round(tokens / 1000)}K`;
}
