#import "../style.typ": *

= Simplest Cases

Now let us see how, on first principles, we can differentiate some simple algebraical expression.

_Case 1._
Let us begin with the simple expression $y = x^2$.
Now remember that the fundamental notion about the calculus is the idea of _growing_.
Mathematicians call it _varying_.
Now as $y$ and $x^2$ are equal to one another, it is clear that if $x$ grows, $x^2$ will also grow.
And if $x^2$ grows, then $y$ will also grow.
What we have got to find out is the proportion between the growing of $y$ and the growing of $x$.
In other words our task is to find out the ratio between $d y$ and $d x$, or, in brief, to find the value of $(d y)/(d x)$.

Let $x$, then, grow a little bit bigger and become $x + d x$; similarly, $y$ will grow a bit bigger and will become $y + d y$.
Then, clearly, it will still be true that the enlarged $y$ will be equal to the square of the enlarged $x$.
Writing this down, we have:
$ y + d y = (x + d x)^2. $
Doing the squaring we get:
$ y + d y = x^2 + 2x dot d x + (d x)^2. $

What does $(d x)^2$ mean?
Remember that $d x$ meant a bit---a little bit---of $x$.
Then $(d x)^2$ will mean a little bit of a little bit of $x$; that is, as explained above (#ref(<smallness>, form: "page")), it is a small quantity of the second order of smallness.
It may therefore be discarded as quite inconsiderable in comparison with the other terms.
Leaving it out, we then have:
$ y + d y = x^2 + 2x dot d x. $ <eq-x-squared>
Now $y = x^2$; so let us subtract this from the equation and we have left
$ d y = 2x dot d x. $
Dividing across by $d x$, we find
$ (d y)/(d x) = 2x. $

Now _this_#footnote[
  _N.B._---This ratio $(d y)/(d x)$ is the result of differentiating $y$ with respect to $x$.
  Differentiating means finding the differential coefficient.
  Suppose we had some other function of $x$, as, for example, $u = 7x^2 + 3$.
  Then if we were told to differentiate this with respect to $x$, we should have to find $(d u)/(d x)$, or, what is the same thing, $(d (7x^2 + 3))/(d x)$.
  On the other hand, we may have a case in which time was the independent variable (see #ref(<independent-variables>, form: "page")), such as this: $y = b + 1/2 a t^2$.
  Then, if we were told to differentiate it, that means we must find its differential coefficient with respect to $t$.
  So that then our business would be to try to find $(d y)/(d t)$, that is, to find $(d (b + 1/2 a t^2))/(d t)$.
] is what we set out to find.
The ratio of the growing of $y$ to the growing of $x$ is, in the case before us, found to be $2x$.

_Numerical example._
Suppose $x = 100$ and $therefore y = "10,000"$.
Then let $x$ grow till it becomes 101 (that is, let $d x = 1$).
Then the enlarged $y$ will be $101 times 101 = "10,201"$.
But if we agree that we may ignore small quantities of the second order, 1 may be rejected as compared with 10,000; so we may round off the enlarged $y$ to 10,200.
$y$ has grown from 10,000 to 10,200; the bit added on is $d y$, which is therefore 200.

$(d y)/(d x) = 200/1 = 200$.
According to the algebra-working of the previous paragraph, we find $(d y)/(d x) = 2x$.
And so it is; for $x = 100$ and $2x = 200$.

But, you will say, we neglected a whole unit.

Well, try again, making $d x$ a still smaller bit.

Try $d x = 1/10$.
Then $x + d x = 100.1$, and
$ (x + d x)^2 = 100.1 times 100.1 = "10,020.01". $

Now the last figure 1 is only one-millionth part of the 10,000, and is utterly negligible; so we may take 10,020 without the little decimal at the end.
And this makes $d y = 20$; and $(d y)/(d x) = 20/0.1 = 200$, which is still the same as $2x$.

_Case 2._
Try differentiating $y = x^3$ in the same way.

We let $y$ grow to $y + d y$, while $x$ grows to $x + d x$.

Then we have
$ y + d y = (x + d x)^3. $

Doing the cubing we obtain
$ y + d y = x^3 + 3x^2 dot d x + 3x (d x)^2 + (d x)^3. $

Now we know that we may neglect small quantities of the second and third orders; since, when $d y$ and $d x$ are both made indefinitely small, $(d x)^2$ and $(d x)^3$ will become indefinitely smaller by comparison.
So, regarding them as negligible, we have left:
$ y + d y = x^3 + 3x^2 dot d x. $

But $y = x^3$; and, subtracting this, we have:
$
                     d y & = 3x^2 dot d x, \
  "and" quad (d y)/(d x) & = 3x^2.
$

_Case 3._
Try differentiating $y = x^4$.
Starting as before by letting both $y$ and $x$ grow a bit, we have:
$ y + d y = (x + d x)^4. $
Working out the raising to the fourth power, we get
$ y + d y = x^4 + 4x^3 thin d x + 6x^2 (d x)^2 + 4x (d x)^3 + (d x)^4. $
Then striking out the terms containing all the higher powers of $d x$, as being negligible by comparison, we have
$ y + d y = x^4 + 4x^3 thin d x. $
Subtracting the original $y = x^4$, we have left
$
                     d y & = 4x^3 thin d x, \
  "and" quad (d y)/(d x) & = 4x^3.
$

Now all these cases are quite easy.
Let us collect the results to see if we can infer any general rule.
Put them in two columns, the values of $y$ in one and the corresponding values found for $(d y)/(d x)$ in the other: thus

#figure(table(
  columns: 2,
  inset: (x: 1.2em, y: 0.5em),
  align: (center, left),
  stroke: 0.5pt,
  table.header([$y$], [$(d y)/(d x)$]),
  [$x^2$], [$2x$],
  [$x^3$], [$3x^2$],
  [$x^4$], [$4x^3$],
))

