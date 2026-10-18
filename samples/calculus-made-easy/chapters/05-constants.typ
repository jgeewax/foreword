#import "../style.typ": *

= Next Stage. What to do with Constants

In our equations we have regarded $x$ as growing, and as a result of $x$ being made to grow $y$ also changed its value and grew.
We usually think of $x$ as a quantity that we can vary; and, regarding the variation of $x$ as a sort of _cause_, we consider the resulting variation of $y$ as an _effect_.
In other words, we regard the value of $y$ as depending on that of $x$.
Both $x$ and $y$ are variables, but $x$ is the one that we operate upon, and $y$ is the "dependent variable."
In all the preceding chapter we have been trying to find out rules for the proportion which the dependent variation in $y$ bears to the variation independently made in $x$.

Our next step is to find out what effect on the process of differentiating is caused by the presence of _constants_, that is, of numbers which don't change when $x$ or $y$ change their values.

== Added constants <added-constants>

Let us begin with some simple case of an added constant, thus:
$ "Let" quad y = x^3 + 5. $
Just as before, let us suppose $x$ to grow to $x + d x$ and $y$ to grow to $y + d y$.
$
  "Then:" quad y + d y & = (x + d x)^3 + 5 \
                       & = x^3 + 3x^2 thin d x + 3x (d x)^2 + (d x)^3 + 5.
$
Neglecting the small quantities of higher orders, this becomes
$ y + d y = x^3 + 3x^2 dot d x + 5. $
Subtract the original $y = x^3 + 5$, and we have left:
$
          d y & = 3x^2 thin d x. \
  (d y)/(d x) & = 3x^2.
$

So the 5 has quite disappeared.
It added nothing to the growth of $x$, and does not enter into the differential coefficient.
If we had put 7, or 700, or any other number, instead of 5, it would have disappeared.
So if we take the letter $a$, or $b$, or $c$ to represent any constant, it will simply disappear when we differentiate.

If the additional constant had been of negative value, such as $-5$ or $-b$, it would equally have disappeared.

== Multiplied constants

Take as a simple experiment this case:

Let $y = 7x^2$. \
Then on proceeding as before we get:
$
  y + d y & = 7(x + d x)^2 \
          & = 7{x^2 + 2x dot d x + (d x)^2} \
          & = 7x^2 + 14x dot d x + 7(d x)^2.
$
Then, subtracting the original $y = 7x^2$, and neglecting the last term, we have
$
          d y & = 14x dot d x. \
  (d y)/(d x) & = 14x.
$

Let us illustrate this example by working out the graphs of the equations $y = 7x^2$ and $(d y)/(d x) = 14x$, by assigning to $x$ a set of successive values, 0, 1, 2, 3, etc., and finding the corresponding values of $y$ and of $(d y)/(d x)$.

These values we tabulate as follows:

#figure(table(
  columns: 10,
  inset: (x: 0.45em, y: 0.5em),
  align: (center, ..(right,) * 9),
  stroke: 0.5pt,
  [$x$], [0], [1], [2], [3], [4], [5], [$-1$], [$-2$], [$-3$],
  [$y$], [0], [7], [28], [63], [112], [175], [7], [28], [63],
  [$(d y)/(d x)$], [0], [14], [28], [42], [56], [70], [$-14$], [$-28$], [$-42$],
))

Now plot these values to some convenient scale, and we obtain the two curves, @fig-curve and @fig-derived-curve.

#grid(
  columns: (1fr, 1fr),
  align: bottom,
  [#figure(
    image("../figures/curve.svg"),
    caption: [Graph of $y = 7x^2$.],
  ) <fig-curve>],
  [#figure(
    image("../figures/derived-curve.svg"),
    caption: [Graph of $(d y)/(d x) = 14x$.],
  ) <fig-derived-curve>],
)

Carefully compare the two figures, and verify by inspection that the height of the ordinate of the derived curve, @fig-derived-curve, is proportional to the _slope_ of the original curve, @fig-curve, at the corresponding value of $x$.
To the left of the origin, where the original curve slopes negatively (that is, downward from left to right) the corresponding ordinates of the derived curve are negative.

