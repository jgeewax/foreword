// The paper's two diagrams, drawn with CeTZ: the Transformer (Figure 1) and
// its attention blocks (Figure 2). One palette, one line width, and labels
// in the body font.
#import "@preview/cetz:0.5.2"

#let ink = luma(45)
#let fills = (
  attention: rgb("#dbe7f3"),
  feed-forward: rgb("#e1eedb"),
  norm: white,
  embedding: rgb("#f2e9d9"),
  linear: luma(236),
  output: rgb("#f1e0e7"),
  layer: luma(246),
)

// A labelled box centred at `c`, `w` wide and `h` high.
#let node(c, label, fill: white, w: 3, h: 0.45, dash: none) = {
  import cetz.draw: content, rect
  let (x, y) = c
  rect(
    (x - w / 2, y - h / 2),
    (x + w / 2, y + h / 2),
    fill: fill,
    radius: 0.08,
    stroke: (paint: ink, thickness: 0.6pt, dash: dash),
  )
  content(c, align(center, label))
}

// The same box with two copies behind it, for blocks repeated per head.
#let stacked(c, label, fill: white, w: 3, h: 0.45, step: 0.08) = {
  import cetz.draw: rect
  let (x, y) = c
  for k in (2, 1) {
    let (dx, dy) = (k * step, k * step)
    rect(
      (x - w / 2 + dx, y - h / 2 + dy),
      (x + w / 2 + dx, y + h / 2 + dy),
      fill: fill,
      radius: 0.08,
      stroke: 0.6pt + ink,
    )
  }
  node(c, label, fill: fill, w: w, h: h)
}

#let arrow(..pts) = cetz.draw.line(..pts, mark: (end: "stealth"))

// Where the positional encoding is added to the embedding.
#let plus(c) = {
  import cetz.draw: circle, line
  let (x, y) = c
  circle(c, radius: 0.22, fill: white)
  line((x - 0.13, y), (x + 0.13, y))
  line((x, y - 0.13), (x, y + 0.13))
}

// The positional encoding: one period of a sine wave in a circle.
#let wave(c) = {
  import cetz.draw: circle, line
  let (x, y) = c
  circle(c, radius: 0.3, fill: white)
  let points = range(0, 25).map(t => (x - 0.2 + 0.4 * t / 24, y + 0.12 * calc.sin(2 * calc.pi * t / 24)))
  line(..points)
}

// Figure 1: the encoder (left) and decoder (right) stacks.
#let transformer-diagram = {
  set text(size: 8pt)
  cetz.canvas(length: 0.86cm, {
    import cetz.draw: *
    set-style(stroke: 0.6pt + ink, mark: (fill: ink, scale: 0.6))

    let two = 0.8 // height of a two-line block
    let enc = 0 // centre line of the encoder
    let dec = 5.4 // centre line of the decoder
    let side = 1.72 // offset of the residual connections

    // A sub-layer's residual connection, from the fork at `y0` into the
    // Add & norm block at `y1`, on the left (-1) or the right (1).
    let residual(x, y0, y1, dir) = {
      line((x, y0), (x + dir * side, y0), (x + dir * side, y1))
      arrow((x + dir * side, y1), (x + dir * 1.5, y1))
    }

    // Queries, keys and values, all from the stream below.
    let comb(x) = {
      line((x - 0.9, 2.75), (x + 0.9, 2.75))
      for dx in (-0.9, 0, 0.9) {
        arrow((x + dx, 2.75), (x + dx, 3.05))
      }
    }

    // Inputs, embeddings and positional encodings.
    for (x, label, dir) in ((enc, [Inputs], -1), (dec, [Outputs (shifted right)], 1)) {
      content((x, -0.15), label)
      arrow((x, 0.1), (x, 0.625))
      node((x, 0.85), if dir < 0 [Input embedding] else [Output embedding], fill: fills.embedding)
      arrow((x, 1.075), (x, 1.48))
      plus((x, 1.7))
      wave((x + dir * 1.3, 1.7))
      arrow((x + dir * 1.0, 1.7), (x + dir * 0.22, 1.7))
      content(
        (x + dir * 1.72, 1.7),
        anchor: if dir < 0 { "east" } else { "west" },
        align(if dir < 0 { right } else { left })[Positional \ encoding],
      )
    }

    // Encoder layer.
    rect((enc - 1.95, 2.2), (enc + 1.95, 6.3), fill: fills.layer, radius: 0.15)
    content((enc - 1.95, 6.3), anchor: "south-west", padding: 0.06, strong[Encoder])
    content((enc - 2.1, 4.25), anchor: "east", [$N$×])
    line((enc, 1.92), (enc, 2.75))
    residual(enc, 2.45, 4.3, -1)
    comb(enc)
    node((enc, 3.45), [Multi-head \ attention], fill: fills.attention, h: two)
    arrow((enc, 3.85), (enc, 4.075))
    node((enc, 4.3), [Add & norm])
    arrow((enc, 4.525), (enc, 4.975))
    residual(enc, 4.75, 5.85, -1)
    node((enc, 5.2), [Feed forward], fill: fills.feed-forward)
    arrow((enc, 5.425), (enc, 5.625))
    node((enc, 5.85), [Add & norm])

    // Decoder layer.
    rect((dec - 1.95, 2.2), (dec + 1.95, 8.7), fill: fills.layer, radius: 0.15)
    content((dec + 1.95, 8.7), anchor: "south-east", padding: 0.06, strong[Decoder])
    content((dec + 2.1, 5.45), anchor: "west", [$N$×])
    line((dec, 1.92), (dec, 2.75))
    residual(dec, 2.45, 4.3, 1)
    comb(dec)
    node((dec, 3.45), [Masked multi-head \ attention], fill: fills.attention, h: two)
    arrow((dec, 3.85), (dec, 4.075))
    node((dec, 4.3), [Add & norm])
    // The queries come from the decoder ...
    line((dec, 4.525), (dec, 4.75), (dec + 0.9, 4.75))
    arrow((dec + 0.9, 4.75), (dec + 0.9, 5.45))
    residual(dec, 4.75, 6.7, 1)
    // ... and the keys and values from the encoder's output.
    line((enc, 6.075), (enc, 6.75), (2.95, 6.75), (2.95, 5.05), (dec - 0.3, 5.05))
    arrow((dec - 0.9, 5.05), (dec - 0.9, 5.45))
    arrow((dec - 0.3, 5.05), (dec - 0.3, 5.45))
    content((dec - 0.84, 5.26), anchor: "west", text(size: 6.5pt, $K$))
    content((dec - 0.24, 5.26), anchor: "west", text(size: 6.5pt, $V$))
    content((dec + 0.96, 5.26), anchor: "west", text(size: 6.5pt, $Q$))
    node((dec, 5.85), [Multi-head \ attention], fill: fills.attention, h: two)
    arrow((dec, 6.25), (dec, 6.475))
    node((dec, 6.7), [Add & norm])
    arrow((dec, 6.925), (dec, 7.375))
    residual(dec, 7.15, 8.25, 1)
    node((dec, 7.6), [Feed forward], fill: fills.feed-forward)
    arrow((dec, 7.825), (dec, 8.025))
    node((dec, 8.25), [Add & norm])

    // Output head.
    arrow((dec, 8.475), (dec, 9.1))
    node((dec, 9.325), [Linear], fill: fills.linear, w: 2.2)
    arrow((dec, 9.55), (dec, 9.85))
    node((dec, 10.075), [Softmax], fill: fills.output, w: 2.2)
    arrow((dec, 10.3), (dec, 10.7))
    content((dec, 10.9), [Output probabilities])
  })
}

