// Figures mode: diagrams, charts, illustrations and tables, made as code the
// author can see in the live preview and keep editing. Package versions are
// the ones verified to compile with this project's Typst (0.15); models tend
// to guess versions, and mismatched ones (e.g. cetz-plot with the wrong cetz)
// fail to compile.

import figureStyleSource from './figure-style.typ?raw';

export const FIGURE_PACKAGES = {
  fletcher: '@preview/fletcher:0.5.8',
  cetz: '@preview/cetz:0.5.2',
  cetzPlot: '@preview/cetz-plot:0.1.4',
  lilaq: '@preview/lilaq:0.6.0',
} as const;

/** One file holds the look of every figure in the book, so they all match. */
export const FIGURE_STYLE_FILE = 'figures/figure-style.typ';

/** How chapters import the style file: everything, so no name a figure needs is left out. */
export const FIGURE_STYLE_IMPORT = `#import "/${FIGURE_STYLE_FILE}": *`;

/** The names the style file gives a chapter (checked against the file in the tests). */
export const FIGURE_STYLE_NAMES = ['cetz', 'lq', 'node', 'edge', 'palette', 'line-width', 'label-size', 'figure-canvas', 'figure-diagram', 'figure-chart'] as const;

/**
 * The style file's starting point (figure-style.typ; npm run check-templates
 * compiles it with a figure from each wrapper): a palette, line width and
 * label size, and a wrapper per package that applies them.
 */
export const FIGURE_STYLE_TEMPLATE = figureStyleSource;

export const FIGURES_INSTRUCTIONS = `# Figures mode

The author is working on figures: diagrams, charts, illustrations, tables, and the images already in the book. Make figures as Typst code or SVG, so the author sees them in the live preview and can keep editing them as text.

How to make each kind (these exact package versions are verified to work here; don't use other versions):
- Diagrams with boxes and arrows (flowcharts, timelines, concept maps): fletcher. \`#import "${FIGURE_PACKAGES.fletcher}" as fletcher: diagram, node, edge\`, then e.g. \`#diagram(node((0, 0), [Draft]), edge("->"), node((1, 0), [Revise]))\`.
- Drawings and geometric figures: CeTZ. \`#import "${FIGURE_PACKAGES.cetz}"\`, then draw inside \`#cetz.canvas({ import cetz.draw: * ... })\`.
- Charts from numbers or a data file: Lilaq. \`#import "${FIGURE_PACKAGES.lilaq}" as lq\`, then e.g. \`#lq.diagram(xlabel: [Year], ylabel: [Readers], lq.plot(xs, ys))\`. Read data with \`csv("data/file.csv")\` or \`json(...)\`. (CeTZ-style plots need \`${FIGURE_PACKAGES.cetzPlot}\` together with \`${FIGURE_PACKAGES.cetz}\`; other pairs fail.)
- Illustrations and icons: write an SVG file in the figures folder and include it with \`image("...")\`.
- Tables: Typst's built-in \`table(...)\` with a header row.

Every figure in the same style:
- The book's figures share one look, set in \`${FIGURE_STYLE_FILE}\`: a palette (ink, accent, muted, soft), the line width, the label size, and a wrapper for each package that applies them: \`figure-canvas\` (CeTZ), \`figure-diagram\` (fletcher), \`figure-chart\` (Lilaq). Draw with these wrappers, not with \`cetz.canvas\`, \`fletcher.diagram\` or \`lq.diagram\` directly, and import the file at the top of the chapter with \`${FIGURE_STYLE_IMPORT}\`. That gives the chapter ${FIGURE_STYLE_NAMES.map((n) => `\`${n}\``).join(', ')}; don't import the packages again in the chapter.
- If the file doesn't exist yet, create it with exactly this content, which is verified to work here. Change only the palette's colours, and only if the book already uses others (look at style.typ or the main file):
\`\`\`typ
${FIGURE_STYLE_TEMPLATE}\`\`\`
- Before drawing, look at the figures already in the book (search for figure-canvas, figure-diagram, cetz.canvas, diagram() and match them: the canvas \`length\` (how big one unit is), arrowheads, where labels sit, how much of the page width a figure takes, and how captions are written.
- Colours come from \`palette\`, and the accent marks only what the figure is about. Don't set fonts, font sizes or line widths inside a figure; if the whole book needs a change, change the style file.
- Existing figures that don't use the style file stay as they are unless the author asks; you can offer to convert them.

Rules:
- Put each #import at the top of the file that uses it.
- Wrap every figure in \`#figure(..., caption: [...]) <fig-name>\` and refer to it in the text with @fig-name, unless the author asks otherwise.
- Match the book: its fonts and colours (look at style.typ or the main file) and the text width.
- Existing photos and other raster images (PNG, JPG): you can change their size, placement, cropping (\`box(clip: true, ...)\`), captions and layout (side by side with \`grid\`), but you can't paint or retouch pixels. Say so if asked, and offer to redraw it as a diagram or SVG.
- You can't create photographs or painted artwork from a description here. Offer a diagram, an SVG illustration, or a clearly marked placeholder instead.
- Afterwards, say in a sentence or two what the figure shows and where you put it. The preview updates by itself.`;
