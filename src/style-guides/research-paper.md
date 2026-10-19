# Writing style: {{title}}

<!--
Started from the Research paper template. Every rule is a starting point:
change what doesn't fit your paper and delete what you don't need. The
Attention Is All You Need sample (New Book ▸ Samples) has a guide written
this way for a real paper.
-->

## Audience

Researchers and graduate students in the field.
They know its basics and its standard methods: don't explain those, but define every symbol and abbreviation where it first appears.

## Voice and tone

- Precise, compact and neutral.
- Back every claim with a number, an equation, a table, a figure or a citation.
- No hype ("novel", "groundbreaking", "remarkable") and no stacked hedges ("may possibly suggest").

## Point of view and tense

- "We" for the authors' own choices and work.
- Present tense for what the method is and what the tables show; past tense for what was done in the experiments.

## Sentences and paragraphs

- One idea per sentence; paragraphs of three to six sentences, each opening with its point.
- The result first, the condition after: "Halving the learning rate costs 0.4 points on the test set."
- Numbers rather than adjectives, each with where it was measured.

## Words and spelling

- American spelling, unless the venue asks otherwise.
- One name for each method, model and dataset, used the same way throughout; define each abbreviation once.
- Numbers in figures for all measurements; a space before a unit (12 GB, 3.5 h).

## Formatting in Typst

- One sentence per line; a blank line between paragraphs and around headings.
- Sections `=`, subsections `==`, nothing deeper than `===`; the template numbers them.
- Labels `<sec-...>`, `<eq-...>`, `<fig-...>`, `<tab-...>`; refer with `@` ("Section 3", "Table 2").
- Display equations are numbered and labelled, with their punctuation inside the `$ ... $`, and every symbol is defined in the sentence that introduces them.
- Named functions and multi-letter names upright, in quotes: `"softmax"`, `d_"model"`.
- Cite with `@key` from the bibliography, before the full stop; separate several keys with spaces.
- Tables with horizontal rules only, numbers aligned, the caption above.
- Floats at the top of the page, placed after the first paragraph of their section, never straight under a heading.

## Figures

- Diagrams drawn in code (CeTZ), with one palette and one line width, and labels in the body font.
- Plots with labelled axes and units; no title inside the plot (the caption says it).
- A caption says what the figure shows, and what to notice.
- Refer to every figure and table in the text.

## Do

- Define notation at first use, and use the same symbols throughout.
- Report the setting with every result: data split, metric, seeds or averages.
- Compare with the strongest baseline, fairly.

## Don't

- No bold in running text, no exclamation marks, no rhetorical questions.
- Don't round, adjust or leave out results.
- Don't claim more than the experiments show.

## Examples

Sounds right: "Removing the residual connections (row C) lowers accuracy by 2.1 points on the development set, so every later model keeps them."

Doesn't: "Our novel architecture dramatically outperforms all previous approaches." (Hype, and no number.)
