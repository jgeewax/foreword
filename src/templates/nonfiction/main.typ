// The main file: Typst Studio previews and exports this one. It sets up the
// book and pulls in the chapters, in the order listed below.
// To add a chapter: create a file in chapters/ and add an #include line.
#import "style.typ": *

#let title = "{{title}}"
#let subtitle = "A subtitle that says what the book is about"
#let author = "{{author}}"

#show: book.with(title: title, author: author)

#title-page(title: title, subtitle: subtitle, author: author)
#copyright-page(title: title, author: author, year: "{{year}}")

#outline(title: [Contents], depth: 1)

#start-body()

#include "chapters/00-introduction.typ"
#include "chapters/01-first-chapter.typ"

// Everything you cite with @key (see refs.bib) is listed here.
#bibliography("refs.bib", title: [Sources], style: "chicago-author-date")
