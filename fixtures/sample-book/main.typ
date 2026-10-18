#let title = "Linear Algebra Notes"
#let subtitle = "A first course, with worked examples"
#let author = "Elena Marsh"

#set document(title: title, author: author)
#set page(paper: "a5", margin: (x: 1.8cm, y: 2cm), numbering: "1")
#set text(size: 11pt)
#set par(justify: true)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  it
}

// The title page and the copyright page have no page numbers.
#page(numbering: none, align(center + horizon)[
  #text(size: 24pt, weight: "bold", title)

  #v(0.5em)
  #text(size: 13pt, subtitle)

  #v(3em)
  #author
])

#page(numbering: none, align(bottom, text(size: 9pt)[
  © 2026 #author. All rights reserved.

  Set in Libertinus Serif with Typst.
]))

#heading(numbering: none)[Preface]

These notes accompany a one-semester first course in linear algebra.
They assume some calculus and a little comfort with proofs, and nothing more.
Each chapter starts from a concrete question, works an example by hand, and ends with exercises.

Chapter 1 builds the language of vectors: combinations, spans and inner products.
Chapter 2 asks which directions a matrix leaves alone, and uses the answer to take matrices apart.

#outline(title: "Contents")

#include "chapters/ch1-vectors.typ"
#include "chapters/ch2-eigenvalues.typ"

#bibliography("refs.bib", title: "References")
