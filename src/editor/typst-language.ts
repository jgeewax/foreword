// Typst highlighting with Tinymist's own TextMate grammar (as in VS Code),
// driven by vscode-textmate + Oniguruma (WASM). Grammar: grammars/, Apache-2.0.
import * as monaco from 'monaco-editor';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url';
import { INITIAL, Registry, parseRawGrammar, type IGrammar, type StateStack } from 'vscode-textmate';
import grammarSource from './grammars/typst.tmLanguage.json?raw';
import languageConfiguration from './grammars/typst-language-configuration.json';
import { fromVsCode } from './language-configuration';

class TokenizerState implements monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return new TokenizerState(this.stack);
  }
  equals(other: monaco.languages.IState) {
    return other instanceof TokenizerState && other.stack.equals(this.stack);
  }
}

/** Most specific scope that the theme styles; Monaco tokens carry a single scope. */
export function pickScope(scopes: readonly string[], themePrefixes: readonly string[]): string {
  for (let i = scopes.length - 1; i > 0; i--) {
    const s = scopes[i];
    if (themePrefixes.some((p) => s === p || s.startsWith(p + '.'))) return s;
  }
  return scopes[scopes.length - 1] ?? '';
}

export async function registerTypst(themePrefixes: readonly string[]) {
  monaco.languages.register({ id: 'typst', extensions: ['.typ'], aliases: ['Typst'] });
  monaco.languages.setLanguageConfiguration('typst', fromVsCode(languageConfiguration) as unknown as monaco.languages.LanguageConfiguration);

  await loadWASM(await (await fetch(onigWasmUrl)).arrayBuffer());
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => (scope === 'source.typst' ? parseRawGrammar(grammarSource, 'typst.tmLanguage.json') : null),
  });
  const grammar: IGrammar | null = await registry.loadGrammar('source.typst');
  if (!grammar) throw new Error('failed to load the Typst grammar');

  monaco.languages.setTokensProvider('typst', {
    getInitialState: () => new TokenizerState(INITIAL),
    tokenize(line, state) {
      // Bound pathological lines so tokenization can never stall typing.
      const result = grammar.tokenizeLine(line, (state as TokenizerState).stack, 20);
      return {
        endState: new TokenizerState(result.ruleStack),
        tokens: result.tokens.map((t) => ({ startIndex: t.startIndex, scopes: pickScope(t.scopes, themePrefixes) })),
      };
    },
  });
}
