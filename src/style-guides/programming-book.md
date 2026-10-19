# Writing style: {{title}}

<!--
Started from the Programming book template. Every rule is a starting point:
change what doesn't fit your book and delete what you don't need. The
Counting Words sample (New Book ▸ Samples) has a guide written this way for a
real book.
-->

## Audience

Readers learning to program through this book.
Say exactly what they already know (for example: they can install an app and save a file, and have never used a terminal).
Explain every new piece of the language the first time it appears, and only once.

## Voice and tone

- Warm, practical and calm, like a colleague at the next desk. Never condescending, never breathless.
- Start from a question the reader would ask, then answer it with a program.
- Say plainly when something is fiddly or has no single right answer.

## Point of view and tense

- "You" for the reader; "let's" or "we" while building a program step by step.
- Present tense: "`split` cuts the string into words", not "will cut".

## Sentences and paragraphs

- Short sentences; short paragraphs of two to four sentences.
- For every new idea: a sentence or two to set up the question, the example, then an explanation of only the new parts.
- Explain what the reader can see in the output, not just what the code does.
- Each chapter ends with a key idea and exercises.

## Words and spelling

- British or American spelling: pick one and keep to it. The language's own names stay as they are.
- A term in plain words first, then its name: "a list: the pieces, in order, between square brackets".
- Code, names and values in backticks in prose; a function by its name, without parentheses (`print`, not `print()`).

## Formatting in Typst

- One sentence per line; a blank line between paragraphs.
- Chapters `= Title`, sections `== Like this`, nothing deeper than `===`.
- Every example runs: `#run("name", ```python ... ```, expect: "...")`, with a unique, lower-case, hyphenated name that says what it does. Add `expect:` whenever the output is fixed and short.
- A new term in the style's `#definition` box the first time it matters.
- Code and output lines at most about 70 characters, so nothing wraps on the page.

## Figures

- Prefer output the programs make (a table, a chart drawn in text) to pictures, so readers can make the same from their own data.
- A diagram only where words and code can't show it, in the book's figure style.

## Do

- Every example runs on its own: repeat its imports and setup rather than relying on an earlier one.
- Clear, whole-word names: `word_counts`, not `wc`.
- Build from what the reader knows before showing the shortcut.
- The standard library first; a package only when the chapter is about it.

## Don't

- Don't change an example's code without running it again, and never type an output by hand.
- Don't use a feature before it has been introduced.
- Don't tell the reader that something is simple, easy or obvious.
- No jargon without explanation ("iterate", "mutable"): say what happens instead.

## Examples

Sounds right:

> `lower` gives back a copy of the string with every capital letter made small.
> That way "The" and "the" count as the same word.

Doesn't (jargon, no reason given, and it talks down):

> Simply call `str.lower()` to normalise the casing of each token before aggregation.
