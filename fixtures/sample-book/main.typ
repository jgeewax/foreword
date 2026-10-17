#set document(title: "Linear Algebra Notes", author: "Typst Studio fixture")
#set page(paper: "a5", margin: (x: 1.8cm, y: 2cm), numbering: "1")
#set text(size: 11.55pt)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  it
}

#align(center + horizon)[
  #text(size: 24.2pt, weight: "bold")[Linear Algebra Notes]

  #v(0.5em)
  A sample book for Typst Studio!
]

#outline()

#include "chapters/ch1-vectors.typ"
#include "chapters/ch2-eigenvalues.typ"

#bibliography("refs.bib", title: "References")
