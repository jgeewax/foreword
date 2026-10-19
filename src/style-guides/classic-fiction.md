# Writing style: {{title}}

<!--
Started from the Classic fiction template. Every rule is a starting point:
change what doesn't fit your book and delete what you don't need. The Strange
Case of Dr Jekyll and Mr Hyde sample (New Book ▸ Samples) has a guide written
this way for a real book.
-->

## Audience

Adult readers of literary fiction who read slowly and like a book that trusts them.
They don't need anything explained twice, and they notice when a word belongs to the wrong century.

## Voice and tone

- One narrating voice for the whole book: measured, observant, a little ironic at the edges.
- Understatement over emphasis: show what a character does and let the reader feel it. The narrator seldom names an emotion.
- Each character speaks in their own idiom, fitted to their age, class and trade; the narrator never borrows it.
- Keep the period: every word, object and idea belongs to the time of the story.

## Point of view and tense

- Third person, past tense, close to one viewpoint character at a time: the reader learns only what that character sees, hears and thinks.
- Don't change viewpoint inside a scene.
- Letters, diaries and documents inside the story are in their writer's own first person, with a date and a signature.

## Sentences and paragraphs

- Vary the length: long, balanced sentences joined with semicolons and colons, set against short, flat ones for weight.
- Narrative paragraphs may run long; each speaker gets a new paragraph.
- Plain dialogue tags (said, asked, replied), placed mid-speech where the rhythm wants a pause.
- Exclamation marks only in dialogue.

## Words and spelling

- British spelling (colour, grey, realise), or the spelling of the book's period, and the same all through.
- No modern idiom or slang: "okay", "awesome", "reach out".
- Titles keep their full stop: Mr., Mrs., Dr.
- Numbers in words, except dates and addresses.

## Formatting in Typst

- One chapter per file, starting with `= Title`; no headings inside a chapter.
- One sentence per line; a blank line between paragraphs.
- Dialogue in plain double quotes, quotations inside them in single quotes: Typst curls them.
- Em dashes as `---`, with no spaces; an ellipsis as `...`.
- `_Italics_` for emphasis, foreign words, and the titles of books and ships.
- A letter or document given in full goes in `#quote(block: true)[...]`, with its date and signature right-aligned in `#align(right)[...]`.
- A scene break inside a chapter: `#align(center)[\*]` on a line of its own.

## Figures

None: a novel's pictures are in its words.
Don't add maps, tables or images unless the author asks for them.

## Do

- Open a scene in a place, with its light and weather, before the people speak.
- Let characters show themselves in what they do and say.
- Keep each secret until the story is ready to tell it.

## Don't

- Don't tell the reader what to feel, or explain what a scene has already shown.
- No modern words, ideas or explanations in the narration.
- No melodrama, and no adverbs on dialogue tags ("she said angrily").
- Don't modernise text the author has already written.

## Examples

Sounds right:

> The lamps were lit early that evening, for the fog had come up from the river and lay along the street like a sleeping animal.
> Mr. Hale walked the length of it twice before he knocked; and when the door was opened, he found he had nothing ready to say.

Doesn't:

> Hale was super nervous about the meeting. He had a really bad feeling about it, and he didn't know what to say!

Modern words, a feeling named instead of shown, and an exclamation in the narration.
