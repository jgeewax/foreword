// The cover's design: change the words, colours and the picture here. Its
// size comes from spec.typ, which Foreword keeps in step with the book.
// The picture should cover the whole front including the bleed.
#import "spec.typ": *
#import "guides.typ": guide-layer

#let title = "{{title}}"
#let author = "{{author}}"
// A placeholder picture that comes with this style: replace front.svg, or name your own file here.
#let picture = "front.svg"
#let colours = (background: rgb("#cfe9fb"), ink: rgb("#1d2a5a"))

#let cover(guides: false) = {
  set page(width: cover-width, height: cover-height, margin: 0pt, fill: colours.background, foreground: if guides { guide-layer() })
  set text(font: ("Avenir Next", "Helvetica Neue", "Libertinus Serif"), fill: colours.ink)
  grid(
    columns: (bleed + trim-width, spine, trim-width + bleed),
    rows: cover-height,
    pad(left: bleed + 0.6in, right: 0.6in, top: bleed + 1in)[
      #set align(center)
      #text(size: 16pt)[A story about patience, hills and the view from the top.]
    ],
    if spine >= 0.25in {
      align(center + horizon, rotate(90deg, reflow: true, text(size: calc.min(10pt, spine / 1in * 28pt), weight: "bold")[#title]))
    },
    // Front: the picture fills the panel (and its bleed); the title sits on top.
    {
      place(top + left, image(picture, width: trim-width + bleed, height: cover-height, fit: "cover"))
      pad(left: 0.5in, right: bleed + 0.5in, top: bleed + 0.6in)[
        #set align(center)
        #text(size: 38pt, weight: "bold", title) \
        #v(0.2in)
        #text(size: 16pt, author)
      ]
    },
  )
}
