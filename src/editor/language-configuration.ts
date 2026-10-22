// A VS Code language-configuration.json (Tinymist's, for Typst) as Monaco's
// LanguageConfiguration. VS Code accepts a pair as ["_", "_"] or { open, close };
// Monaco reads only the object, so the array form silently turns the pairs off
// (typing _ over a selection replaced it instead of wrapping it).

type Pair = { open: string; close: string; notIn?: string[] };
type VsCodePair = string[] | Pair;

export type VsCodeLanguageConfiguration = {
  autoClosingPairs?: VsCodePair[];
  surroundingPairs?: VsCodePair[];
  [key: string]: unknown;
};

const toPair = (p: VsCodePair): Pair => (Array.isArray(p) ? { open: p[0], close: p[1] } : p);

export function fromVsCode<T extends VsCodeLanguageConfiguration>(config: T): Omit<T, 'autoClosingPairs' | 'surroundingPairs'> & { autoClosingPairs?: Pair[]; surroundingPairs?: Pair[] } {
  return {
    ...config,
    autoClosingPairs: config.autoClosingPairs?.map(toPair),
    surroundingPairs: config.surroundingPairs?.map(toPair),
  };
}
