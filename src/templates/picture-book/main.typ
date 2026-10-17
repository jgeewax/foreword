// The main file: Typst Studio previews and exports this one. The story
// itself is in story.typ.
#import "style.typ": *

#let title = "{{title}}"
#let author = "{{author}}"

#show: book.with(title: title, author: author)

#cover(title: title, author: author, picture: "illustrations/sunny-day.svg")

#include "story.typ"

#the-end()
