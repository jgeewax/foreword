import type { ModelInfo, ModelRef } from './types';

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
