// How the book looks. You don't need this file to write: chapters only use
// headings, paragraphs, _italics_ and #scene-break(). Change the page size,
// fonts or spacing here and the whole book follows.

// Running headers and page numbers start at the first chapter.
#let in-story = state("in-story", false)

#let book(title: "", author: "", width: 6in, height: 9in, body) = {
  set document(title: title, author: author)
  set page(
    // Wider margin on the binding side.
    width: width,
    height: height,
    margin: (inside: 0.9in, outside: 0.7in, top: 0.85in, bottom: 0.9in),
    header: context {
      if not in-story.get() { return }
      let here-page = here().page()
      // No header on a chapter's opening page.
      if query(heading.where(level: 1)).any(h => h.location().page() == here-page) { return }
      set text(size: 8pt, tracking: 0.12em)
      if calc.even(here-page) { align(left, upper(author)) } else { align(right, upper(title)) }
    },
    footer: context {
      if in-story.get() { align(center, text(size: 9pt, counter(page).display())) }
    },
  )
  set text(font: "Libertinus Serif", size: 11pt, lang: "en", hyphenate: true)
  set par(justify: true, leading: 0.62em, spacing: 0.62em, first-line-indent: 1.4em)

  // "= Title" starts a chapter on a new page.
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    block(width: 100%, above: 0pt, below: 2.8em, inset: (top: 1.4in))[
      #set align(center)
      #set par(first-line-indent: 0pt)
      #text(size: 9pt, tracking: 0.2em, upper[Chapter #counter(heading).display("1")])
      #v(0.8em)
      #text(size: 19pt, weight: "regular", it.body)
    ]
  }
  set heading(numbering: "1")
  body
}

#let title-page(title: "", author: "") = page(header: none, footer: none)[
  #v(24%)
  #align(center)[
    #text(size: 26pt, title)
    #v(1.4em)
    #text(size: 13pt, tracking: 0.1em, upper(author))
  ]
]

#let copyright-page(title: "", author: "", year: "") = page(header: none, footer: none)[
  #set text(size: 8.5pt)
  #set par(first-line-indent: 0pt, justify: false, spacing: 1em)
  #v(1fr)
  #emph(title) \
  Copyright © #year #author. All rights reserved.

  This is a work of fiction. Names, characters, places and events are the
  product of the author's imagination.
]

#let dedication(body) = page(header: none, footer: none)[
  #v(30%)
  #align(center, emph(body))
]

/// Call once, right before the first chapter.
#let start-story() = {
  pagebreak(weak: true)
  counter(page).update(1)
  in-story.update(true)
}

/// A change of scene inside a chapter.
#let scene-break() = block(width: 100%, above: 1.4em, below: 1.4em, align(center)[\*#h(1.2em)\*#h(1.2em)\*])
