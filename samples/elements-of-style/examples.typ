// How the book sets Strunk's examples. Chapters import this file next to
// style.typ and use:
//   #example[...]   sentences shown as examples; each paragraph is one example
//   #compare(...)   a sentence and its revision side by side, in pairs of
//                   cells: the left one as written, the right one as revised
//   #verse[...]     lines of verse, each but the last ending in a backslash
//   #lead-in[...]   a paragraph kept on the same page as the example after it
//   #sn[1]          the small number before a sentence in a quoted paragraph
//   #word-list(...) single words in columns that read downwards

// Examples are indented by this much, set a size smaller than the text and
// spaced this far from the paragraphs around them.
#let example-indent = 1.2em
#let example-size = 0.9em
#let example-space = 0.85em

/// Sentences shown as examples. Each paragraph inside is one example. The
/// block stays on one page unless `breakable: true` (for long lists).
#let example(breakable: false, body) = block(
  above: example-space,
  below: example-space,
  inset: (left: example-indent),
  breakable: breakable,
)[
  #set text(size: example-size)
  #set par(first-line-indent: 0pt, justify: false, spacing: 1em)
  #body
]

/// A sentence and its revision side by side. Give the cells in pairs, the
/// sentence as written first, then as revised; [] leaves a cell empty. The
/// table stays on one page unless `breakable: true`; a pair never splits.
#let compare(breakable: false, ..cells) = block(
  above: example-space,
  below: example-space,
  inset: (left: example-indent),
  breakable: breakable,
)[
  #set text(size: example-size)
  #set par(first-line-indent: 0pt, justify: false)
  #set table.cell(breakable: false)
  #table(
    columns: (1fr, 1fr),
    stroke: (x, _) => if x == 1 { (left: 0.5pt + luma(160)) },
    inset: (x, _) => (
      left: if x == 1 { 0.9em } else { 0pt },
      right: if x == 0 { 0.9em } else { 0pt },
      y: 0.5em,
    ),
    ..cells,
  )
]

/// Lines of verse with an optional source below them, centred as a block
/// (as Strunk asks in Chapter IV) unless `centered: false`.
#let verse(source: none, centered: true, body) = block(
  above: example-space,
  below: example-space,
  width: 100%,
  breakable: false,
  align(
    if centered { center } else { left },
    grid(
      columns: 1,
      row-gutter: 0.5em,
      align: left,
      {
        set text(size: example-size)
        set par(first-line-indent: 0pt, justify: false)
        body
      },
      ..if source != none { (grid.cell(align: right, text(size: example-size, source)),) },
    ),
  ),
)

/// A paragraph that leads into an example and stays on the same page as
/// it. Wrap one only where a page break would fall between the two;
/// `indent: true` keeps the first-line indent of a new paragraph.
#let lead-in(indent: false, body) = context block(sticky: true, above: par.spacing, below: par.spacing, {
  set par(first-line-indent: (amount: par.first-line-indent.amount, all: true)) if indent
  body
})

/// The small number before each sentence of a quoted paragraph (Rule 9).
#let sn(n) = text(size: 0.8em, number-type: "lining", fill: luma(60), n)

/// Single words in columns that read downwards.
#let word-list(columns: 3, ..words) = {
  let words = words.pos()
  let rows = calc.ceil(words.len() / columns)
  let cells = range(rows).map(r => range(columns).map(c => words.at(c * rows + r, default: ""))).flatten()
  block(above: example-space, below: example-space, inset: (left: example-indent), breakable: false, grid(
    columns: (1fr,) * columns,
    row-gutter: 0.55em,
    ..cells.map(w => text(size: example-size, w)),
  ))
}
