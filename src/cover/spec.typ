// The cover's measurements. Typst Studio fills these in from the book (page
// size and page count) when you choose Update Cover from Book; change them by
// hand if your printer tells you otherwise.

#let trim-width = {{width}}
#let trim-height = {{height}}
#let pages = {{pages}}

// Paper thickness per page (sets the spine width). Amazon KDP publishes:
// white paper 0.002252in, cream 0.0025in, colour 0.002347in.
#let paper = {{paper}}

// Or the exact spine width from your printer's cover calculator (a Mixam
// quote, Lulu's or IngramSpark's cover template). It wins when set,
// e.g. 15.2mm. none = pages × paper.
#let spine-width = {{spine}}

// Extra picture around the edge, trimmed off after printing.
#let bleed = 0.125in

#let spine = if spine-width != none { spine-width } else { pages * paper }
#let cover-width = 2 * trim-width + spine + 2 * bleed
#let cover-height = trim-height + 2 * bleed
