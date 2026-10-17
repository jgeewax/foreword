// The look of every figure in this book: colours, lines and labels.
// Figures import what they need from here, so changing a value below changes
// every figure at once.
#import "@preview/cetz:0.5.2"
#import "@preview/fletcher:0.5.8" as fletcher: node, edge
#import "@preview/lilaq:0.6.0" as lq

// Colours: ink for lines and labels, accent for what the figure is about,
// muted for axes, guides and context, soft to fill shapes.
#let palette = (
  ink: luma(15%),
  accent: rgb("#2f6fde"),
  muted: luma(55%),
  soft: rgb("#2f6fde").lighten(85%),
)

// Lines and labels. Labels use the book's own font, a little smaller.
#let line-width = 0.8pt
#let label-size = 0.85em

// A CeTZ drawing in the book's style:
//   #figure-canvas({
//     import cetz.draw: *
//     circle((0, 0), radius: 1)
//   })
#let figure-canvas(body, ..args) = {
  set text(size: label-size, fill: palette.ink)
  cetz.canvas(..args, {
    cetz.draw.set-style(
      stroke: line-width + palette.ink,
      mark: (fill: palette.ink, scale: 0.8),
      content: (padding: 0.25em),
    )
    body
  })
}

// A fletcher diagram (boxes and arrows) in the book's style:
//   #figure-diagram(node((0, 0), [Draft]), edge("-|>"), node((1, 0), [Revise]))
#let figure-diagram(..args) = {
  set text(size: label-size, fill: palette.ink)
  fletcher.diagram(
    node-stroke: line-width + palette.ink,
    node-fill: palette.soft,
    node-corner-radius: 3pt,
    edge-stroke: line-width + palette.ink,
    spacing: (2.5em, 2em),
    ..args,
  )
}

// A Lilaq chart in the book's style; series take the palette's colours in turn:
//   #figure-chart(xlabel: [Year], ylabel: [Readers], lq.plot(years, readers))
#let figure-chart(..args) = {
  set text(size: label-size, fill: palette.ink)
  lq.diagram(cycle: (palette.accent, palette.ink, palette.muted), ..args)
}
