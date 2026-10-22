import { describe, expect, it } from 'vitest';
import { mathSource, passageSource, renderReason, svgHeightPt } from './typst-render';

describe('rendering Typst snippets', () => {
  it('turns Markdown math spans into Typst', () => {
    expect(mathSource('$x^2$')).toBe('$x^2$');
    expect(mathSource('$ sum_i a_i $')).toBe('$ sum_i a_i $');
    expect(mathSource('$$ a + b $$')).toBe('$ a + b $');
  });

  it('reads an SVG’s height in points', () => {
    expect(svgHeightPt('<svg viewBox="0 0 107.52 17.952" width="107.52pt" height="17.952pt" xmlns="x">')).toBe(17.952);
    expect(svgHeightPt('<svg>')).toBeNull();
  });
});

describe('a passage set on its own', () => {
  it('is set at a width, with references to the book in grey', () => {
    expect(passageSource('See @ch-vectors.', 240)).toBe('#set page(width: 240pt)\n#show ref: it => text(fill: luma(150), str(it.target))\nSee @ch-vectors.');
  });

  it('says why it couldn’t be set in a few words', () => {
    expect(renderReason('error: unknown variable: sidenote\n  ┌─ snippet.typ:3:2\n  │')).toBe('unknown variable: sidenote');
    expect(renderReason('took too long to render')).toBe('took too long to render');
    expect(renderReason(null)).toBe('it couldn’t be set');
  });
});
