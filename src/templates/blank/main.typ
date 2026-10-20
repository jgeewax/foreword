// The main file: Foreword previews and exports this one.
// The #set lines below decide how every page looks; the chapters are pulled
// in with #include at the bottom, in order.

#let title = "{{title}}"
#let author = "{{author}}"

#set document(title: title, author: author)
// Typst's own margins, which grow and shrink with the page. To set them: margin: (x: 2cm, y: 2.5cm).
#set page(width: {{width}}, height: {{height}}, numbering: "1")
#set text(font: "Libertinus Serif", size: 11pt, lang: "en")
#set par(justify: true, first-line-indent: 1.2em, spacing: 0.65em)
#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  block(above: 0pt, below: 1cm, inset: (top: 2cm), text(size: 18pt, weight: "regular", it.body))
}

// Title page
#page(numbering: none, align(center + horizon)[
  #text(size: 24pt, title) \
  #v(1em)
  #author
])
#counter(page).update(1)

#include "chapters/01-chapter.typ"
