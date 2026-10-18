# Writing style: The Tale of Peter Rabbit

## Audience

Read aloud to children of about three to six by a parent or grandparent, and read alone by children of six to eight.
The grown-up reading it should enjoy it too: the dry jokes are partly for them.

## Voice and tone

- Beatrix Potter's voice: precise, unsentimental, gently ironic.
- The narrator tells disasters in the same calm tone as lunch: "your Father had an accident there; he was put in a pie by Mrs. McGregor."
- Now and then the narrator speaks in the first person, briefly and drily: "so that I think he might have got away altogether", "I am sorry to say that Peter was not very well".
- Danger is real and never softened, but never dwelt on either; Peter's tears get a few words.
- No moral spelled out. The ending does it: camomile tea for Peter, bread and milk and blackberries for the others.

## Point of view and tense

- Third person, past tense, with the occasional first-person aside from the narrator.
- Dialogue is short and in character: old Mrs. Rabbit is brisk and practical, Mr. McGregor shouts.

## Sentences and paragraphs

- A sentence or two per picture; four at most on a busy page, and never more than fits under the picture (about 60 words).
- Long sentences strung together with semicolons and "and" are fine when they move like action: "he rushed all over the garden, for he had forgotten the way back to the gate."
- Pages may start with "And" or "But", so the story runs on from the page before.
- End a page on a small turn or surprise when you can: "and beyond him was the gate!"

## Words and spelling

- British spelling and usage of 1902: towards, amongst, fortnight, got, round (for around).
- Real words children may not know, used exactly: implored, exert, fortnight, camomile, sieve, scuttered. Don't swap them for easier ones; the sound and the picture carry the meaning.
- Compounds hyphenated as Potter wrote them: fir-tree, sand-bank, tool-shed, flower-pot, water-cans, gold-fish, scare-crow, black-currant, rabbit-hole, bed-time, table-spoonful.
- Capitals as in the original: Mother and Father (as names), "four little Rabbits" in the first line.
- Sounds spelled out: Kertyschoo, lippity—lippity, scr-r-ritch, scratch, scratch, scritch.
- Names: Peter, Flopsy, Mopsy, Cotton-tail, old Mrs. Rabbit, Mr. McGregor, Mrs. McGregor, little Benjamin Bunny.

## Formatting in Typst

- One `#story-page(picture: "illustrations/NN-name.jpg")[...]` per page in story.typ, the words indented two spaces inside the brackets.
- One sentence per line; a blank line between paragraphs.
- Dialogue in single quotes, typed straight ('...'): Typst curls them. An em dash is `---`.
- `Mr.~McGregor` and `Mrs.~Rabbit`: the `~` is a space that never breaks, so a title never ends a line. The same for a short cry: `'Stop~thief!'`. A hyphenated sound goes in a box so it never splits: `#box[scr-r-ritch]`.
- A `\` at the end of a sentence where the reader should pause before the next one.
- When a page's words don't fit under its picture, put the first part on a page of its own, `#story-page[...]` with no picture, just before the picture page.
- Notes to yourself as `//` comments.

## Figures

- Potter's own watercolours, one per page, in illustrations/, numbered in story order: 01-frontispiece.jpg on the cover, then 02 onwards.
- Each picture shows the moment its page describes; no picture is used twice.
- They are soft-edged vignettes on white, so they sit above the words, never full-bleed (`#picture-page` would crop them).
- JPEG, at most 1200 px on the longer side; keep the white ground as it is, never crop or recolour.

## Do

- Keep the facts straight: the blue jacket with brass buttons, the two lost shoes, the gate, the big fir-tree.
- Let the picture carry what is obvious; the words add what it can't show: what Peter feels, what Mrs. Rabbit says, the narrator's dry aside.
- Read every page aloud before keeping it.

## Don't

- Don't modernise, shorten or simplify Potter's text: every word of the story is hers.
- No cuteness ("little bunny-wunny"), no rhymes, no morals, no modern words (okay, scary, Mom).
- No exclamation marks for feelings; Potter keeps them for events: "whom should he meet but Mr. McGregor!"
- Don't explain the danger or soften the ending.

## Examples

Sounds right (Potter):

```typ
#story-page(picture: "illustrations/14-sparrows.jpg")[
  Peter gave himself up for lost, and shed big tears; but his sobs were overheard by some friendly sparrows, who flew to him in great excitement, and implored him to exert himself.
]
```

Doesn't (too sweet, too modern, and it explains what the picture already shows):

> Poor little Peter was so scared! He cried and cried and cried. Luckily some kind birdies flew down to help him and told him never to give up!
