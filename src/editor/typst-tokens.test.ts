// @ts-expect-error type error without @types/node package
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import { INITIAL, Registry, parseRawGrammar, type IGrammar } from 'vscode-textmate';
import grammarSource from './grammars/typst.tmLanguage.json?raw';
import { grammarWithEmphasis, pickScope, themeWithEmphasis, tokenFor } from './typst-tokens';

const PREFIXES = ['markup.heading', 'string', 'string.other.label', 'punctuation'];

describe('tokenFor', () => {
  it("is pickScope's outside *strong* and _emph_", () => {
    const scopes = ['source.typst', 'markup.heading.typst', 'punctuation.definition.heading.typst'];
    expect(tokenFor(scopes, PREFIXES)).toBe(pickScope(scopes, PREFIXES));
    expect(tokenFor(scopes, PREFIXES)).toBe('punctuation.definition.heading.typst');
  });

  it('puts them on the end of the rule styling the token', () => {
    expect(tokenFor(['source.typst', 'markup.italic.typst'], PREFIXES)).toBe('emph');
    expect(tokenFor(['source.typst', 'markup.bold.typst', 'markup.italic.typst'], PREFIXES)).toBe('strong.emph');
    expect(tokenFor(['source.typst', 'markup.italic.typst', 'punctuation.definition.italic.typst'], PREFIXES)).toBe('punctuation.emph');
    expect(tokenFor(['source.typst', 'markup.heading.typst', 'markup.bold.typst'], PREFIXES)).toBe('markup.heading.strong');
    // The longest rule, as Monaco matches it.
    expect(tokenFor(['source.typst', 'markup.bold.typst', 'string.other.label.typst'], PREFIXES)).toBe('string.other.label.strong');
  });
});

describe('themeWithEmphasis', () => {
  it('styles each rule again inside them, keeping its colour and style', () => {
    const rules = themeWithEmphasis([{ token: 'markup.heading', foreground: '0550ae', fontStyle: 'bold' }]);
    expect(rules).toContainEqual({ token: 'strong', fontStyle: 'bold' });
    expect(rules).toContainEqual({ token: 'emph', fontStyle: 'italic' });
    expect(rules).toContainEqual({ token: 'strong.emph', fontStyle: 'bold italic' });
    expect(rules).toContainEqual({ token: 'markup.heading.strong', foreground: '0550ae', fontStyle: 'bold' });
    expect(rules).toContainEqual({ token: 'markup.heading.emph', foreground: '0550ae', fontStyle: 'bold italic' });
  });
});

describe('grammarWithEmphasis', () => {
  let grammar: IGrammar;
  beforeAll(async () => {
    await loadWASM(readFileSync(new URL('../../node_modules/vscode-oniguruma/release/onig.wasm', import.meta.url)).buffer);
    const registry = new Registry({
      onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
      loadGrammar: async () => parseRawGrammar(grammarWithEmphasis(grammarSource), 'typst.tmLanguage.json'),
    });
    grammar = (await registry.loadGrammar('source.typst'))!;
  });

  /** Each line, then a character per character of it: . plain, i emph, b strong, B both. */
  function styles(text: string): string[] {
    let stack = INITIAL;
    return text.split('\n').flatMap((line) => {
      const { tokens, ruleStack } = grammar.tokenizeLine(line, stack);
      stack = ruleStack;
      const style = tokens
        .map((t) => {
          const strong = t.scopes.some((s) => s.startsWith('markup.bold.'));
          const emph = t.scopes.some((s) => s.startsWith('markup.italic.'));
          return (strong && emph ? 'B' : strong ? 'b' : emph ? 'i' : '.').repeat(Math.min(t.endIndex, line.length) - t.startIndex);
        })
        .join('');
      return [line, style];
    });
  }

  // Each pair: a line, then what Tinymist's semantic tokens make of it (what VS Code shows).
  const expectSame = (...pairs: string[]) => {
    const text = pairs.filter((_, i) => i % 2 === 0).join('\n');
    expect(styles(text)).toEqual(pairs);
  };

  it('styles them, markers too, and not underscores and stars inside words', () => {
    expectSame(
      'Some _asdf_ and *asdf* here.',
      '.....iiiiii.....bbbbbb......',
      '_asdf_ at start, snake_case, 2*3',
      'iiiiii..........................',
      'both *_at once_* x',
      '.....bBBBBBBBBBb..',
    );
  });

  it('carries them over a line end, and ends them at a blank line', () => {
    expectSame(
      'a _two',
      '..iiii',
      'line_ emph',
      'iiiii.....',
      '*unclosed bold',
      'bbbbbbbbbbbbbb',
      'next line',
      'bbbbbbbbb',
      '',
      '',
      'after',
      '.....',
    );
  });

  it('in headings, lists and term lists', () => {
    expectSame(
      '= Head _in_ it',
      '.......iiii...',
      '- item _a',
      '.......ii',
      '  continued_ more',
      'iiiiiiiiiiii.....',
      '/ Term: _def_',
      '........iiiii',
      '+ num *x*',
      '......bbb',
    );
  });

  it('pairs brackets inside them, and ends them at a content block’s end', () => {
    expectSame(
      '_see [1] here_ ok',
      'iiiiiiiiiiiiii...',
      '',
      '',
      '#text[a _b] c_ d',
      '........ii...iii',
      '',
      '',
      '_a [b] c_ d *x <lab> y* @ref_x z',
      'iiiiiiiii...bbbbbbbbbbb.........',
    );
  });

  it('around code, math and raw, but not in them, links or escapes', () => {
    expectSame(
      'x _a #f(1) b_ c',
      '..iiiiiiiiiii..',
      '_a $x_1$ b_ `c_d` e',
      'iiiiiiiiiii........',
      'see https://a.com/x_y_z here',
      '............................',
      '\\_not\\_ and that',
      '................',
    );
  });
});
