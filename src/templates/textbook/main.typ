// The main file: Typst Studio previews and exports this one. It sets up the
// book and pulls in the chapters, in the order listed below.
// To add a chapter: create a file in chapters/ and add an #include line.
#import "style.typ": *

#let title = "{{title}}"
#let subtitle = "An introduction"
#let author = "{{author}}"

#show: book.with(title: title, author: author)

#title-page(title: title, subtitle: subtitle, author: author, edition: "First edition")
#copyright-page(title: title, author: author, year: "{{year}}")

#outline(title: [Contents], depth: 2)

#start-body()

#include "chapters/01-getting-started.typ"
#include "chapters/02-next-steps.typ"

// Everything you cite with @key (see refs.bib) is listed here.
#bibliography("refs.bib", title: [References])
