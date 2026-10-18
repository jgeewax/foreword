= Eigenvalues <ch-eigen>

Let $A$ be an $n times n$ matrix.
A nonzero vector $bold(v)$ is an _eigenvector_ of $A$ with _eigenvalue_ $lambda$ when

$ A bold(v) = lambda bold(v). $ <eq-eigen>

Multiplying by $A$ only stretches an eigenvector: its direction stays, and $lambda$ says by how much.
Rearranging @eq-eigen gives $(A - lambda I) bold(v) = bold(0)$, which has a nonzero solution exactly when $A - lambda I$ is singular.

== The characteristic polynomial

The eigenvalues of $A$ are the roots of its characteristic polynomial

$ p(lambda) = det(A - lambda I). $ <eq-charpoly>

For a $2 times 2$ matrix this is a quadratic, so there are at most two eigenvalues.
Compare this with the linear combinations of @ch-vectors, where the span of the eigenvectors determines whether $A$ can be diagonalized @axler2015.

== A worked example

Take $A = mat(2, 1; 1, 2)$.
Then $p(lambda) = (2 - lambda)^2 - 1$, whose roots are $lambda = 1$ and $lambda = 3$, with eigenvectors $(1, -1)$ and $(1, 1)$.
The two eigenvectors are orthogonal.
That is no accident: a symmetric matrix always has orthogonal eigenvectors for different eigenvalues.

== Diagonalization

Suppose $A$ has $n$ linearly independent eigenvectors.
Put them side by side as the columns of a matrix $P$, and the eigenvalues on the diagonal of a matrix $D$, in the same order.
Then $A P = P D$, and since $P$ is invertible,

$ A = P D P^(-1). $ <eq-diag>

Powers of $A$ are then cheap: $A^k = P D^k P^(-1)$, and $D^k$ only raises each diagonal entry to the $k$th power.
For the matrix of the worked example,

$ A^k = 1 / 2 mat(3^k + 1, 3^k - 1; 3^k - 1, 3^k + 1). $

== Exercises

+ Find the eigenvalues and eigenvectors of $mat(4, 1; 2, 3)$.
+ Show that $mat(1, 1; 0, 1)$ has only one eigenvalue, and that it can't be diagonalized.
+ Use @eq-diag to compute $A^5$ for the matrix of the worked example.
  Check one entry by multiplying the matrices out.
