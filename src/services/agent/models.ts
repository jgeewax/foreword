import type { EffortOption, ModelInfo, ModelRef } from './types';

/** Providers to fall back to, in order (SPEC §3: the initial custom route is the user's LiteLLM proxy). */
export const PREFERRED_PROVIDERS = ['litellm'];

const same = (a: ModelRef, b: ModelRef) => a.providerID === b.providerID && a.id === b.id;

/**
 * Pick the model to use: the current one, then the user's saved choice, then
 * the server default, then a tool-capable model from a preferred provider,
 * then any tool-capable model. Models without tool support are never picked
 * automatically: the agent reads and edits files through tools.
 */
export function chooseModel(
  models: ModelInfo[],
  opts: { current?: ModelRef | null; saved?: ModelRef | null; serverDefault?: ModelRef | null },
): ModelInfo | null {
  const usable = models.filter((m) => m.supportsTools);
  const find = (ref?: ModelRef | null) => (ref ? usable.find((m) => same(m, ref)) : undefined);
  return (
    find(opts.current) ??
    find(opts.saved) ??
    find(opts.serverDefault) ??
    PREFERRED_PROVIDERS.map((p) => usable.find((m) => m.providerID === p)).find(Boolean) ??
    usable[0] ??
    null
  );
}

/** Effort levels' names and what they mean, for the chat's menu (an agent's own words win). */
const EFFORT_WORDS: Record<string, [name: string, description: string]> = {
  default: ['Default', 'The model’s own setting'],
  none: ['None', 'Answers without thinking first'],
  minimal: ['Minimal', 'Hardly thinks: the fastest'],
  low: ['Low', 'Quick: small edits and questions'],
  medium: ['Medium', 'Balances speed and depth'],
  high: ['High', 'Thinks harder: rewrites and structure'],
  xhigh: ['Extra high', 'Thinks longer still, for the hardest passages'],
  max: ['Max', 'As much thought as it can: slow'],
  ultra: ['Ultra', 'The most thorough of all: the slowest'],
};

/** An effort level as the menu shows it: our name for the known ones ("Xhigh" is "Extra high"), the agent's description if it has one. */
export function effortOption(value: string, name?: string | null, description?: string | null): EffortOption {
  const known = EFFORT_WORDS[value.toLowerCase()];
  const label = known?.[0] ?? (name?.trim() || value.charAt(0).toUpperCase() + value.slice(1));
  const about = description?.trim() || known?.[1];
  return about ? { value, name: label, description: about } : { value, name: label };
}

/** Where a model's effort is remembered (per model: levels differ between models). */
export const effortKey = (m: ModelRef) => `${m.providerID}/${m.id}`;

/** The level a word names, for /effort: its value or name exactly ("xhigh", "Extra high"), or the one level it starts ("extra", "med"). */
export function effortFor(word: string, options: EffortOption[]): EffortOption | null {
  const w = word.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!w) return null;
  const norm = (t: string) => t.toLowerCase().replace(/[\s_-]+/g, ' ');
  const exact = options.find((o) => norm(o.value) === w || norm(o.name) === w);
  if (exact) return exact;
  const starts = options.filter((o) => norm(o.value).startsWith(w) || norm(o.name).startsWith(w));
  return starts.length === 1 ? starts[0] : null;
}
