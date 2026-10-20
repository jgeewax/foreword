// The main file: Foreword previews and exports this one. It sets up the
// book and pulls in the chapters, in the order listed at the bottom.
// To add a chapter: File → New Chapter (⌥⌘N), or create a file in chapters/
// and add an #include line for it below.
#import "style.typ": *

#let title = "Strange Case of Dr Jekyll and Mr Hyde"
#let author = "Robert Louis Stevenson"

// The page (trim) size: change both numbers to resize every page.
#show: book.with(title: title, author: author, width: 5in, height: 8in)

// Letters and notes quoted in the story are set apart: indented, a little smaller.
#show quote.where(block: true): set text(size: 10pt)

// The title breaks where the first edition's title page breaks it.
#title-page(title: [Strange Case of \ Dr Jekyll and Mr Hyde], author: author)

// The copyright page: the text is in the public domain.
#page(header: none, footer: none)[
  #set text(size: 8.5pt)
  #set par(first-line-indent: 0pt, justify: false, spacing: 1em)
  #v(1fr)
  #emph(title) \
  by #author

  First published in 1886 by Longmans, Green & Co., London. \
  The text of this book is in the public domain.
]

#dedication[
  #set par(first-line-indent: 0pt, justify: false, spacing: 1.6em)
  // The dedication is in italics; emph inside it sets this line upright.
  #text(size: 9pt, tracking: 0.12em, emph(upper[To Katharine de Mattos]))

  It's ill to loose the bands that God decreed to bind; \
  Still will we be the children of the heather and the wind. \
  Far away from home, O it's still for you and me \
  That the broom is blowing bonnie in the north countrie.
]

// The first chapter opens on a right-hand page.
#pagebreak(to: "odd")
#start-story()

#include "chapters/01-story-of-the-door.typ"
#include "chapters/02-search-for-mr-hyde.typ"
#include "chapters/03-dr-jekyll-was-quite-at-ease.typ"
#include "chapters/04-the-carew-murder-case.typ"
#include "chapters/05-incident-of-the-letter.typ"
#include "chapters/06-remarkable-incident-of-dr-lanyon.typ"
#include "chapters/07-incident-at-the-window.typ"
#include "chapters/08-the-last-night.typ"
#include "chapters/09-dr-lanyons-narrative.typ"
#include "chapters/10-henry-jekylls-full-statement-of-the-case.typ"
