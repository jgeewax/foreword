// The main file: Foreword previews and exports this one. It sets up the
// book and pulls in the chapters, in the order listed below.
// To add a chapter: File → New Chapter (⌥⌘N), or create a file in chapters/
// and add an #include line for it below.
#import "style.typ": *

#let title = "Calculus Made Easy"
#let subtitle = "Being a very-simplest introduction to those beautiful methods of reckoning which are generally called by the terrifying names of the differential calculus and the integral calculus"
#let author = "Silvanus P. Thompson"

// The page (trim) size: change both numbers to resize every page.
#show: book.with(title: title, author: author, width: 6in, height: 9in)

// Thompson never refers to an equation by its number, so equations go unnumbered.
#set math.equation(numbering: none)

#title-page(title: title, subtitle: subtitle, author: author, edition: "Second edition")

// The book's history, in place of a copyright notice: the text is in the public domain.
#page(header: none, footer: none)[
  #set text(size: 8.5pt)
  #v(1fr)
  #emph(title) \
  First edition 1910. Reprinted 1911 (twice), 1912, 1913. \
  Second edition, enlarged, 1914. \
  London: Macmillan and Co., Limited. \
  The text is in the public domain.
]

// The motto Thompson set at the front of the book.
#page(header: none, footer: none)[
  #v(1fr)
  #align(center, block[
    What one fool can do, another can.
    #align(right)[(_Ancient Simian Proverb._)]
  ])
  #v(2fr)
]

#outline(title: [Contents], depth: 2)

#start-body()

#include "chapters/00-prologue.typ"
#include "chapters/01-preliminary-terrors.typ"
#include "chapters/02-degrees-of-smallness.typ"
#include "chapters/03-relative-growings.typ"
#include "chapters/04-simplest-cases.typ"
#include "chapters/05-constants.typ"
#include "chapters/06-answers.typ"