Just look at these results: the operation of differentiating appears to have had the effect of diminishing the power of $x$ by 1 (for example in the last case reducing $x^4$ to $x^3$), and at the same time multiplying by a number (the same number in fact which originally appeared as the power).
Now, when you have once seen this, you might easily conjecture how the others will run.
You would expect that differentiating $x^5$ would give $5x^4$, or differentiating $x^6$ would give $6x^5$.
If you hesitate, try one of these, and see whether the conjecture comes right.

Try $y = x^5$.
Then
$
  y + d y & = (x + d x)^5 \
          & = x^5 + 5x^4 thin d x + 10x^3 (d x)^2 + 10x^2 (d x)^3 + 5x (d x)^4 + (d x)^5.
$

Neglecting all the terms containing small quantities of the higher orders, we have left
$
                    y + d y & = x^5 + 5x^4 thin d x, \
   "and subtracting" quad y & = x^5 "leaves us" \
                        d y & = 5x^4 thin d x, \
  "whence" quad (d y)/(d x) & = 5x^4, "exactly as we supposed."
$

Following out logically our observation, we should conclude that if we want to deal with any higher power,---call it $n$---we could tackle it in the same way.
$ "Let" quad y = x^n, $
then, we should expect to find that
$ (d y)/(d x) = n x^((n-1)). $

For example, let $n = 8$, then $y = x^8$; and differentiating it would give $(d y)/(d x) = 8x^7$.

And, indeed, the rule that differentiating $x^n$ gives as the result $n x^(n-1)$ is true for all cases where $n$ is a whole number and positive.
\[Expanding $(x + d x)^n$ by the binomial theorem will at once show this.\]
But the question whether it is true for cases where $n$ has negative or fractional values requires further consideration.

== Case of a negative power

Let $y = x^(-2)$.
Then proceed as before:
$
  y + d y & = (x + d x)^(-2) \
          & = x^(-2) (1 + (d x)/x)^(-2).
$
Expanding this by the binomial theorem, we get
$
  & = x^(-2) [1 - (2 thin d x)/x + (2(2 + 1))/(1 times 2) ((d x)/x)^2 - "etc."] \
  & = x^(-2) - 2x^(-3) dot d x + 3x^(-4) (d x)^2 - 4x^(-5) (d x)^3 + "etc."
$
So, neglecting the small quantities of higher orders of smallness, we have:
$ y + d y = x^(-2) - 2x^(-3) dot d x. $
Subtracting the original $y = x^(-2)$, we find
$
          d y & = -2x^(-3) thin d x, \
  (d y)/(d x) & = -2x^(-3).
$
And this is still in accordance with the rule inferred above.

== Case of a fractional power

Let $y = x^(1/2)$.
Then, as before,
$
  y + d y & = (x + d x)^(1/2) = x^(1/2) (1 + (d x)/x)^(1/2) \
          & = sqrt(x) + 1/2 (d x)/sqrt(x) - 1/8 (d x)^2/(x sqrt(x)) + #box[terms with higher powers of $d x$.]
$

Subtracting the original $y = x^(1/2)$, and neglecting higher powers we have left:
$ d y = 1/2 (d x)/sqrt(x) = 1/2 x^(-1/2) dot d x, $
and $(d y)/(d x) = 1/2 x^(-1/2)$.
Agreeing with the general rule.

_Summary._
Let us see how far we have got.
We have arrived at the following rule:

#key-idea[
  To differentiate $x^n$, multiply by the power and reduce the power by one, so giving us $n x^(n-1)$ as the result.
]

#exercises[
  #metadata("exercises I") <exercises-i>
  (See #ref(<answers-i>, form: "page") for Answers.)

  Differentiate the following:

  + $y = x^13$
  + $y = x^(-3/2)$
  + $y = x^(2a)$
  + $u = t^(2.4)$
  + $z = root(3, u)$
  + $y = root(3, x^(-5))$
  + $u = root(5, 1/x^8)$
  + $y = 2x^a$
  + $y = root(q, x^3)$
  + $y = root(n, 1/x^m)$

  _You have now learned how to differentiate powers of $x$.
  How easy it is!_
]
