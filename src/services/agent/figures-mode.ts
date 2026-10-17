// Figures mode: diagrams, charts, illustrations and tables, made as code the
// author can see in the live preview and keep editing. Package versions are
// the ones verified to compile with this project's Typst (0.15); models tend
// to guess versions, and mismatched ones (e.g. cetz-plot with the wrong cetz)
// fail to compile.

export const FIGURE_PACKAGES = {
  fletcher: '@preview/fletcher:0.5.8',
  cetz: '@preview/cetz:0.5.2',
  cetzPlot: '@preview/cetz-plot:0.1.4',
  lilaq: '@preview/lilaq:0.6.0',
} as const;

export const FIGURES_INSTRUCTIONS = `# Figures mode

The author is working on figures: diagrams, charts, illustrations, tables, and the images already in the book. Make figures as Typst code or SVG, so the author sees them in the live preview and can keep editing them as text.

How to make each kind (these exact package versions are verified to work here; don't use other versions):
- Diagrams with boxes and arrows (flowcharts, timelines, concept maps): fletcher. \`#import "${FIGURE_PACKAGES.fletcher}" as fletcher: diagram, node, edge\`, then e.g. \`#diagram(node((0, 0), [Draft]), edge("->"), node((1, 0), [Revise]))\`.
- Drawings and geometric figures: CeTZ. \`#import "${FIGURE_PACKAGES.cetz}"\`, then draw inside \`#cetz.canvas({ import cetz.draw: * ... })\`.
- Charts from numbers or a data file: Lilaq. \`#import "${FIGURE_PACKAGES.lilaq}" as lq\`, then e.g. \`#lq.diagram(xlabel: [Year], ylabel: [Readers], lq.plot(xs, ys))\`. Read data with \`csv("data/file.csv")\` or \`json(...)\`. (CeTZ-style plots need \`${FIGURE_PACKAGES.cetzPlot}\` together with \`${FIGURE_PACKAGES.cetz}\`; other pairs fail.)
- Illustrations and icons: write an SVG file in the figures folder and include it with \`image("...")\`.
- Tables: Typst's built-in \`table(...)\` with a header row.

Rules:
- Put each #import at the top of the file that uses it.
- Wrap every figure in \`#figure(..., caption: [...]) <fig-name>\` and refer to it in the text with @fig-name, unless the author asks otherwise.
- Match the book: its fonts and colours (look at style.typ or the main file) and the text width.
- Existing photos and other raster images (PNG, JPG): you can change their size, placement, cropping (\`box(clip: true, ...)\`), captions and layout (side by side with \`grid\`), but you can't paint or retouch pixels. Say so if asked, and offer to redraw it as a diagram or SVG.
- You can't create photographs or painted artwork from a description here. Offer a diagram, an SVG illustration, or a clearly marked placeholder instead.
- Afterwards, say in a sentence or two what the figure shows and where you put it. The preview updates by itself.`;
