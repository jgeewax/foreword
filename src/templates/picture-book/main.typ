// The main file: Typst Studio previews and exports this one. The story
// itself is in story.typ.
#import "style.typ": *

#let title = "{{title}}"
#let author = "{{author}}"

// The page (trim) size: change both numbers to resize every page. You can
// also choose the typefaces (font: ..., title-font: ...), the colour of the
// title and sound words (accent: rgb("#2f7d6d")) and page numbers
// (page-numbers: true).
#show: book.with(title: title, author: author, width: {{width}}, height: {{height}})

#title-page(title: title, author: author, picture: "illustrations/sunny-day.svg")
#copyright-page(title: title, author: author, year: "{{year}}")

#include "story.typ"

#the-end(picture: "illustrations/starry-night.svg")
