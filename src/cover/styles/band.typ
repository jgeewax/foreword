// The cover's design: change the words, colours and fonts here. Its size
// comes from spec.typ, which Typst Studio keeps in step with the book.
#import "spec.typ": *
#import "guides.typ": guide-layer

#let title = "{{title}}"
#let subtitle = "An introduction"
#let author = "{{author}}"
#let blurb = [What the reader will learn, who the book is for, and what they need to know already.]
#let colours = (background: white, band: rgb("#1f5fa8"), ink: rgb("#1a1a1a"), on-band: white)

#let cover(guides: false) = {
  set page(width: cover-width, height: cover-height, margin: 0pt, fill: colours.background, foreground: if guides { guide-layer() })
  set text(font: "New Computer Modern", fill: colours.ink)
  // A colour band across the whole wrap, a third of the way down.
  place(top + left, dy: bleed + trim-height * 0.38, rect(width: cover-width, height: trim-height * 0.24, fill: colours.band))
  grid(
    columns: (bleed + trim-width, spine, trim-width + bleed),
    rows: cover-height,
    pad(left: bleed + 0.6in, right: 0.6in, top: bleed + 0.9in)[
      #set par(justify: true)
      #text(size: 11pt, blurb)
    ],
    // The spine is all band colour, so its white text reads top to bottom.
    block(width: 100%, height: 100%, fill: colours.band, if spine >= 0.25in {
      align(center + horizon, rotate(90deg, reflow: true, text(size: calc.min(10pt, spine / 1in * 28pt), weight: "bold", fill: colours.on-band)[#title #h(1em) #text(weight: "regular", author)]))
    }),
    pad(left: 0.6in, right: bleed + 0.6in, top: bleed + trim-height * 0.38, bottom: bleed + 0.8in)[
      #block(height: trim-height * 0.24, align(left + horizon)[
        #text(size: 30pt, weight: "bold", fill: colours.on-band, title) \
        #text(size: 14pt, fill: colours.on-band, subtitle)
      ])
      #v(1fr)
      #text(size: 14pt, author)
    ],
  )
}
