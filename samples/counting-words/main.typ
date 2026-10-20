// The main file: Foreword previews and exports this one. It sets up the
// book and pulls in the chapters, in the order listed below.
// To add a chapter: File → New Chapter (⌥⌘N), or create a file in chapters/
// and add an #include line for it below.
#import "style.typ": *

#let title = "Counting Words"
#let subtitle = "Python for writers, one small program at a time"
#let author = "The Foreword team"

// The page (trim) size: change both numbers to resize every page.
#show: book.with(title: title, author: author, width: 7.5in, height: 9.25in)

// Keep each example on one page: its code, and the output panel under it
// (code.typ draws that panel with a luma(246) fill).
#show raw.where(block: true): set block(breakable: false, sticky: true)
#show block.where(fill: luma(246)): it => block(breakable: false, above: it.above, it)

#title-page(title: title, subtitle: subtitle, author: author, edition: "First edition")

// The copyright page, written here instead of #copyright-page: this book is a
// sample that comes with Foreword, and it quotes a public-domain novel.
#page(header: none, footer: none)[
  #set text(size: 8.5pt)
  #v(1fr)
  #emph(title) \
  Copyright © 2026 The Foreword team.

  This is a sample book that comes with Foreword, to show what a finished programming book looks like.
  Open it, change it and run its examples as much as you like.

  The examples quote the opening of _Pride and Prejudice_ by Jane Austen, first published in 1813.
  Its text is in the public domain.

  Every example was run with Python 3.9, and its output is printed below it.
]

#outline(title: [Contents], depth: 2)

#start-body()

#include "chapters/01-first-steps.typ"
#include "chapters/02-counting-words.typ"
#include "chapters/03-the-words-you-use-most.typ"
#include "chapters/04-how-long-are-your-sentences.typ"
