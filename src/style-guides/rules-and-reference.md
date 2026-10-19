# Writing style: {{title}}

<!--
Started from the Rules and reference template. Every rule is a starting point:
change what doesn't fit your book and delete what you don't need. The
Elements of Style sample (New Book ▸ Samples) has a guide written this way for
a real book.
-->

## Audience

Readers who want to get something right, and who come back to look things up: students, practitioners, anyone with the book open beside their work.
They know the basic terms of the subject; the book uses them without defining them.

## Voice and tone

- Terse, imperative and sure of itself.
- State the rule, show it, then give the reason in a sentence or two.
- No hedging and no warm-up. The only humour is dry understatement.
- The book follows its own rules: the text is its first example.

## Point of view and tense

- Rules in the imperative: "Put the main point first."
- Explanations in the present tense, about "the writer", "the reader" or "you".

## Sentences and paragraphs

- Short declarative sentences.
- One rule to a section, numbered, under its own heading.
- Lead with the example; after the examples, say in one short paragraph what they show, without repeating them.
- A faulty example sits beside its correction.

## Words and spelling

- British or American spelling: pick one and keep to it.
- One term for each idea, defined where it first matters (or in a glossary).
- Refer to rules by number ("see Rule 13").
- None of the vague words the book warns against: very, interesting, factor, the fact that.

## Formatting in Typst

- One sentence per line; a blank line between paragraphs and around headings.
- `= Chapter`, then `== 13. The rule, in a sentence.`, nothing deeper than `===`.
- Examples set apart in a function of the book's own (an `#example[...]` block, an "as written / as revised" pair side by side), the faulty version always on the left.
- A list of terms as a term list: `/ Term: what to do about it`.
- `_Italics_` for words discussed as words and for titles; bold only for a cross-reference.

## Figures

Usually none: the examples are the illustrations, set as text.
Add a table only where it is the clearest way to compare.

## Do

- Lead with the example.
- Keep examples short and real.
- Number a new rule after the last one.
- Make every word tell.

## Don't

- Don't explain a rule at greater length than its examples need.
- Don't hedge: rather, somewhat, perhaps, it may be said that.
- No exclamation marks, rhetorical questions or slang.

## Examples

Sounds right:

> == 7. Put the main point first.
>
> State the conclusion, then the reasons.
> _For a number of reasons, which we will now consider, the meeting was moved_ becomes _The meeting was moved, for three reasons_.

Doesn't:

> It is perhaps worth noting that in many cases the main point of a paragraph can be quite effectively placed at the beginning.

It hedges (_perhaps_, _in many cases_, _quite_), and keeps its own advice from the reader until the end.
