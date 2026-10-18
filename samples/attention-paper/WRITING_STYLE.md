# Writing style: Attention Is All You Need

## Audience

Machine-learning researchers and graduate students. They know neural networks, softmax, backpropagation, BLEU and the encoder–decoder idea, and many know recurrent translation models. Don't explain the basics, but define every symbol where it first appears.

This paper is a restatement, written for Typst Studio, of Vaswani et al., "Attention Is All You Need" (NIPS 2017, arxiv.org/abs/1706.03762). Everything added must be in new words, and every number must be one the original reports.

## Voice and tone

- Precise, compact and neutral, like a good conference paper.
- Back each claim with a number, an equation, a table or a citation.
- No hype ("novel", "groundbreaking", "remarkable", "dramatically") and no stacked hedges ("may possibly suggest").

## Point of view and tense

- No "we" or "our": this is not the original authors' text. Make the model the subject ("the Transformer", "the base model", "a big model"). When a choice, hypothesis or plan was the authors', say "the authors".
- Present tense for what the model is and what the tables show ("the big model scores 28.4 BLEU"). Past tense for what was done ("was trained for 100,000 steps").

## Sentences and paragraphs

- One idea per sentence; paragraphs of three to six sentences.
- Put the result first and the condition after: "Shrinking the key size $d_k$ (rows B) costs up to 0.7 BLEU."
- Give numbers rather than adjectives: "0.9 BLEU below the best setting", not "much worse".
- With a result, say where it was measured: test (newstest2014) or development set (newstest2013), checkpoint averaging, beam size.

## Words and spelling

- American spelling: modeling, normalization, regularization, neighborhood.
- Terms: Transformer (capital T), self-attention, multi-head attention, scaled dot-product attention, encoder–decoder, sub-layer, position-wise feed-forward network, byte-pair encoding, word-piece, base model and big model, perplexity (PPL), BLEU, F1.
- Translation direction: "English-to-German". Language pair or data: "English–German". "EN-DE" and "EN-FR" only in table headers.
- Numbers: 4.5 million, 36 million, 25,000 tokens, 100,000 steps; "40K" and "17M" only for the parsing corpora and in tables, as in the paper.

## Formatting in Typst

- One sentence per line; a blank line between paragraphs and above and below every heading.
- Sections `=`, subsections `==`, no deeper than `===`; the template numbers them. Run-in headings with the package's `#paragraph[Encoder]`.
- Labels: `<sec-…>`, `<eq-…>`, `<fig-…>`, `<tab-…>`. Refer with `@sec-model` ("Section 3"), `@tab-mt` ("Table 2"), `@fig-attention` ("Figure 2") and `@eq-attention`, which prints "(1)".
- Notation: matrices as capital italics ($Q$, $K$, $V$, $W_i^Q$), vectors and scalars as lower case. Named functions and multi-letter names upright, in quotes: `"softmax"`, `"Attention"`, `"MultiHead"`, `"LayerNorm"`, `"FFN"`, `"PE"`, `"pos"`, `$d_"model"$`, `$d_"ff"$`, `$P_"drop"$`, `$epsilon_"ls"$`. Transpose is `^top`. No space after a quoted name before `\/` (`"pos"\/10000`), or Typst keeps it.
- Display equations are numbered and labelled, end with their punctuation inside the `$ … $`, and every symbol is defined in the sentence that introduces them. Wrap a short inline formula that must not break across lines in `#box(...)`.
- Cite with `@key` from `refs.bib`, before the full stop. Separate several keys with spaces (`@wu2016google @bahdanau2014neural`). The style is numeric, so name authors in the text when they are the subject: "Britz et al. @britz2017massive found …".
- Tables: booktabs rules only, no vertical lines. Write them as `table.hline(stroke: 0.08em)` at the top and bottom and `table.hline(stroke: 0.05em)` between groups, so that formatting keeps one row per line. Caption above (the template places it), with numeric columns centered.
- Credit reported numbers in the caption: "From @vaswani2017attention[Table 2]."
- Figures and tables float to the top (`placement: top`). Put a float after the first paragraph of its section, never straight under a heading.

## Figures

- Diagrams are drawn in CeTZ in `figures.typ`, with its helpers (`node`, `stacked`, `arrow`) and palette: light blue for attention, light green for feed-forward, white for Add & norm, sand for embeddings, grey for linear maps, rose for the output softmax. Lines are 0.6pt dark grey; labels are 8pt in the body font.
- Captions say what the figure shows, then where it was drawn from: "Drawn for this sample after Figure 1 of @vaswani2017attention."
- Refer to every figure and table in the text.

## Do

- Restate in new words, keeping the paper's structure, equations and numbers.
- Define notation at first use, and reuse the same symbols throughout.
- Check every number against the original's tables before adding it.

## Don't

- Copy or closely paraphrase sentences from the original paper.
- Write as if you were the original authors ("we propose", "our model").
- Round, adjust or add results the paper doesn't report.
- Use bold in running text, exclamation marks or rhetorical questions.

## Examples

Good: "Shrinking the key size $d_k$ (rows B) costs up to 0.7 BLEU, a hint that scoring compatibility is harder than a dot product makes it look."

Not: "We show that our novel architecture dramatically outperforms everything." (First person, hype, and no number.)
