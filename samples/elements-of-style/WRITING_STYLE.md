# Writing style: The Elements of Style

## Audience

Students in a first college course in composition, and their instructors: Strunk wrote the book for his classes at Cornell.
They write everyday prose and want the few rules they break most often, not the whole field.
They know the names of grammar (clause, participle, antecedent); the book uses them without defining them.

## Voice and tone

Strunk's own: terse, imperative, sure of itself.
State the rule, show it, then give the reason in a sentence or two.
The book follows its own rules, so quote them: "Make definite assertions" (Rule 11); "Omit needless words" (Rule 13).
No hedging and no warm-up.
The only humour is dry understatement: "Sentences violating this rule are often ludicrous."

## Point of view and tense

- Rules in the imperative: "Use the active voice."
- Explanations in the present tense, about "the writer", "the reader" or "the student", with "he" for the writer, as the book has it.
- "You" only in a direct instruction: "If the subject on which you are writing is of slight extent..."
- Summaries of a work in the present tense (Rule 17).

## Sentences and paragraphs

- Short declarative sentences.
  A semicolon joins two closely related clauses; a comma never does (Rule 5).
- One topic to a paragraph, with the topic sentence first (Rules 8 and 9).
- Positive form, active voice, concrete words (Rules 10 to 12), and the emphatic words at the end (Rule 18).
- A sentence that leads into an example may stop short and let the example finish it: "Such punctuation as" (the example) "is indefensible."
- After the examples, say what they show in one short paragraph.
  Don't repeat them.

## Words and spelling

- Spell as the book prints it: mostly American (_colorless_, _favor_, _valor_), with _defence_ and _programme_.
- _to-day_, _to-morrow_ and _co-ordinate_ with a hyphen; _any one_, _some one_ and _every one_ as two words (Chapter VI).
- The possessive of every singular noun with _'s_: _Charles's_, _Burns's_ (Rule 1).
- A comma before the _and_ of a series: _red, white, and blue_ (Rule 2).
- None of the words Chapter V warns against: _case_, _character_, _factor_, _feature_, _interesting_, _nature_, _the fact that_, _very_, _certainly_.
- Chapters are referred to in Roman numerals ("Chapter III"), rules by number ("see under Rule 13").

## Formatting in Typst

- One sentence per line; a blank line between paragraphs and around headings.
- Chapters are `= Title`, and every chapter is numbered, since the text refers to them by number.
  Rules are sections, numbered in their text and running on from chapter to chapter: `== 13. Omit needless words.`
  Nothing deeper than `===`.
- The examples use the helpers in `examples.typ` (never edit `style.typ`):
  - `#example[...]` for sentences shown as examples, one example per paragraph.
  - `#compare([as written], [as revised], ...)` for a faulty sentence and its revision side by side.
    The faulty one is always on the left, so the text can speak of "the left-hand column".
  - `#verse[...]` for lines of verse, with `\` at the end of each line but the last.
  - `#sn[1]` before each sentence of a quoted paragraph that is then analysed sentence by sentence (Rule 9).
  - `#lead-in[...]` around a paragraph that ends in a colon, only where a page break would part it from its example.
- Chapter V is a term list: `/ Word: what to do with it`.
  The full stop after the word comes from the chapter's set rule.
  Further paragraphs and examples are indented two spaces under the entry.
- _Italics_ for words discussed as words, for titles of books and poems, and for foreign words.
  Bold only for a cross-reference to an entry in Chapter V: `See under *But*.`
- Sources are named in the text ("Herbert Spencer, from whose _Philosophy of Style_..."); the book has no citations and no bibliography.

## Figures

None.
The examples are the illustrations, and they are set as text.
Don't add figures, boxed notes or pull quotes.

## Do

- Lead with the example.
- Put the revised sentence next to the faulty one, and keep both short.
- Number a new rule after the last one, and give it its own `==` heading.
- Make every word tell.

## Don't

- Don't explain a rule at greater length than its examples need.
- Don't hedge: _rather_, _somewhat_, _perhaps_, _it may be said that_.
- No exclamation marks, no rhetorical questions, no slang.
- Don't modernise the usage or spelling of Strunk's text.

## Examples

Sounds right (Rule 11, as the book has it):

```typst
== 11. Put statements in positive form.

Make definite assertions.
Avoid tame, colorless, hesitating, non-committal language.
Use the word _not_ as a means of denial or in antithesis, never as a means of evasion.

#compare(
  [He was not very often on time.],
  [He usually came late.],
)
```

Doesn't sound right:

> It is interesting to note that in many cases a certain amount of conciseness can perhaps be a very important factor in the effectiveness of a piece of writing.

It hedges (_perhaps_, _a certain amount_), uses four of the words Chapter V warns against (_interesting_, _cases_, _very_, _factor_), and buries its point in the middle.
Strunk says it in four words: "Vigorous writing is concise."
