import { describe, expect, it } from 'vitest';
import typst from './grammars/typst-language-configuration.json';
import { fromVsCode } from './language-configuration';

describe('fromVsCode', () => {
  it("gives Typst's wrapping pairs as Monaco reads them", () => {
    const pairs = fromVsCode(typst).surroundingPairs!;
    for (const ch of ['_', '*', '$', '(', '[', '{', '"', '`']) expect(pairs.find((p) => p.open === ch)?.close).toBeTruthy();
    expect(pairs.find((p) => p.open === '(')).toEqual({ open: '(', close: ')' });
    expect(pairs.find((p) => p.open === '_')).toEqual({ open: '_', close: '_' });
  });

  it('keeps pairs already written as objects, with their conditions', () => {
    const config = fromVsCode({ autoClosingPairs: [{ open: '$', close: '$', notIn: ['string'] }, ['[', ']']] });
    expect(config.autoClosingPairs).toEqual([
      { open: '$', close: '$', notIn: ['string'] },
      { open: '[', close: ']' },
    ]);
  });

  it('leaves the rest as it is', () => {
    const config = fromVsCode({ brackets: [['(', ')']], autoCloseBefore: ' ' });
    expect(config).toMatchObject({ brackets: [['(', ')']], autoCloseBefore: ' ' });
    expect(config.surroundingPairs).toBeUndefined();
  });
});