Now if we look back at #ref(<eq-x-squared>, form: "page"), we shall see that simply differentiating $x^2$ gives us $2x$.
So that the differential coefficient of $7x^2$ is just 7 times as big as that of $x^2$.
If we had taken $8x^2$, the differential coefficient would have come out eight times as great as that of $x^2$.
If we put $y = a x^2$, we shall get
$ (d y)/(d x) = a times 2x. $

If we had begun with $y = a x^n$, we should have had $(d y)/(d x) = a times n x^(n-1)$.
So that any mere multiplication by a constant reappears as a mere multiplication when the thing is differentiated.
And, what is true about multiplication is equally true about _division_: for if, in the example above, we had taken as the constant $1/7$ instead of 7, we should have had the same $1/7$ come out in the result after differentiation.

== Some further examples

The following further examples, fully worked out, will enable you to master completely the process of differentiation as applied to ordinary algebraical expressions, and enable you to work out by yourself the examples given at the end of this chapter.

#example(title: "1")[
  Differentiate $y = x^5/7 - 3/5$.

  $3/5$ is an added constant and vanishes (see #ref(<added-constants>, form: "page")).

  We may then write at once
  $
              (d y)/(d x) & = 1/7 times 5 times x^(5-1), \
    "or" quad (d y)/(d x) & = 5/7 x^4.
  $
]

#example(title: "2")[
  Differentiate $y = a sqrt(x) - 1/2 sqrt(a)$.

  The term $1/2 sqrt(a)$ vanishes, being an added constant; and as $a sqrt(x)$, in the index form, is written $a x^(1/2)$, we have
  $
              (d y)/(d x) & = a times 1/2 times x^(1/2 - 1) = a/2 times x^(-1/2), \
    "or" quad (d y)/(d x) & = a/(2 sqrt(x)).
  $
]

#example(title: "3")[
  If $a y + b x = b y - a x + (x + y) sqrt(a^2 - b^2)$, find the differential coefficient of $y$ with respect to $x$.

  As a rule an expression of this kind will need a little more knowledge than we have acquired so far; it is, however, always worth while to try whether the expression can be put in a simpler form.

  First we must try to bring it into the form $y =$ some expression involving $x$ only.

  The expression may be written
  $ (a - b) y + (a + b) x = (x + y) sqrt(a^2 - b^2). $

  Squaring, we get
  $
    (a - b)^2 y^2 + (a + b)^2 x^2 + 2(a + b)(a - b) x y \
    = (x^2 + y^2 + 2x y)(a^2 - b^2),
  $
  which simplifies to
  $
              (a - b)^2 y^2 + (a + b)^2 x^2 & = x^2 (a^2 - b^2) + y^2 (a^2 - b^2); \
    "or" quad [(a - b)^2 - (a^2 - b^2)] y^2 & = [(a^2 - b^2) - (a + b)^2] x^2, \
               "that is" quad 2b(b - a) y^2 & = -2b(b + a) x^2;
  $
  $ "hence" quad y = sqrt((a + b)/(a - b)) x quad "and" quad (d y)/(d x) = sqrt((a + b)/(a - b)). $
]

#example(title: "4")[
  The volume of a cylinder of radius $r$ and height $h$ is given by the formula $V = pi r^2 h$.
  Find the rate of variation of volume with the radius when $r = 5.5$ in. and $h = 20$ in.
  If $r = h$, find the dimensions of the cylinder so that a change of 1 in. in radius causes a change of 400 cub. in. in the volume.

  The rate of variation of $V$ with regard to $r$ is
  $ (d V)/(d r) = 2 pi r h. $

  If $r = 5.5$ in. and $h = 20$ in. this becomes 690.8.
  It means that a change of radius of 1 inch will cause a change of volume of 690.8 cub. inch.
  This can be easily verified, for the volumes with $r = 5$ and $r = 6$ are 1570 cub. in. and 2260.8 cub. in. respectively, and $2260.8 - 1570 = 690.8$.

  Also, if
  $ r = h, quad (d V)/(d r) = 2 pi r^2 = 400 quad "and" quad r = h = sqrt(400/(2 pi)) = 7.98 "in." $
]

