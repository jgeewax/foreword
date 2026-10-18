= Vectors <ch-vectors>

A vector in $RR^n$ is an ordered list of $n$ real numbers.
We write vectors in bold, for example $bold(v) = (v_1, v_2, dots, v_n)$, and treat them as columns unless stated otherwise.
Vectors are added entry by entry, and a scalar multiplies every entry: $bold(u) + bold(v) = (u_1 + v_1, dots, u_n + v_n)$ and $c bold(v) = (c v_1, dots, c v_n)$.

== Linear combinations

Given vectors $bold(v)_1, dots, bold(v)_k$ and scalars $c_1, dots, c_k$, the vector

$ bold(w) = c_1 bold(v)_1 + c_2 bold(v)_2 + dots + c_k bold(v)_k $ <eq-lincomb>

is a _linear combination_ of them.
The set of all such combinations is their _span_.
@fig-span shows two vectors in the plane and one of their combinations.

#figure(
  image("../figures/span.svg", width: 60%),
  caption: [Two vectors and a linear combination of them.],
) <fig-span>

The vectors are _linearly independent_ when the only combination that gives $bold(0)$ is the one with every $c_i = 0$.
Then each vector in their span is a combination of them in exactly one way, and they form a _basis_ of it.
Two vectors in the plane that don't point along the same line are independent, so every vector in the plane is a combination of them.

== Inner products

The standard inner product on $RR^n$ is $chevron.l bold(u), bold(v) chevron.r = sum_(i=1)^n u_i v_i$.
Two vectors are orthogonal when their inner product is zero.
The length $norm(bold(v))$ of a vector is given by $norm(bold(v))^2 = chevron.l bold(v), bold(v) chevron.r$, and the Cauchy–Schwarz inequality bounds any inner product by the lengths:

$ |chevron.l bold(u), bold(v) chevron.r| <= norm(bold(u)) norm(bold(v)). $ <eq-cauchy-schwarz>

A thorough treatment appears in @strang2016.

== Exercises

+ Write $(3, 5)$ as a linear combination of $(1, 1)$ and $(1, -1)$.
+ Are $(1, 2, 3)$, $(4, 5, 6)$ and $(7, 8, 9)$ linearly independent?
  Find a combination of them that gives $bold(0)$, or show that there is none.
+ Show that $bold(u) + bold(v)$ and $bold(u) - bold(v)$ are orthogonal exactly when $norm(bold(u)) = norm(bold(v))$.
