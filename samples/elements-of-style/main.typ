// The main file: Typst Studio previews and exports this one. It sets up the
// book and pulls in the chapters, in the order listed below.
// To add a chapter: File → New Chapter (⌥⌘N), or create a file in chapters/
// and add an #include line for it below.
#import "style.typ": *

#let title = "The Elements of Style"
#let subtitle = ""
#let author = "William Strunk Jr."

// The page (trim) size: change both numbers to resize every page.
#show: book.with(title: title, author: author, width: 5.5in, height: 8.5in)

#title-page(title: title, subtitle: subtitle, author: author)

// The copyright page. The text is in the public domain, so instead of the
// template's "All rights reserved" this page says when it was first printed.
#page(header: none, footer: none)[
  #set text(size: 8.5pt)
  #set par(first-line-indent: 0pt, justify: false, spacing: 1em)
  #v(1fr)
  #emph(title) \
  by #author, Professor of English in Cornell University

  First printed privately at Ithaca, New York, in 1918.
  This text follows the edition published in New York in 1920.

  The text is in the public domain.
]

#outline(title: [Contents], depth: 1)

#start-body()

// Strunk numbers his chapters from the introductory one (Chapter I), and the
// text refers to them by number, so every chapter here is numbered.
#include "chapters/01-introductory.typ"
#include "chapters/02-elementary-rules-of-usage.typ"
#include "chapters/03-elementary-principles-of-composition.typ"
#include "chapters/04-a-few-matters-of-form.typ"
#include "chapters/05-words-and-expressions-commonly-misused.typ"
#include "chapters/06-spelling.typ"
#include "chapters/07-exercises.typ"

// The book cites nothing with @key, so it has no list of sources. To add one,
// create refs.bib and add this line:
// #bibliography("refs.bib", title: [Sources], style: "chicago-author-date")
