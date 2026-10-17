// Runnable code examples (Typst Studio).
//
// Write an example like this, then click ▶ Run above it in Typst Studio:
//
//   #run("greeting", ```python
//   print("Hello")
//   ```)
//
// The book shows the code and, below it, its output. Give every example its
// own name. Add expect: "Hello" to check the output (marked ✓ or ✗).
// Outputs are kept in code-output/outputs.json, so the book also builds
// without Typst Studio. Change how examples look in this file.

#let code-outputs = json("/code-output/outputs.json")

#let code-panel(accent, body) = block(
  width: 100%,
  above: 0.4em,
  breakable: true,
  inset: (x: 8pt, y: 6pt),
  radius: 2pt,
  fill: luma(246),
  stroke: (left: 2pt + accent),
  body,
)

#let code-note(accent, body) = text(size: 0.75em, weight: "bold", fill: accent, body)

/// A code example and its output. `src` is a raw block: ```python … ```.
#let run(name, src, expect: none, show-code: true, show-output: true) = {
  let entry = code-outputs.at(name, default: none)
  let ok = rgb("#2a8a3e")
  let bad = rgb("#c62828")
  let warn = rgb("#b26a00")
  block(breakable: true, width: 100%, {
    if show-code { src }
    if not show-output { return }
    if entry == none {
      code-panel(warn, code-note(warn)[Not run yet: run this example in Typst Studio (▶ Run above it).])
      return
    }
    let out = entry.at("stdout", default: "")
    let err = entry.at("stderr", default: "")
    let exit = entry.at("exit", default: 0)
    let current = entry.at("code", default: "").trim() == src.text.trim()
    let failed = exit != 0
    let mismatch = expect != none and out.trim() != expect.trim()
    let accent = if not current { warn } else if failed or mismatch { bad } else { ok }
    code-panel(accent, {
      if not current {
        code-note(warn)[Output (out of date: the code changed since it last ran)]
      } else if failed {
        code-note(bad)[Output (failed#if exit != none [, exit code #exit] else [: stopped])]
      } else if mismatch {
        code-note(bad)[Output (✗ expected #raw(expect.trim()))]
      } else if expect != none {
        code-note(ok)[Output ✓]
      } else {
        code-note(luma(90))[Output]
      }
      if out.trim() != "" { raw(out.trim(at: end), block: true) }
      if err.trim() != "" { text(fill: bad, raw(err.trim(at: end), block: true)) }
    })
  })
}
