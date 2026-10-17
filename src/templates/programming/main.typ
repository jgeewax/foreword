// The main file: Typst Studio previews and exports this one. It sets up the
// book and pulls in the chapters, in the order listed below.
// To add a chapter: File → New Chapter (⌥⌘N), or create a file in chapters/
// and add an #include line for it below.
#import "style.typ": *

#let title = "{{title}}"
#let subtitle = "Learning by running the code"
#let author = "{{author}}"

// The page (trim) size: change both numbers to resize every page.
#show: book.with(title: title, author: author, width: {{width}}, height: {{height}})

#title-page(title: title, subtitle: subtitle, author: author, edition: "First edition")
#copyright-page(title: title, author: author, year: "{{year}}")

#outline(title: [Contents], depth: 2)

#start-body()

#include "chapters/01-first-steps.typ"
#include "chapters/02-functions.typ"
