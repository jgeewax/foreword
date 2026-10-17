// How the book looks. You don't need this file to write: chapters use
// headings, paragraphs, footnotes, citations and the helpers at the bottom
// (#epigraph, #pull-quote, #note). Change fonts or spacing here and the whole
// book follows.

#let in-body = state("in-body", false)

#let book(title: "", author: "", body) = {
  set document(title: title, author: author)
  set page(
    width: 6in,
    height: 9in,
    margin: (inside: 0.9in, outside: 0.7in, top: 0.85in, bottom: 0.9in),
    header: context {
      if not in-body.get() { return }
      let here-page = here().page()
      if query(heading.where(level: 1)).any(h => h.location().page() == here-page) { return }
      set text(size: 8pt, tracking: 0.12em)
      // Left pages: the book; right pages: the current chapter.
      let chapters = query(heading.where(level: 1).before(here()))
      if calc.even(here-page) { align(left, upper(title)) } else if chapters.len() > 0 { align(right, upper(chapters.last().body)) }
    },
    footer: context {
      if in-body.get() { align(center, text(size: 9pt, counter(page).display())) }
    },
  )
  set text(font: "Libertinus Serif", size: 11pt, lang: "en")
  set par(justify: true, leading: 0.64em, spacing: 0.64em, first-line-indent: 1.3em)
  set heading(numbering: "1")
  set footnote.entry(separator: line(length: 25%, stroke: 0.5pt))

  // Chapters: "= Title". Unnumbered ones (introduction, afterword) use
  // #heading(numbering: none)[Title].
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    block(width: 100%, above: 0pt, below: 2.4em, inset: (top: 1.2in))[
      #set par(first-line-indent: 0pt)
      #if it.numbering != none [
        #text(size: 9pt, tracking: 0.2em, upper[Chapter #counter(heading).display("1")])
        #v(0.6em)
      ]
      #text(size: 20pt, weight: "regular", it.body)
    ]
  }
  // Sections: "== Title"; subsections: "=== Title".
  show heading.where(level: 2): it => block(above: 1.8em, below: 0.9em, text(size: 11pt, tracking: 0.08em, smallcaps(it.body)))
  show heading.where(level: 3): it => block(above: 1.4em, below: 0.7em, emph(it.body))
  show outline.entry.where(level: 1): set block(above: 0.9em)
  body
}

#let title-page(title: "", subtitle: "", author: "") = page(header: none, footer: none)[
  #v(22%)
  #align(center)[
    #text(size: 26pt, title)
    #if subtitle != "" [
      #v(0.6em)
      #text(size: 13pt, style: "italic", subtitle)
    ]
    #v(2em)
    #text(size: 12pt, tracking: 0.1em, upper(author))
  ]
]

#let copyright-page(title: "", author: "", year: "") = page(header: none, footer: none)[
  #set text(size: 8.5pt)
  #set par(first-line-indent: 0pt, justify: false, spacing: 1em)
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

/// A short quotation under a chapter title.
#let epigraph(attribution: none, body) = align(right, block(width: 70%, above: 0em, below: 2em)[
  #set align(left)
  #set par(first-line-indent: 0pt)
  #emph(body)
  #if attribution != none { align(right)[— #attribution] }
])

/// A sentence worth repeating, set large between paragraphs.
#let pull-quote(body) = block(width: 100%, above: 1.4em, below: 1.4em, inset: (x: 1.5em, y: 0.8em), stroke: (y: 0.5pt + luma(150)))[
  #set par(first-line-indent: 0pt, justify: false)
  #set align(center)
  #text(size: 13pt, style: "italic", body)
]

/// A boxed aside: a practical tip, a case study, a definition.
#let note(title: "Note", body) = block(width: 100%, above: 1.2em, below: 1.2em, inset: 0.9em, radius: 3pt, fill: luma(242))[
  #set par(first-line-indent: 0pt)
  #text(size: 9pt, tracking: 0.12em, upper(title)) \
  #body
]
