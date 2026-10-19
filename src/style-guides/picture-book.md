# Writing style: {{title}}

<!--
Started from the Picture book template. Every rule is a starting point:
change what doesn't fit your book and delete what you don't need. The Luca's
Wonderful Brain sample (New Book ▸ Samples) has a guide written this way for
a real book.
-->

## Audience

Young children, roughly three to seven, listening while a grown-up reads aloud and turns the pages.
The child looks at the picture while the words are read, so every page is heard, not read.
The grown-up is a reader too: they should enjoy saying the words, again and again.

## Voice and tone

- Warm, simple and steady; lively where the story is having fun.
- Plain statements of what happens, then a gentle reason when a child would ask why.
- Finish somewhere safe: a hug, a laugh, bedtime, home.

## Point of view and tense

- Present tense from start to finish.
- Choose one narrator (a character, a family, or a storyteller's voice) and keep it.
- Prefer a character's name to "he" or "she": small listeners lose track of who is who.

## Sentences and paragraphs

- Keep a page short: thirty words at the very most (forty-five over a spread), and usually one to three lines.
- One thing happens on each page, told in whole, simple sentences.
- End a line where the voice would naturally rest.
- Give the child something to join in with: a refrain, a question that comes back, a word repeated and growing.
- An occasional word in capitals, for the reader to say loudly.

## Words and spelling

- Everyday words a four-year-old already uses. A new word is explained on the page that introduces it.
- Characters' names spelt exactly the same every time.
- British or American spelling: pick one and keep to it.
- Leave out words that frighten or label, unless the story is about them.

## Formatting in Typst

- Each page is a `#story-page(...)` in the order the story is read, with its picture from `illustrations/` (named `NN-what-it-shows.jpg`) and its words inside the square brackets.
- Put `\` where the reader should pause: those breaks are part of how the page sounds.
- Use `at: top` for a picture whose quiet area is at the top (words go at the bottom otherwise), and keep words off faces.
- A two-page picture uses `#spread(...)`, beginning on a left-hand page.
- Noises (a splash, a knock) are drawn onto the picture with `sound(...)`, not written in the text.
- Notes for yourself go in `//` comments.

## Figures

- One illustration for every page, numbered in reading order.
- Each illustration keeps a quiet patch, such as plain sky or an empty floor, for the words.
- On a two-page picture, keep people away from the middle, where the pages are bound.
- Letters and words are never painted into a picture; Typst sets them.
- A character keeps the same face, colours and clothes from the first page to the last.
- Print needs 300 pixels for every inch of the page, including the bleed.

## Do

- Say each page out loud, at reading pace, before you settle on it.
- Let the picture do the showing; let the words add what a picture can't (a reason, a feeling, a voice).
- Make the listener want to see the next page.

## Don't

- Don't tell the child what the picture already shows them.
- Don't preach, or end on a lesson spelled out.
- Don't give a page more words than a small child will sit still for.

## Examples

Sounds right:

```typ
#story-page(picture: "illustrations/05-puddle.jpg")[
  Mia sees a puddle. \
  A big one. \
  A GIANT one!
]
```

Doesn't (far too many words for one page, and they describe what the picture shows):

> On a rainy afternoon, Mia, who was wearing her yellow raincoat and her red boots, walked down the street and noticed a very large puddle in front of the bakery, so she decided to jump into it.
