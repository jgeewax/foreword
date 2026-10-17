// The main file: Typst Studio previews and exports this one. It sets up the
// book and pulls in the chapters, in the order listed at the bottom.
// To add a chapter: create a file in chapters/ and add an #include line.
#import "style.typ": *

#let title = "{{title}}"
#let author = "{{author}}"

#show: book.with(title: title, author: author)

#title-page(title: title, author: author)
#copyright-page(title: title, author: author, year: "{{year}}")
#dedication[For everyone who reads to the last page.]

#start-story()

#include "chapters/01-chapter-one.typ"
#include "chapters/02-chapter-two.typ"
