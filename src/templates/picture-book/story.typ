// The story, one page at a time. Put your pictures in the illustrations
// folder (PNG, JPG or SVG) and name them in picture: "...".
//
//   #story-page(picture: "...", at: top)[...]   the words at the top (or bottom)
//   #vignette-page(picture: "...")[...]         a smaller picture, words under it
//   #spread(picture: "...", left: words(at: top)[...], right: words[...])
//                                               one wide picture over two pages
//   sounds: sound("splash!", x: 30%, y: 60%)    a sound word on the picture
//
// Keep each page to a sentence or two: the pictures carry the rest.
// Lines starting with // are notes to yourself and never appear in the book.
#import "style.typ": *

#story-page(picture: "illustrations/sunny-day.svg")[
  Every morning, Pip the snail climbed to the top of the hill.
]

#story-page(picture: "illustrations/starry-night.svg", at: top, sounds: sound("wow!", x: 72%, y: 42%))[
  It took Pip all day. \
  But oh, the view at night!
]

#vignette-page(picture: "illustrations/sunny-day.svg", size: 50%)[
  The next morning, Pip set off again.
]
