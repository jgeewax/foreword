// The main file: Typst Studio previews and exports this one. The story
// itself is in story.typ.
#import "style.typ": *

#let title = "The Tale of Peter Rabbit"
#let author = "Beatrix Potter"

// The page (trim) size: change both numbers to resize every page.
#show: book.with(title: title, author: author, width: 8in, height: 10in)

#cover(title: title, author: author, picture: "illustrations/01-frontispiece.jpg")

#include "story.typ"

// Where the book comes from, in small type at the foot of the last page.
#set page(footer-descent: 0%, footer: align(center, text(size: 10pt)[
  First published 1902 by Frederick Warne & Co. \
  Text and illustrations are in the public domain.
]))

#the-end()
