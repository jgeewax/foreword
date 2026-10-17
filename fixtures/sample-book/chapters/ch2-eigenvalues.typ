= Eigenvalues <ch-eigen>

Let $A$ be an $n times n$ matrix. A nonzero vector $bold(v)$ is an _eigenvector_ of $A$
with _eigenvalue_ $lambda$ when

$ A bold(v) = lambda bold(v). $ <eq-eigen>

Rearranging @eq-eigen gives $(A - lambda I) bold(v) = bold(0)$, which has a nonzero
solution exactly when $A - lambda I$ is singular.

== The characteristic polynomial

The eigenvalues of $A$ are the roots of its characteristic polynomial

$ p(lambda) = det(A - lambda I). $ <eq-charpoly>

For a $2 times 2$ matrix this is a quadratic, so there are at most two eigenvalues.
Compare this with the linear combinations of @ch-vectors, where the span of the
eigenvectors determines whether $A$ can be diagonalized @axler2015.

== A worked example

Take $A = mat(2, 1; 1, 2)$. Then $p(lambda) = (2 - lambda)^2 - 1$, whose roots are
$lambda = 1$ and $lambda = 3$, with eigenvectors $(1, -1)$ and $(1, 1)$.
