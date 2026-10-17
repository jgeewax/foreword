= Vectors <ch-vectors>

A vector in $RR^n$ is an ordered list of $n$ real numbers. We write vectors in bold,
for example $bold(v) = (v_1, v_2, dots, v_n)$, and treat them as columns unless
stated otherwise.

== Linear combinations

Given vectors $bold(v)_1, dots, bold(v)_k$ and scalars $c_1, dots, c_k$, the vector

$ bold(w) = c_1 bold(v)_1 + c_2 bold(v)_2 + dots + c_k bold(v)_k $ <eq-lincomb>

is a _linear combination_ of them. The set of all such combinations is their span.
@fig-span shows two vectors in the plane and one of their combinations.

#figure(
  image("../figures/span.svg", width: 60%),
  caption: [Two vectors and a linear combination of them.],
) <fig-span>

== Inner products

The standard inner product on $RR^n$ is $chevron.l bold(u), bold(v) chevron.r =sum_(i=1)^n u_i v_i$.
Two vectors are orthogonal when their inner product is zero. A thorough treatment
appears in @strang2016.
