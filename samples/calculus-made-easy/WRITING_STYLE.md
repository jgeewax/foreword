# Writing style: Calculus Made Easy

## Audience

Beginners who are frightened of the calculus: the "fifth-form boys" of Chapter I, and grown-ups who never got past the symbols.
They know school algebra (powers, roots, fractions, the binomial theorem by name) and a little geometry (Euclid, similar triangles).
They don't know what a limit is, and the book never asks them to: a differential is "a little bit of", and small quantities of the second order are thrown away.

## Voice and tone

Thompson's own: friendly, plain-spoken, and mock-solemn.
He is on the reader's side against "the fools who write the textbooks", and he says so: "What one fool can do, another can."
Make fun of long names and pompous mathematicians, never of the reader ("we will simply pronounce a brief curse on the stupidity of giving long crack-jaw names").
Reassure by showing how easy the thing is, then show it: "That's all." "How easy it is!"
Homely comparisons carry the ideas: farthings and sovereigns, a millionaire's secretary and his boy, fleas on fleas, a ladder against a wall.

## Point of view and tense

- "We" while working something out together: "Let us now learn how to go in quest of $(d y)/(d x)$."
- "You" when talking to the reader directly: "But, you will say, we neglected a whole unit."
- "I" only rarely, and self-deprecating: "Being myself a remarkably stupid fellow..."
- Present tense; imperatives for steps ("Try differentiating $y = x^3$ in the same way.").

## Sentences and paragraphs

- Mostly short sentences, with the odd long one that winds through semicolons, as Thompson's do.
- Short paragraphs; a one-line paragraph is fine for a punch line ("Let us consider a simile.").
- Work every case step by step, in words between the equations: "Doing the squaring we get:", "Subtracting the original $y = x^4$, we have left".
- After the algebra, check it with numbers (the "Numerical example" with $x = 100$).
- End a chapter with exercises the reader can now do, and an encouraging line.

## Words and spelling

- British spelling of 1914: _tyre_, _enquire_, _totalling_; "per cent." with a full stop.
- Thompson's terms: _differential coefficient_ (not "derivative"), _differentiating_, _increment_, _small quantity of the second order of smallness_, _constants_ and _variables_.
- Say how a symbol is read when it first appears: _dee-eks_, _dee-wy by dee-eks_.
- Money and measures of the day: £, shillings, farthings; inches, feet, cub. in.; degrees Centigrade.
- _i.e._ and _N.B._ in italics.

## Formatting in Typst

- One sentence per line; a blank line between paragraphs; a blank line above and below every heading.
- `= Title` for a chapter, `==` for a section (numbered by the style); the Prologue and Answers use `#heading(numbering: none)[...]`.
- Run-in subheads in italics at the start of a paragraph: `_Case 1._`, `_Numerical example._`, `_Summary._`.
- Differentials are written `d x`, `d y` (an italic _d_, as the book prints it), never `dif x`; always with a space, since `dx` would be one name.
- Differential coefficients as `(d y)/(d x)`; second ones as `(d^2 y)/(d x^2)`.
- A product with a differential takes a centred dot or a thin space, as Thompson set it: `2x dot d x`, `4x^3 thin d x`, `(d x)^2`.
- Roots with `sqrt(...)` and `root(3, ...)`; fractional powers as `x^(1/2)`; `times` for ×, `therefore` for ∴, `°` typed directly.
- Numbers with thousands commas inside math go in quotes: `$1/"10,000"$`. Plain numbers in prose stay out of math: "3600 little bits".
- Equations are unnumbered (`main.typ` turns numbering off). Show each step as display math, with the connecting words as prose in between; short words such as "and" or "whence" may sit at the left of an aligned line: `"and" quad (d y)/(d x) & = 3x^2.`
- Thompson refers to pages, not numbers: mark the place with a label (or `#metadata(...) <name>`) and write `(see #ref(<name>, form: "page"))`.
- Boxes from the style: `#definition` for a term the reader must learn, `#example(title: "1")[...]` for each worked example, `#key-idea` for a rule worth remembering, `#exercises[...]` at the end of a chapter. Answers go in the Answers chapter, under "Exercises I", "Exercises II", ... with page references both ways.

## Figures

- Plain SVG files in `figures/`, drawn in points (the `width` and `height` in `pt`), so their labels come out at the size of the caption text.
- Lines in dark grey (`#444`); what the figure is about in the accent blue `#1f5fa8` (the strips a square grows by, the little similar triangle, the moved ladder, the curve); the negligible second-order bit in orange `#b35c00`; dashed guide lines in light grey.
- Labels in New Computer Modern, variables in italic, as in the text: _x_, _dx_, _y_.
- Captions as the book has them: just the number (`caption: []`) for a diagram, or a short title for a graph ("Graph of $y = 7x^2$."). Refer to each figure in the text with `@fig-...` before or beside it.

## Do

- Begin with the commonsense meaning, then the symbols.
- Keep small quantities of the first order and throw away the second order, saying so each time.
- Check the general rule against a case you can do by hand.
- Let the reader catch the pattern before you state the rule ("You would expect that differentiating $x^5$ would give $5x^4$").

## Don't

- Don't use limits, epsilons or "it can be shown that".
- Don't swap Thompson's words for modern ones (_derivative_ for _differential coefficient_, _Δx_ for _d x_).
- Don't be clever at the reader's expense, and don't skip the easy steps.
- Don't number equations unless the text refers back to one.

## Examples

> Now in the calculus we write $d x$ for a little bit of $x$.
> These things such as $d x$, and $d u$, and $d y$, are called "differentials," the differential of $x$, or of $u$, or of $y$, as the case may be.
> \[You _read_ them as _dee-eks_, or _dee-you_, or _dee-wy_.\]

And:

> We call the ratio $(d y)/(d x)$ "the _differential coefficient_ of $y$ with respect to $x$."
> It is a solemn scientific name for this very simple thing.
> But we are not going to be frightened by solemn names, when the things themselves are so easy.

Not like this (correct, but cold, and it hides the easy idea behind the hard words):

> The derivative of $f$ at $x$ is defined as the limit of the difference quotient as the increment tends to zero, provided this limit exists.
