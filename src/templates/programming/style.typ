// How the book looks. You don't need this file to write: chapters use
// headings, paragraphs, code examples (#run, from code.typ), figures and the
// boxes at the bottom (#definition, #example, #key-idea, #exercises). Change fonts, colours or
// spacing here and the whole book follows.

#let accent = rgb("#1f5fa8")
#let in-body = state("in-body", false)

#let book(title: "", author: "", width: 7.5in, height: 9.25in, body) = {
  set document(title: title, author: author)
  set page(
    width: width,
    height: height,
    margin: (inside: 1in, outside: 0.8in, top: 0.9in, bottom: 0.9in),
    header: context {
      if not in-body.get() { return }
      let here-page = here().page()
      if query(heading.where(level: 1)).any(h => h.location().page() == here-page) { return }
      let chapters = query(heading.where(level: 1).before(here()))
      set text(size: 8.5pt, fill: luma(90))
      if chapters.len() > 0 {
        let c = chapters.last()
        let label = if c.numbering != none [#counter(heading).at(c.location()).first() #h(0.6em) #c.body] else [#c.body]
        if calc.even(here-page) [#counter(page).display() #h(1fr) #label] else [#label #h(1fr) #counter(page).display()]
      }
      v(-0.4em)
      line(length: 100%, stroke: 0.4pt + luma(170))
    },
    footer: context {
      // Chapter openings have no header, so their number goes at the bottom.
      if not in-body.get() { return }
      let here-page = here().page()
      if query(heading.where(level: 1)).any(h => h.location().page() == here-page) {
        align(center, text(size: 8.5pt, counter(page).display()))
      }
    },
  )
  set text(font: "New Computer Modern", size: 10.5pt, lang: "en")
  // Code: a monospace face bundled with Typst, on a light panel.
  show raw: set text(font: "DejaVu Sans Mono", size: 0.86em)
  show raw.where(block: true): block.with(width: 100%, fill: luma(248), inset: (x: 8pt, y: 7pt), radius: 2pt, stroke: 0.5pt + luma(225))
  show raw.where(block: false): box.with(fill: luma(244), inset: (x: 2pt), outset: (y: 2pt), radius: 1.5pt)
  set par(justify: true, leading: 0.6em, spacing: 1em)
  set heading(numbering: "1.1")
  set list(indent: 0.8em)
  set enum(indent: 0.8em)

  // Equations and figures are numbered per chapter: (2.3), Figure 2.1.
  let chapter-number() = counter(heading).get().first()
  set math.equation(numbering: n => numbering("(1.1)", chapter-number(), n))
  set figure(numbering: n => numbering("1.1", chapter-number(), n))
  show figure.caption: set text(size: 9.5pt)
  show figure.caption: it => [*#it.supplement #context it.counter.display(it.numbering).* #it.body]

  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    counter(math.equation).update(0)
    counter(figure.where(kind: image)).update(0)
    counter(figure.where(kind: table)).update(0)
    block(width: 100%, above: 0pt, below: 2.2em, inset: (top: 0.8in))[
      #if it.numbering != none [
        #text(size: 48pt, fill: accent, weight: "bold", counter(heading).display("1"))
        #v(-0.2em)
      ]
      #text(size: 22pt, weight: "bold", it.body)
      #v(0.3em)
      #line(length: 100%, stroke: 1pt + accent)
    ]
  }
  show heading.where(level: 2): set text(size: 13pt, fill: accent)
  show heading.where(level: 2): set block(above: 1.8em, below: 0.9em)
  show heading.where(level: 3): set text(size: 11pt)
  show outline.entry.where(level: 1): it => block(above: 1.1em, strong(it))
  body
}

#let title-page(title: "", subtitle: "", author: "", edition: "") = page(header: none, footer: none)[
  #v(18%)
  #line(length: 100%, stroke: 2pt + accent)
  #v(1em)
  #text(size: 30pt, weight: "bold", title)
  #if subtitle != "" [
    #v(0.2em)
    #text(size: 15pt, fill: luma(70), subtitle)
  ]
  #v(1fr)
  #text(size: 14pt, author)
  #if edition != "" [ \ #text(size: 10pt, fill: luma(90), edition)]
]

#let copyright-page(title: "", author: "", year: "") = page(header: none, footer: none)[
  #set text(size: 8.5pt)
  #v(1fr)
  #emph(title) \
  Copyright © #year #author. All rights reserved.
]

/// Call once, after the contents, before the first chapter.
#let start-body() = {
  pagebreak(weak: true)
  counter(page).update(1)
  in-body.update(true)
}

#let _box(kind, colour, title, body) = block(
  width: 100%,
  above: 1.2em,
  below: 1.2em,
  inset: (x: 0.9em, y: 0.8em),
  radius: 2pt,
  fill: colour.lighten(92%),
  stroke: (left: 2.5pt + colour),
)[
  #text(fill: colour, weight: "bold")[#kind#if title != none [ (#title)]] #h(0.4em) #body
]

/// A term the reader must learn. #definition("Vector")[A vector is ...]
#let definition(title, body) = _box("Definition", accent, title, body)
/// A worked example.
#let example(title: none, body) = _box("Example", rgb("#2e7d4f"), title, body)
/// The one thing to remember from a section.
#let key-idea(body) = _box("Key idea", rgb("#b35c00"), none, body)

/// Practice problems at the end of a chapter: a numbered list.
#let exercises(body) = {
  heading(level: 2, numbering: none)[Exercises]
  set enum(numbering: n => text(fill: accent, weight: "bold", numbering("1.", n)))
  body
}
