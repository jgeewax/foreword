// How the book looks. You don't need this file to write: the story uses the
// pages below (see story.typ), and main.typ chooses the page size, typefaces,
// colour and page numbers (#show: book.with(...)).
//
//   #story-page     a picture across the whole page, the words on it
//   #spread         one wide picture across two facing pages
//   #vignette-page  a smaller picture on white, the words under it
//   #words          more words on a picture, wherever they fit
//   #sound          a sound word drawn on the picture ("splash!")
//   #title-page, #copyright-page, #dedication, #the-end
//
// Pictures that fill a page reach past its edges into the bleed when the book
// is exported for print, so no white edge shows after cutting.

// Words stay this far inside the edges of the page, and further from the
// binding, so nothing is cut off or lost in the fold.
#let quiet = 0.375in
#let gutter = 0.6in

#let ink = rgb("#3a2e2a")
#let paper = rgb("#fffdf8")

// The choices made in main.typ, for the pages below.
#let settings = state("picture-book", (title-font: none, accent: ink))

// How far pictures reach past the page edge (the bleed; 0pt in the preview).
#let bleed() = if type(page.bleed) == dictionary { 0pt } else { page.bleed }

// Left and right space for words on this page: the binding is on the left of a
// right-hand (odd) page and on the right of a left-hand (even) one.
#let sides() = if calc.odd(here().page()) { (gutter, quiet) } else { (quiet, gutter) }

// The page number, in the outside bottom corner, outlined so it shows on any picture.
#let folio = context {
  let n = here().page()
  let number(fill, stroke) = text(size: 11pt, weight: "bold", fill: fill, stroke: stroke, str(n))
  let mark = box({
    place(number(white, (paint: white, thickness: 2.4pt, join: "round")))
    number(ink.lighten(15%), none)
  })
  if calc.odd(n) { place(bottom + right, dx: -0.42in, dy: -0.32in, mark) } else {
    place(bottom + left, dx: 0.42in, dy: -0.32in, mark)
  }
}

#let book(
  title: "",
  author: "",
  width: 8.5in,
  height: 8.5in,
  // Rounded, friendly type; falls back to the bundled serif if missing.
  font: ("Avenir Next", "Helvetica Neue", "Libertinus Serif"),
  // For the title, The End and sound words (auto: the same as `font`).
  title-font: auto,
  accent: rgb("#d9733b"),
  page-numbers: false,
  body,
) = {
  set document(title: title, author: author)
  set page(width: width, height: height, margin: 0.55in, foreground: if page-numbers { folio })
  set text(font: font, size: 21pt, fill: ink, lang: "en", hyphenate: false)
  set par(leading: 0.6em, spacing: 0.9em, justify: false)
  set list(marker: text(fill: accent)[•], body-indent: 0.4em)
  settings.update((title-font: if title-font == auto { font } else { title-font }, accent: accent))
  body
}

// A picture filling the page, reaching into the bleed.
#let full-picture(picture) = context {
  let b = bleed()
  place(top + left, dx: -b, dy: -b, image(picture, width: page.width + 2 * b, height: page.height + 2 * b, fit: "cover"))
}

/// Words on the page, inside the safe area. `at`: top, horizon or bottom, and
/// left or right if they fit better to one side (`top + right`). With a
/// `panel`, they sit on a soft paper-coloured box so they read on any picture.
#let words(at: bottom, panel: true, body) = context {
  let (l, r) = sides()
  let w = page.width - l - r
  let pad = (x: 18pt, y: 12pt)
  let content = align(center, body)
  let m = measure(content, width: w - 2 * pad.x)
  if m.width == 0pt { return }
  let a = (if at.x == none { center } else { at.x }) + (if at.y == none { bottom } else { at.y })
  let b = block(width: m.width + 2 * pad.x, inset: pad, radius: 16pt, fill: if panel { paper.transparentize(12%) }, content)
  place(top + left, dx: l, dy: quiet, block(width: w, height: page.height - 2 * quiet, align(a, b)))
}

/// A sound word drawn on the picture, in the title typeface, outlined in
/// white. `x` and `y`: where its middle goes, across and down the page.
#let sound(word, x: 50%, y: 50%, angle: -10deg, size: 24pt, color: auto) = context {
  let s = settings.get()
  let draw(fill, stroke) = text(font: s.title-font, weight: "extrabold", size: size, fill: fill, stroke: stroke, word)
  place(center + horizon, dx: x - 50%, dy: y - 50%, rotate(angle, reflow: true, box({
    place(draw(white, (paint: white, thickness: size * 0.16, join: "round")))
    draw(if color == auto { s.accent } else { color }, none)
  })))
}

/// One page of the story: a picture across the whole page, the words on it.
/// `sounds`: sound words (or more #words) to put on the picture.
#let story-page(picture: none, at: bottom, panel: auto, sounds: none, body) = page(margin: 0pt, {
  if picture != none { full-picture(picture) }
  sounds
  words(at: at, panel: if panel == auto { picture != none } else { panel }, body)
})

