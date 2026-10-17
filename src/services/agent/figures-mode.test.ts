import { describe, expect, it } from 'vitest';
import { FIGURES_INSTRUCTIONS, FIGURE_PACKAGES, FIGURE_STYLE_FILE, FIGURE_STYLE_IMPORT, FIGURE_STYLE_NAMES, FIGURE_STYLE_TEMPLATE } from './figures-mode';
import { buildInstructions } from './instructions';

// That the style file compiles is checked by `npm run check-templates`.
describe('the figure style file', () => {
  it('is in the Figures instructions whole, with the import and the rules', () => {
    expect(FIGURES_INSTRUCTIONS).toContain(FIGURE_STYLE_TEMPLATE);
    expect(FIGURES_INSTRUCTIONS).toContain(FIGURE_STYLE_IMPORT);
    expect(FIGURES_INSTRUCTIONS).toMatch(/look at the figures already in the book/);
  });

  it('imports the same, verified package versions as the instructions name', () => {
    const imported = [...FIGURE_STYLE_TEMPLATE.matchAll(/#import "(@preview\/[^"]+)"/g)].map((m) => m[1]);
    expect(imported).toEqual([FIGURE_PACKAGES.cetz, FIGURE_PACKAGES.fletcher, FIGURE_PACKAGES.lilaq]);
  });

  it('defines every name the instructions say it gives', () => {
    for (const n of FIGURE_STYLE_NAMES) {
      expect(FIGURE_STYLE_TEMPLATE, n).toMatch(new RegExp(`#let ${n}\\b|#import "@preview/${n}:|#import "[^"]+" as ${n}\\b|#import "[^"]+" as \\w+: .*\\b${n}\\b`));
      expect(FIGURES_INSTRUCTIONS).toContain(`\`${n}\``);
    }
  });

  it('is mentioned in every session, for figures made in Write mode', () => {
    expect(buildInstructions({ projectName: 'x', entry: 'main.typ', typFiles: [] })).toContain(FIGURE_STYLE_FILE);
  });
});
