// The main file: Foreword previews and exports this one. The story
// itself is in story.typ.
#import "style.typ": *

#let title = "Luca's Wonderful Brain"
#let subtitle = "A book about autism, for Luca and Summer"
#let author = "JJ Geewax"

// A square hardcover, 8.5 × 8.5 in. The words are set in Andika, a typeface
// made for children learning to read, and the title and sound words in
// Sniglet. Both are in the fonts folder, which the book uses through
// Settings ▸ This book ▸ Files ▸ Fonts.
#show: book.with(
  title: title,
  author: author,
  width: 8.5in,
  height: 8.5in,
  font: "Andika",
  title-font: "Sniglet",
  page-numbers: true,
)

#title-page(title: [Luca's \ Wonderful Brain], subtitle: subtitle, picture: "illustrations/01-title.jpg")

#copyright-page(title: title, subtitle: subtitle, author: author, year: "2026")[
  The Adventures of Luca, Book 1
][
  Text set in Andika and Sniglet.
][
  First edition, 2026
][
  _Made with ❤️ in Singapore 🇸🇬._
]

#dedication[
  For Luca and Summer. \
  We love you just the way you are.
]

#include "story.typ"

#the-end(picture: "illustrations/22-the-end.jpg")

// Printers bind pages in sheets, so the page count must be even (Mixam:
// a multiple of 4). The last page is left blank.
#page(foreground: none)[]
