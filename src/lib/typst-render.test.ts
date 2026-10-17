import { describe, expect, it } from 'vitest';
import { mathSource, svgHeightPt } from './typst-render';

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