#example(title: "5")[
  The reading $theta$ of a Féry's Radiation pyrometer is related to the Centigrade temperature $t$ of the observed body by the relation
  $ theta/theta_1 = (t/t_1)^4, $
  where $theta_1$ is the reading corresponding to a known temperature $t_1$ of the observed body.

  Compare the sensitiveness of the pyrometer at temperatures 800°~C., 1000°~C., 1200°~C., given that it read 25 when the temperature was 1000°~C.

  The sensitiveness is the rate of variation of the reading with the temperature, that is $(d theta)/(d t)$.
  The formula may be written
  $ theta = theta_1/t_1^4 t^4 = (25 t^4)/1000^4, $
  and we have
  $ (d theta)/(d t) = (100 t^3)/1000^4 = t^3/"10,000,000,000". $

  When $t = 800$, 1000 and 1200, we get $(d theta)/(d t) = 0.0512$, 0.1 and 0.1728 respectively.

  The sensitiveness is approximately doubled from 800° to 1000°, and becomes three-quarters as great again up to 1200°.
]

#exercises[
  #metadata("exercises II") <exercises-ii>
  (See #ref(<answers-ii>, form: "page") for Answers.)

  Differentiate the following:

  + $y = a x^3 + 6$.
  + $y = 13x^(3/2) - c$.
  + $y = 12x^(1/2) + c^(1/2)$.
  + $y = c^(1/2) x^(1/2)$.
  + $u = (a z^n - 1)/c$.
  + $y = 1.18t^2 + 22.4$.

  Make up some other examples for yourself, and try your hand at differentiating them.

  7. If $l_t$ and $l_0$ be the lengths of a rod of iron at the temperatures $t°$~C. and 0°~C. respectively, then $l_t = l_0 (1 + 0.000012t)$.
    Find the change of length of the rod per degree Centigrade.

  8. It has been found that if $c$ be the candle power of an incandescent electric lamp, and $V$ be the voltage, $c = a V^b$, where $a$ and $b$ are constants.

    Find the rate of change of the candle power with the voltage, and calculate the change of candle power per volt at 80, 100 and 120 volts in the case of a lamp for which $a = 0.5 times 10^(-10)$ and $b = 6$.

  9. The frequency $n$ of vibration of a string of diameter $D$, length $L$ and specific gravity $sigma$, stretched with a force $T$, is given by
    $ n = 1/(D L) sqrt((g T)/(pi sigma)). $

    Find the rate of change of the frequency when $D$, $L$, $sigma$ and $T$ are varied singly.

  10. The greatest external pressure $P$ which a tube can support without collapsing is given by
    $ P = ((2E)/(1 - sigma^2)) t^3/D^3, $
    where $E$ and $sigma$ are constants, $t$ is the thickness of the tube and $D$ is its diameter.
    (This formula assumes that $4t$ is small compared to $D$.)

    Compare the rate at which $P$ varies for a small change of thickness and for a small change of diameter taking place separately.

  11. Find, from first principles, the rate at which the following vary with respect to a change in radius:
    #set enum(numbering: "(a)")
    + the circumference of a circle of radius $r$;
    + the area of a circle of radius $r$;
    + the lateral area of a cone of slant dimension $l$;
    + the volume of a cone of radius $r$ and height $h$;
    + the area of a sphere of radius $r$;
    + the volume of a sphere of radius $r$.

  12. The length $L$ of an iron rod at the temperature $T$ being given by $L = l_t [1 + 0.000012 (T - t)]$, where $l_t$ is the length at the temperature $t$, find the rate of variation of the diameter $D$ of an iron tyre suitable for being shrunk on a wheel, when the temperature $T$ varies.
]