/// A page that is all picture, for a big moment in the story.
#let picture-page(picture) = story-page(picture: picture)[]

/// One wide picture across two facing pages: a left-hand (even) page and the
/// right-hand one after it. `left` and `right`: what goes on each half,
/// usually #words(at: ...)[...].
#let spread(picture: none, left: none, right: none) = for side in ("left", "right") {
  page(margin: 0pt, context {
    let n = here().page()
    if side == "left" {
      assert(calc.even(n), message: "a spread starts on a left-hand (even) page, but this one starts on page " + str(n) + ": add or remove a page before it")
    }
    let b = bleed()
    // Each half reaches past the fold by the bleed, as printers ask.
    let dx = if side == "left" { -b } else { -page.width - b }
    place(top + std.left, dx: dx, dy: -b, image(picture, width: 2 * page.width + 2 * b, height: page.height + 2 * b, fit: "cover"))
    if side == "left" { left } else { right }
  })
}

// A picture on white, fitted into width × height, its edges faded into the
// page (soft) so it has no hard border.
#let vignette(picture, width, height, soft: true) = {
  let natural = measure(image(picture))
  let scale = calc.min(width / natural.width, height / natural.height)
  let (w, h) = (natural.width * scale, natural.height * scale)
  box(width: w, height: h, {
    image(picture, width: w, height: h)
    if soft {
      let clear = white.transparentize(100%)
      // A point larger all round, so no hairline of the picture shows at its edge.
      place(top + std.left, dx: -1pt, dy: -1pt, rect(width: w + 2pt, height: h + 2pt, stroke: none, fill: gradient.radial((clear, 0%), (clear, 88%), (white, 100%))))
    }
  })
}

/// A page with a smaller picture on white at the top and the words under it.
/// `size`: how much of the page's height the picture may take.
#let vignette-page(picture: none, size: 62%, soft: true, body) = page(margin: 0pt, context {
  let (l, r) = sides()
  let h = page.height * size
  place(top + center, dy: quiet, vignette(picture, page.width - 2 * quiet, h, soft: soft))
  place(top + left, dx: l, dy: quiet + h, block(width: page.width - l - r, height: page.height - 2 * quiet - h, align(center + horizon, body)))
})

/// The title page: the picture, then the title, subtitle and author.
#let title-page(title: "", subtitle: none, author: none, picture: none) = page(margin: (x: gutter, top: 0.55in, bottom: 0.7in), foreground: none, context {
  let s = settings.get()
  set align(center)
  let heading = {
    text(font: s.title-font, weight: "extrabold", size: 44pt, fill: s.accent, title)
    if subtitle != none and subtitle != "" {
      v(1.1em, weak: true)
      text(size: 15pt, subtitle)
    }
    if author != none and author != "" {
      v(1.1em, weak: true)
      text(size: 14pt, style: "italic")[by #author]
    }
  }
  if picture == none { return align(horizon, heading) }
  let room = page.height - 0.55in - 0.7in - measure(block(width: page.width - 2 * gutter, heading)).height - 0.4in
  vignette(picture, page.width - 2 * gutter, calc.min(room, page.height * 58%))
  v(1fr)
  heading
})

/// The copyright page, in small print at the foot of the page. Anything in
/// brackets after it (the edition, the typefaces) is added underneath.
#let copyright-page(title: "", subtitle: none, author: "", year: "", ..more) = page(margin: 0pt, foreground: none, context {
  let (l, r) = sides()
  place(bottom + left, dx: l + 0.25in, dy: -0.85in, block(width: calc.min(4.9in, page.width - l - r - 0.25in), {
    set text(size: 9pt, fill: ink.lighten(10%))
    set par(leading: 0.55em, spacing: 0.95em)
    text(size: 10.5pt, weight: "bold", title)
    if subtitle != none [ \ #emph(subtitle)]
    parbreak()
    [Copyright © #year #author. All rights reserved.]
    for note in more.pos() {
      parbreak()
      note
    }
  }))
})

/// Who the book is for, on a page of its own.
#let dedication(body) = page(foreground: none, context {
  let s = settings.get()
  align(center + horizon, {
    stack(dir: ltr, spacing: 7pt, ..range(3).map(_ => circle(radius: 2.6pt, fill: s.accent, stroke: none)))
    v(1em)
    text(size: 19pt, style: "italic", body)
  })
})

/// The last page: The End, with a picture under it if you like.
#let the-end(picture: none) = page(margin: (x: gutter, top: 0.8in, bottom: 0.7in), context {
  let s = settings.get()
  set align(center)
  let heading = text(font: s.title-font, weight: "extrabold", size: 44pt, fill: s.accent)[The End]
  if picture == none { return align(horizon, heading) }
  heading
  v(1fr)
  let room = page.height - 0.8in - 0.7in - measure(heading).height - 0.4in
  vignette(picture, page.width - 2 * gutter, calc.min(room, page.height * 61%))
})
