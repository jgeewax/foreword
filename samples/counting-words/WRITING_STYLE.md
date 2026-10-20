# Writing style: Counting Words

<!--
A worked example of the Programming book style guide template. To start one like it
for your own book: Writing Style Guide Templates… in the command palette, or
Start from a template on the chat's style bar.
-->

## Audience

Writers (novelists, journalists, students, bloggers) who have never programmed. They can install an app and save a file, but have never opened a terminal on purpose. They want answers about their own writing (word counts, favourite words, sentence length), not a career in software. Assume nothing: explain every new piece of Python the first time it appears, and only once.

## Voice and tone

- Warm, practical and calm, like a friend at the next desk who happens to program. Never condescending, never breathless.
- Start from a question a writer would ask ("How long are my sentences?"), then answer it with a program.
- Admit when something is fiddly or has no right answer (what counts as a word, where a sentence ends). Treat these as decisions the writer makes, not as failures.
- Gentle humour is fine; no jokes at the reader's expense, and no exclamation marks.

## Point of view and tense

- "You" for the reader and in exercises; "let's" or "we" sparingly, while building a program step by step.
- Present tense: "`split` cuts the string into words", not "will cut".

## Sentences and paragraphs

- Short sentences, one idea each; short paragraphs (two to four sentences).
- Pattern for every new idea: one or two sentences that set up the question, the example, then a short explanation of only the new parts, line by line if needed.
- Explain what the reader can see in the output ("the full stop is still there"), not just what the code does.
- Each chapter opens with a writer's problem and ends with a `#key-idea` and `#exercises`.

## Words and spelling

- British spelling: favourite, analyse, colour, recognise. Python's own names stay as they are.
- "Full stop", not "period"; "quotation marks", not "quotes" (except "single/double quotation marks"); "lower case" (noun), "lower-case" (adjective).
- Python terms in plain words first, then the term: "a list: the pieces, in order, between square brackets".
- Program names, functions, variables and values in backticks: `split`, `len`, `long_words`, `True`. Call a function by its name without parentheses in prose (`print`, not `print()`).
- Book titles in italics: _Pride and Prejudice_.

## Formatting in Typst

- One sentence per line; a blank line between paragraphs.
- Chapters `= Title` in title case; sections `== Like this` in sentence case; no `===`.
- Every example is `#run("name", ```python … ```, expect: "…")`, with a lower-case, hyphenated name that says what it does (`count-long-words`). Names are unique across the book; exercises refer to examples by name.
- Add `expect:` whenever the output is fixed and short enough to type (up to about ten lines). Write line breaks as `\n`. The expected text must not contain a `)`: Foreword stops reading the arguments at the first one. Long listings and charts (`split-sentences`, `rhythm`) have no `expect:`.
- New terms in `#definition("Term")[…]` the first time they matter (String, Variable, List, Dictionary), and in _italics_ in the sentence that introduces them.
- Use `~` between "Mr." or "Mrs." and the name in prose, so the line can't break there.
- Escape Typst's special characters in prose, or put them in backticks: `#`, `*`, `_`, `@`, `<`, `>`.

## Figures

- No images. Charts are drawn by the programs themselves, with `#` characters, so the reader can make the same chart from their own text.
- Code and output lines at most about 70 characters, so nothing wraps on the 7.5 × 9.25 in page. Break long text over lines inside triple quotation marks.

## Do

- Python 3.9 or later, standard library only (`collections`, `math`). Every example runs on its own: repeat the imports and the file reading rather than relying on an earlier example.
- f-strings for any output that mixes words and values: `print(f"{count} long words")`. Use `{count:3}` to line up columns and `{average:.1f}` for one decimal place.
- Clear, whole-word names in `snake_case`: `long_words`, `stop_words`, `sentence`, not `lw` or `s`.
- Read files with `with open("texts/….txt", encoding="utf-8") as file:`. Texts live in `texts/`; the book's folder is the working directory.
- Use public-domain text (the opening of _Pride and Prejudice_ in `texts/opening.txt`) or short drafts written for the book; quote Austen exactly.
- Build from loops the reader already knows before showing the shortcut (`Counter` after the counting loop).

## Don't

- No classes, no `lambda`, no list comprehensions, no regular expressions, no third-party packages. Functions (`def`) aren't introduced yet either.
- No f-strings with quotation marks inside the braces; give the value a name first.
- Don't change an example's code without running it again, and don't type an output by hand.
- No jargon without explanation ("iterate", "mutable", "argument"); say what happens instead.
- Don't tell the reader that something is simple, easy or obvious.

## Examples

Sounds right:

> `strip` removes the characters you give it from the start and the end of a string, as many as it finds there.
> The string `'.,;:!?"'` lists the punctuation to remove.
> It's written between single quotation marks because it contains a double one.

Doesn't sound right (jargon, no reason given, talks down): "Simply call the `str.strip()` method with the punctuation characters as an argument to sanitise each token."