// Figure 2 (a): scaled dot-product attention.
#let scaled-dot-product-diagram = {
  set text(size: 8pt)
  cetz.canvas(length: 0.86cm, {
    import cetz.draw: *
    set-style(stroke: 0.6pt + ink, mark: (fill: ink, scale: 0.6))

    let x = -0.45
    let w = 2.8
    for (px, label) in ((-0.9, $Q$), (0, $K$), (1.55, $V$)) {
      content((px, -0.15), label)
    }
    arrow((-0.9, 0.1), (-0.9, 0.6))
    arrow((0, 0.1), (0, 0.6))
    arrow((1.55, 0.1), (1.55, 3.725))
    node((x, 0.825), [$Q K^top$], w: w)
    arrow((x, 1.05), (x, 1.35))
    node((x, 1.575), [Scale by $1 \/ sqrt(d_k)$], w: w)
    arrow((x, 1.8), (x, 2.1))
    node((x, 2.325), [Mask (decoder)], w: w, dash: "dashed")
    arrow((x, 2.55), (x, 2.85))
    node((x, 3.075), [Softmax], w: w, fill: fills.attention)
    arrow((x, 3.3), (x, 3.725))
    node((0.55, 3.95), [Multiply by $V$], w: 2.6)
    arrow((0.55, 4.175), (0.55, 4.6))
  })
}

// Figure 2 (b): multi-head attention.
#let multi-head-diagram = {
  set text(size: 8pt)
  cetz.canvas(length: 0.86cm, {
    import cetz.draw: *
    set-style(stroke: 0.6pt + ink, mark: (fill: ink, scale: 0.6))

    for (px, label) in ((-1.35, $Q$), (0, $K$), (1.35, $V$)) {
      content((px, -0.15), label)
      arrow((px, 0.1), (px, 0.6))
      stacked((px, 0.825), [Linear], fill: fills.linear, w: 1.1)
      arrow((px, 1.21), (px, 1.6))
    }
    stacked((0, 2.0), [Scaled dot-product \ attention], fill: fills.attention, w: 3.4, h: 0.8)
    content((2.0, 2.08), anchor: "west", [$h$ heads])
    arrow((0, 2.56), (0, 2.9))
    node((0, 3.125), [Concat], w: 1.8)
    arrow((0, 3.35), (0, 3.65))
    node((0, 3.875), [Linear], fill: fills.linear, w: 1.8)
    arrow((0, 4.1), (0, 4.6))
  })
}

// Both halves of Figure 2, side by side.
#let attention-diagrams = grid(
  columns: 2,
  column-gutter: 2.5em,
  row-gutter: 0.8em,
  align: center + bottom,
  scaled-dot-product-diagram, multi-head-diagram,
  [(a) Scaled dot-product attention], [(b) Multi-head attention],
)
