#import "../style.typ": *

= On Different Degrees of Smallness

We shall find that in our processes of calculation we have to deal with small quantities of various degrees of smallness.

We shall have also to learn under what circumstances we may consider small quantities to be so minute that we may omit them from consideration.
Everything depends upon relative minuteness.

Before we fix any rules let us think of some familiar cases.
There are 60 minutes in the hour, 24 hours in the day, 7 days in the week.
There are therefore 1440 minutes in the day and 10080 minutes in the week.

Obviously 1 minute is a very small quantity of time compared with a whole week.
Indeed, our forefathers considered it small as compared with an hour, and called it "one minùte," meaning a minute fraction---namely one sixtieth---of an hour.
When they came to require still smaller subdivisions of time, they divided each minute into 60 still smaller parts, which, in Queen Elizabeth's days, they called "second minùtes" (_i.e._ small quantities of the second order of minuteness).
Nowadays we call these small quantities of the second order of smallness "seconds."
But few people know _why_ they are so called.

Now if one minute is so small as compared with a whole day, how much smaller by comparison is one second!

Again, think of a farthing as compared with a sovereign: it is barely worth more than $1/1000$ part.
A farthing more or less is of precious little importance compared with a sovereign: it may certainly be regarded as a _small_ quantity.
But compare a farthing with £1000: relatively to this greater sum, the farthing is of no more importance than $1/1000$ of a farthing would be to a sovereign.
Even a golden sovereign is relatively a negligible quantity in the wealth of a millionaire.

Now if we fix upon any numerical fraction as constituting the proportion which for any purpose we call relatively small, we can easily state other fractions of a higher degree of smallness.
Thus if, for the purpose of time, $1/60$ be called a _small_ fraction, then $1/60$ of $1/60$ (being a _small_ fraction of a _small_ fraction) may be regarded as a _small quantity of the second order_ of smallness.#footnote[
  The mathematicians talk about the second order of "magnitude" (_i.e._ greatness) when they really mean second order of _smallness_.
  This is very confusing to beginners.
] <smallness>

Or, if for any purpose we were to take 1 per cent. (_i.e._ $1/100$) as a _small_ fraction, then 1 per cent. of 1 per cent. (_i.e._ $1/"10,000"$) would be a small fraction of the second order of smallness; and $1/"1,000,000"$ would be a small fraction of the third order of smallness, being 1 per cent. of 1 per cent. of 1 per cent.

Lastly, suppose that for some very precise purpose we should regard $1/"1,000,000"$ as "small."
Thus, if a first-rate chronometer is not to lose or gain more than half a minute in a year, it must keep time with an accuracy of 1 part in 1,051,200.
Now if, for such a purpose, we regard $1/"1,000,000"$ (or one millionth) as a small quantity, then $1/"1,000,000"$ of $1/"1,000,000"$, that is $1/"1,000,000,000,000"$ (or one trillionth) will be a small quantity of the second order of smallness, and may be utterly disregarded, by comparison.

Then we see that the smaller a small quantity itself is, the more negligible does the corresponding small quantity of the second order become.
Hence we know that _in all cases we are justified in neglecting the small quantities of the second---or third_ (or higher)_---orders_, if only we take the small quantity of the first order small enough in itself.

But, it must be remembered, that small quantities if they occur in our expressions as factors multiplied by some other factor, may become important if the other factor is itself large.
Even a farthing becomes important if only it is multiplied by a few hundred.

Now in the calculus we write $d x$ for a little bit of $x$.
These things such as $d x$, and $d u$, and $d y$, are called "differentials," the differential of $x$, or of $u$, or of $y$, as the case may be.
\[You _read_ them as _dee-eks_, or _dee-you_, or _dee-wy_.\]
If $d x$ be a small bit of $x$, and relatively small of itself, it does not follow that such quantities as $x dot d x$, or $x^2 thin d x$, or $a^x thin d x$ are negligible.
But $d x times d x$ would be negligible, being a small quantity of the second order.

A very simple example will serve as illustration.

Let us think of $x$ as a quantity that can grow by a small amount so as to become $x + d x$, where $d x$ is the small increment added by growth.
The square of this is $x^2 + 2x dot d x + (d x)^2$.
The second term is not negligible because it is a first-order quantity; while the third term is of the second order of smallness, being a bit of, a bit of $x^2$.
Thus if we took $d x$ to mean numerically, say, $1/60$ of $x$, then the second term would be $2/60$ of $x^2$, whereas the third term would be $1/3600$ of $x^2$.
This last term is clearly less important than the second.
But if we go further and take $d x$ to mean only $1/1000$ of $x$, then the second term will be $2/1000$ of $x^2$, while the third term will be only $1/"1,000,000"$ of $x^2$.

#figure(
  image("../figures/square.svg"),
  caption: [],
) <fig-square>

Geometrically this may be depicted as follows: Draw a square (@fig-square) the side of which we will take to represent $x$.
Now suppose the square to grow by having a bit $d x$ added to its size each way.
The enlarged square is made up of the original square $x^2$, the two rectangles at the top and on the right, each of which is of area $x dot d x$ (or together $2x dot d x$), and the little square at the top right-hand corner which is $(d x)^2$.
In @fig-growing-square we have taken $d x$ as quite a big fraction of $x$---about $1/5$.
But suppose we had taken it only $1/100$---about the thickness of an inked line drawn with a fine pen.
Then the little corner square will have an area of only $1/"10,000"$ of $x^2$, and be practically invisible.
Clearly $(d x)^2$ is negligible if only we consider the increment $d x$ to be itself small enough.

#grid(
  columns: (1fr, 1fr),
  align: bottom,
  [#figure(image("../figures/growing-square.svg"), caption: []) <fig-growing-square>],
  [#figure(image("../figures/thin-strips.svg"), caption: []) <fig-thin-strips>],
)

Let us consider a simile.

Suppose a millionaire were to say to his secretary: next week I will give you a small fraction of any money that comes in to me.
Suppose that the secretary were to say to his boy: I will give you a small fraction of what I get.
Suppose the fraction in each case to be $1/100$ part.
Now if Mr.~Millionaire received during the next week £1000, the secretary would receive £10 and the boy 2 shillings.
Ten pounds would be a small quantity compared with £1000; but two shillings is a small small quantity indeed, of a very secondary order.
But what would be the disproportion if the fraction, instead of being $1/100$, had been settled at $1/1000$ part?
Then, while Mr.~Millionaire got his £1000, Mr.~Secretary would get only £1, and the boy less than one farthing!

The witty Dean Swift#footnote[_On Poetry: a Rhapsody_ (p. 20), printed 1733---usually misquoted.] once wrote:

#quote(block: true)[
  "So, Nat'ralists observe, a Flea \
  "Hath smaller Fleas that on him prey. \
  "And these have smaller Fleas to bite ’em, \
  "And so proceed _ad infinitum_."
]

An ox might worry about a flea of ordinary size---a small creature of the first order of smallness.
But he would probably not trouble himself about a flea's flea; being of the second order of smallness, it would be negligible.
Even a gross of fleas' fleas would not be of much account to the ox.
