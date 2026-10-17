// A chapter. "= Title" starts it, "== Title" a section, "=== Title" a
// subsection; they're numbered automatically. A blank line starts a new
// paragraph. Lines starting with // are notes to yourself.
//
// Math goes between dollar signs: $x^2$ inline, or on its own line with
// spaces inside ($ x^2 $) for a numbered equation. Add a <label> after a
// figure or equation and refer to it with @label.
#import "../style.typ": *

= Getting Started

This chapter shows the building blocks of the book. Replace it with your own
material, or ask the agent to turn your notes into a first draft.

== Rates of change

#definition("Average rate of change")[
  The average rate of change of a function $f$ between $a$ and $b$ is the
  slope of the line through the two points on its graph.
]

In symbols, the average rate of change is

$ (f(b) - f(a)) / (b - a). $ <eq-average-rate>

As $b$ gets closer to $a$, @eq-average-rate approaches the slope of the
tangent line, shown in @fig-tangent.

#figure(
  image("../figures/tangent.svg", width: 70%),
  caption: [A secant line (dashed) approaching the tangent line at $a$.],
) <fig-tangent>

#example(title: "A falling stone")[
  A stone falls $s(t) = 4.9 t^2$ metres in $t$ seconds. Between $t = 1$ and
  $t = 2$ its average speed is $(19.6 - 4.9) / (2 - 1) = 14.7$ m/s.
]

#key-idea[The derivative is the limit of average rates of change.]

The idea goes back to Newton and Leibniz; see @stewart2015 for a modern
treatment.

#exercises[
  + Find the average rate of change of $f(x) = x^2$ between $x = 1$ and $x = 3$.
  + Explain in one sentence why @eq-average-rate is undefined when $a = b$.
]
