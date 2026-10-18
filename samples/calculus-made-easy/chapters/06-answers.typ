#import "../style.typ": *

#heading(numbering: none)[Answers]

#heading(level: 2, numbering: none)[Exercises I] <answers-i>

(#ref(<exercises-i>, form: "page").)

#grid(
  columns: (1fr, 1fr),
  row-gutter: 1.2em,
  [(1) $(d y)/(d x) = 13x^12$.], [(2) $(d y)/(d x) = -3/2 x^(-5/2)$.],
  [(3) $(d y)/(d x) = 2a x^((2a - 1))$.], [(4) $(d u)/(d t) = 2.4t^(1.4)$.],
  [(5) $(d z)/(d u) = 1/3 u^(-2/3)$.], [(6) $(d y)/(d x) = -5/3 x^(-8/3)$.],
  [(7) $(d u)/(d x) = -8/5 x^(-13/5)$.], [(8) $(d y)/(d x) = 2a x^(a - 1)$.],
  [(9) $(d y)/(d x) = 3/q x^((3 - q)/q)$.], [(10) $(d y)/(d x) = -m/n x^(-(m + n)/n)$.],
)

#heading(level: 2, numbering: none)[Exercises II] <answers-ii>

(#ref(<exercises-ii>, form: "page").)

#grid(
  columns: (1fr, 1fr),
  row-gutter: 1.2em,
  [(1) $(d y)/(d x) = 3a x^2$.], [(2) $(d y)/(d x) = 13 times 3/2 x^(1/2)$.],
  [(3) $(d y)/(d x) = 6x^(-1/2)$.], [(4) $(d y)/(d x) = 1/2 c^(1/2) x^(-1/2)$.],
  [(5) $(d u)/(d z) = (a n)/c z^(n - 1)$.], [(6) $(d y)/(d t) = 2.36t$.],
  grid.cell(colspan: 2)[(7) $(d l_t)/(d t) = 0.000012 times l_0$.],
  grid.cell(colspan: 2)[
    (8) $(d C)/(d V) = a b V^(b - 1)$, 0.98, 3.00 and 7.47 candle power per volt respectively.
  ],
  grid.cell(colspan: 2, breakable: false)[
    (9)
    $
          (d n)/(d D) & = -1/(L D^2) sqrt((g T)/(pi sigma)), quad   & (d n)/(d L) & = -1/(D L^2) sqrt((g T)/(pi sigma)), \
      (d n)/(d sigma) & = -1/(2 D L) sqrt((g T)/(pi sigma^3)), quad & (d n)/(d T) & = 1/(2 D L) sqrt(g/(pi sigma T)).
    $
  ],
  grid.cell(colspan: 2, breakable: false)[
    (10)
    $ ("Rate of change of" P "when" t "varies")/("Rate of change of" P "when" D "varies") = -D/t. $
  ],
  grid.cell(colspan: 2)[(11) $2 pi$, $2 pi r$, $pi l$, $2/3 pi r h$, $8 pi r$, $4 pi r^2$.],
  grid.cell(colspan: 2)[(12) $(d D)/(d T) = (0.000012 l_t)/pi$.],
)
