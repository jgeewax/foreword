# Writing style: Luca's Wonderful Brain

<!--
A worked example of the Picture book style guide template. To start one like it
for your own book: Writing Style Guide Templates… in the command palette, or
Start from a template on the chat's style bar.
-->

## Audience

Read aloud by a grown-up to Luca, his little sister Summer and other young children (about three to seven), one page at a time, with the pictures in front of them.
It is also for the grown-ups around Luca (family, carers, teachers): the book shows them what Luca does and why, in words they can borrow.

## Voice and tone

- Warm, calm and matter-of-fact: the family talking about someone they love.
- Each thing Luca does is described plainly, as it looks, and then explained kindly: "Rubbing his chin helps Luca's body feel calm."
- Never a problem to fix. What Luca does is "one of Luca's ways"; he isn't "being angry or naughty".
- The middle of the book is joy: what Luca loves, said with energy ("Fast, fast, FASTER!", "Up, up, up!").
- It ends on love and belonging: "And our family loves Luca just the way he is."

## Point of view and tense

- The family is the narrator: "This is our family", "Luca says our words back to us".
- Present tense throughout.
- Use names more than "he" and "she", so a young listener always knows who is meant.

## Sentences and paragraphs

- At most about 30 words on a page, and 45 across a spread; most pages have one to three short lines.
- Full, simple sentences, one idea to a page.
- A page that shows something Luca does is followed by a page that says why (chin, then chin-why; sounds, then sounds-why; echo, then echo-why).
- Break lines where the reader takes a breath, not where the box happens to end.
- Capitals now and then for a word read with a big voice: LOVES, FASTER.

## Words and spelling

- Words a four-year-old knows. "Autism" is the one new word, explained the first time it appears: "Autism means Luca's brain works in its own special way."
- The family's names exactly: Luca, Summer, Mommy, Daddy, Grandma, Auntie Alvina.
- American spelling: favorite, color.
- No ages, for anyone.
- No clinical words (disorder, symptom, condition, suffers) and no "special needs".

## Formatting in Typst

- One `#story-page(picture: "illustrations/NN-name.jpg")[...]` per page in story.typ, the words indented two spaces inside the brackets.
- A `\` at the end of each line where the reader should pause; the line breaks are part of the reading.
- `at: top` when the picture's open space is at the top; the default is the bottom. Never let the words cover a face.
- A spread is `#spread(picture: ..., left: words(...)[...], right: words(...)[...])`, and it must start on a left-hand (even) page. Two boxes on one half: put both `words(...)` in braces, `{ ... }`.
- Sound words (rub, tap, yum) are drawn on the picture with `sounds: { sound("rub", x: 17%, y: 20%, angle: -14deg, size: 23pt) ... }`, never in the words. Three of them, growing, the last with "!": "rub", "rub", "rub!".
- Dialogue in plain double quotes ("Want to run!"); Typst curls them.
- Notes to yourself as `//` comments.

## Figures

- Loose, cartoony watercolor with soft hand-inked outlines; a warm, gentle palette with lots of white paper showing; simple, uncluttered backgrounds.
- One picture per page, numbered in story order in illustrations/. Story pages are full-bleed squares; spreads are one picture twice as wide; the title page, the favorites list and The End are vignettes on white.
- Every picture leaves calm, open space (sky, a wall, grass) where its words go.
- On a spread, people stand in the left or right half; only background crosses the middle, where the book folds.
- No writing anywhere in the pictures: words are set in Typst, sound words with `sound(...)`.
- Faces smile with their eyes open. Every person looks the same, and wears the same clothes, on every page.
- The pictures here are made smaller for the sample (1400 px across a page). For print, use 300 pixels per inch with the bleed: 2625 px square for a page and 5175 × 2625 px for a spread.

## Do

- Show the moment, then explain it in the words a sibling could repeat to a friend.
- Keep each "why" short, true and kind.
- Read every page aloud, slowly, before keeping it.

## Don't

- Don't describe what the picture already shows; add what it can't (why, how it feels).
- Don't ask the listener to be patient with Luca; help them understand him.
- Don't put sound words in the text, or more words on a page than a child will sit through.

## Examples

Sounds right (one thing he does, then why):

```typ
#story-page(picture: "illustrations/09-sounds.jpg", at: top)[
  Luca makes big sounds. \
  Sometimes he shouts! \
  Sometimes he says, "Ooooo!"
]

#story-page(picture: "illustrations/10-sounds-why.jpg")[
  Making sounds helps Luca's body feel good. \
  Luca isn't being angry or naughty. \
  That's just how Luca's body works!
]
```

Doesn't (clinical words, a lesson for the listener, and far too long for one page):

> Because of his condition, Luca sometimes has trouble controlling his voice and may shout loudly without warning. When this happens, it is important to stay patient and remember that he can't help it.
