// The cover's design: change the words, colours and fonts here. Its size
// comes from spec.typ, which Typst Studio keeps in step with the book.
#import "spec.typ": *
#import "guides.typ": guide-layer

#let title = "{{title}}"
#let author = "{{author}}"
#let blurb = [Two or three sentences that make someone want to read this book. Say what it's about and why it matters, not how it ends.]
#let colours = (background: rgb("#1f3a5f"), ink: rgb("#f6f1e7"), accent: rgb("#e3b04b"))

#let cover(guides: false) = {
  set page(width: cover-width, height: cover-height, margin: 0pt, fill: colours.background, foreground: if guides { guide-layer() })
  set text(font: "Libertinus Serif", fill: colours.ink)
  grid(
    columns: (bleed + trim-width, spine, trim-width + bleed),
    rows: cover-height,
    // Back.
    pad(left: bleed + 0.6in, right: 0.6in, top: bleed + 1in, bottom: bleed + 1.7in)[
      #set par(justify: true, leading: 0.7em)
      #text(size: 12pt, blurb)
    ],
    // Spine: title and author, reading top to bottom (when there's room).
    if spine >= 0.25in {
      align(center + horizon, rotate(90deg, reflow: true, text(size: calc.min(11pt, spine / 1in * 30pt), tracking: 0.08em)[#upper(title) #h(1.2em) #text(fill: colours.accent, author)]))
    },
    // Front.
    pad(left: 0.6in, right: bleed + 0.6in, top: bleed + 1.6in, bottom: bleed + 0.9in)[
      #set align(center)
      #line(length: 1.2in, stroke: 1pt + colours.accent)
      #v(0.4in)
      #text(size: 34pt, title)
      #v(1fr)
      #text(size: 14pt, tracking: 0.12em, upper(author))
    ],
  )
}
