# Writing style: {{title}}

<!--
Started from the Friendly textbook template. Every rule is a starting point:
change what doesn't fit your book and delete what you don't need. The Calculus
Made Easy sample (New Book ▸ Samples) has a guide written this way for a real
book.
-->

## Audience

Beginners who find the subject frightening, studying on their own or in a first course.
They know the school mathematics the book builds on (say exactly which) and nothing beyond it.
Explain every new idea the first time it appears, in plain words before symbols.

## Voice and tone

- Friendly and plain-spoken: on the reader's side, and sure that the idea is easier than it looks.
- Reassure by showing how simple the thing is, then do it.
- Homely comparisons carry the ideas (money, ladders, cooking, travel); the precise statement follows.
- Light humour about pompous names and heavy notation, never about the reader.

## Point of view and tense

- "We" while working something out together; "you" when speaking to the reader; "I" rarely.
- Present tense; imperatives for steps: "Now try $y = x^3$ the same way."

## Sentences and paragraphs

- Mostly short sentences; short paragraphs, one idea each.
- Work every case step by step, with words between the equations: "Expanding, we get:", "Subtracting the first line, we have left".
- After the algebra, check it with numbers.
- Each chapter opens with a question the reader would ask, and ends with a summary and exercises.

## Words and spelling

- British or American spelling: pick one and keep to it.
- The same term for the same thing all through the book; give a symbol's spoken name when it first appears.
- Name a thing in everyday words first, then give its technical name.
- Numbers below ten in words in prose; all numbers in figures inside math.

## Formatting in Typst

- One sentence per line; a blank line between paragraphs and around headings.
- `= Chapter`, `== Section`, nothing deeper than `===`.
- Inline math between `$...$`. Each displayed step is its own `$ ... $` block, with the connecting words as prose between them.
- Multi-letter names upright, in quotes, inside math (`"speed"`); Typst's names for symbols (`times`, `dot`, `sqrt(...)`).
- Label what the text refers back to (`<eq-...>`, `<fig-...>`, `<sec-...>`) and refer to it with `@`; number an equation only when the text refers to it.
- The style's boxes for what they're for: `#definition` for a term to learn, `#example` for a worked example, `#key-idea` for a rule worth remembering, `#exercises` at the end of a chapter. Answers go at the back.

## Figures

- Simple diagrams, one idea each, in the book's figure style: thin dark-grey lines, the accent colour only for what the figure is about.
- Labels in the body font, variables in italic as in the text.
- Refer to every figure in the text (`@fig-...`) before it appears; captions are a short title.

## Do

- Begin with the commonsense meaning, then the symbols.
- Let the reader spot the pattern before stating the rule.
- Check every general result against a case worked by hand.
- Show every step a beginner needs.

## Don't

- Don't write "clearly", "obviously", "it is easy to see" or "trivially".
- Don't use a symbol without saying what it means and how it's read.
- Don't use a result before it has been shown.
- Don't be clever at the reader's expense.

## Examples

Sounds right:

> Suppose a ladder leans against a wall, and its foot slides out a little.
> How far does the top come down?
> Not far, you might guess, and you'd be right: let's see exactly how far.

Doesn't:

> It is trivially seen from the Pythagorean identity that the vertical displacement is a second-order quantity in the horizontal displacement.

It hides the easy idea behind hard words, and tells the reader that what they find hard is trivial.
