// Guides for the preview: where the printer trims, where the spine folds,
// the bleed, and the safe area to keep text inside. Never printed.
#import "spec.typ": *

#let guide-colour = rgb("#e0218a")

#let guide-layer() = {
  let vline(x, dash: "dashed") = place(top + left, dx: x, line(end: (0pt, cover-height), stroke: (paint: guide-colour, thickness: 0.6pt, dash: dash)))
  let label(dx, dy, body) = place(top + left, dx: dx, dy: dy, text(size: 6.5pt, fill: guide-colour, font: "DejaVu Sans Mono", body))
  // Bleed: everything outside the trim box is cut off.
  let shade = rgb(224, 33, 138, 30)
  place(top + left, rect(width: cover-width, height: bleed, fill: shade))
  place(bottom + left, rect(width: cover-width, height: bleed, fill: shade))
  place(top + left, rect(width: bleed, height: cover-height, fill: shade))
  place(top + right, rect(width: bleed, height: cover-height, fill: shade))
  place(top + left, dx: bleed, dy: bleed, rect(width: 2 * trim-width + spine, height: trim-height, stroke: 0.6pt + guide-colour))
  // Spine folds.
  vline(bleed + trim-width)
  vline(bleed + trim-width + spine)
  // Safe area: keep text at least 0.25in inside the trim and away from the folds.
  let safe = 0.25in
  place(top + left, dx: bleed + safe, dy: bleed + safe, rect(width: trim-width - 2 * safe, height: trim-height - 2 * safe, stroke: (paint: guide-colour, thickness: 0.4pt, dash: "dotted")))
  place(top + left, dx: bleed + trim-width + spine + safe, dy: bleed + safe, rect(width: trim-width - 2 * safe, height: trim-height - 2 * safe, stroke: (paint: guide-colour, thickness: 0.4pt, dash: "dotted")))
  // Where most printers put the barcode.
  place(top + left, dx: bleed + trim-width - safe - 2in, dy: bleed + trim-height - safe - 1.2in, rect(width: 2in, height: 1.2in, stroke: (paint: guide-colour, thickness: 0.4pt, dash: "dotted"), align(center + horizon, text(size: 6.5pt, fill: guide-colour)[barcode])))
  label(bleed + 6pt, bleed + 6pt)[BACK]
  label(bleed + trim-width + spine + 6pt, bleed + 6pt)[FRONT]
  label(bleed + trim-width + 2pt, cover-height - bleed - 12pt)[spine #calc.round(spine / 1mm, digits: 1) mm]
}
