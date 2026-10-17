// How the book looks. You don't need this file to write: the story uses
// #story-page and #picture-page (see story.typ). Change the page size, the
// typeface or the text size here and every page follows.

#let book(title: "", author: "", body) = {
  set document(title: title, author: author)
  // A square 8.5 × 8.5 inch picture book, no page numbers.
  set page(width: 8.5in, height: 8.5in, margin: 0.55in)
  // Rounded, friendly type; falls back to the bundled serif if missing.
  set text(font: ("Avenir Next", "Helvetica Neue", "Libertinus Serif"), size: 21pt, lang: "en")
  set par(leading: 0.75em, spacing: 1.1em, justify: false)
  body
}

#let cover(title: "", author: "", picture: none) = page(margin: 0.6in)[
  #set align(center)
  #v(0.2in)
  #text(size: 40pt, weight: "bold", title)
  #v(1fr)
  #if picture != none { image(picture, height: 55%) }
  #v(1fr)
  #text(size: 18pt, author)
]

/// One page of the story: a picture on top, a few lines of text below.
#let story-page(picture: none, body) = page[
  #set align(center)
  #if picture != none {
    block(height: 66%, width: 100%, align(center + horizon, image(picture, height: 100%)))
  }
  #v(1fr)
  #body
  #v(1fr)
]

/// A page that is all picture, for a big moment in the story.
#let picture-page(picture) = page(margin: 0pt, image(picture, width: 100%, height: 100%, fit: "cover"))

#let the-end() = page(align(center + horizon, text(size: 34pt, weight: "bold")[The End]))
