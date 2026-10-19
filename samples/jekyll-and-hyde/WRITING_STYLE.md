# Writing style: Strange Case of Dr Jekyll and Mr Hyde

<!--
A worked example of the Classic fiction style guide template. To start one like it
for your own book: Writing Style Guide Templates… in the command palette, or
Start from a template on the chat's style bar.
-->

## Audience

Readers of a new edition of Stevenson's 1886 novella: adults who read classic fiction and expect it to sound as it did when it was first published. Anything new (a restored passage, a bridging paragraph, a letter or document inside the story) must read as Stevenson's own; nothing may sound modern.

## Voice and tone

- Grave and restrained, with a dry irony at the edges. Horror comes by understatement and suggestion: Hyde's deeds are reported, never dwelt on ("Into the details of the infamy at which I thus connived ... I have no design of entering").
- Chapters 1–8: a measured narrator who reports what Mr. Utterson sees, hears and thinks, with the occasional wry aside ("If he be Mr. Hyde," he had thought, "I shall be Mr. Seek.").
- Chapter 9: Dr. Lanyon writes as a physician, clinical and exact; his composure breaks only at the end.
- Chapter 10: Jekyll's confession is elaborate, self-examining and moral in its vocabulary (conscience, penitence, the "polar twins"), rising to anguish.
- Speech fits the speaker. Utterson, Jekyll and Lanyon talk as educated professional men; Poole and the inspector use servants' and policemen's idiom ("He don't seem a very popular character"; "master's made away with"; "main angry").

## Point of view and tense

- Chapters 1–8: third person, past tense, close to Utterson. The reader learns only what he learns.
- Chapter 9: first person, past tense; Lanyon's letter to Utterson, signed at the end.
- Chapter 10: first person, Henry Jekyll; past tense for his history, present tense in the closing pages as he writes ("About a week has passed, and I am now finishing this statement").
- Letters, notes and wills are in their writer's own voice, with his date and signature.

## Sentences and paragraphs

- Long, balanced sentences built on semicolons and colons, set against short, flat ones: "The cheque was genuine."
- Lists of adjectives and clauses in twos and threes: "lean, long, dusty, dreary and yet somehow lovable".
- Narrative paragraphs run long (five to ten sentences). Each speaker gets a new paragraph.
- Dialogue tags are often inverted and placed mid-speech: "It is connected in my mind," added he, "with a very odd story." Use said, returned, replied, cried, observed, inquired.
- A run of questions may continue in lower case: "Will you be wise? will you be guided?"
- Exclamation marks belong to dialogue and to Jekyll's statement; the narrated chapters almost never use them.

## Words and spelling

- British spelling, as in the text: colour, honour, neighbourhood, recognise, grey, storey, cheque, sombre, mouldings.
- Period forms the text uses: to-day, to-night, to-morrow, good-night, burthen, whilst, awhile, presently, ay; "O" rather than "Oh" ("O God!", "O, dear no, sir").
- Titles keep their full stop: Mr., Dr., Messrs. Jekyll's degrees are "M.D., D.C.L., L.L.D., F.R.S." as written.
- Period words for things: hansom, cabinet (Jekyll's private room), theatre (the old dissecting room), press (a cupboard), phial, draught.
- Names: Mr. Utterson or the lawyer; Mr. Enfield or Richard; Dr. Jekyll, Henry Jekyll, or Harry to his old friends; Mr. Hyde or Edward Hyde; Poole or the butler; Dr. Lanyon; Mr. Guest, the clerk; Sir Danvers Carew; Inspector Newcomen.
- Years are left blank with a dash: "18—" (typed `18---`).
- Oaths stay mild and of the period: "damned", "devilish", "Good God!".

## Formatting in Typst

- One chapter per file in chapters/, starting with `= Title` in title case; no headings inside chapters. A `~` in a long title keeps two words together when it breaks over two lines.
- One sentence per line; a blank line between paragraphs. A quotation that goes on after a full stop still gets a new line for the next sentence.
- Dialogue in plain double quotes, quotations inside them in single quotes; Typst curls them. Em dashes as `---`, with no spaces: `street after street---all lighted up`.
- `_Italics_` for emphasis and for foreign words: `_protégé_`, `_à propos_`, `_pede claudo_`.
- A letter or note given in full goes in `#quote(block: true)[...]`, without quotation marks. The date and the closing are right-aligned with `#align(right)[...]`, a `\` between the closing's lines, and a full signature in `#smallcaps[...]`.
- A first-person narrative ends with its writer's signature: `#align(right)[#smallcaps[Hastie Lanyon.]]`.

## Figures

None. The book has no illustrations, maps or tables; don't add any.

## Do

- Keep the mystery closed until Lanyon's and Jekyll's narratives: Utterson sees only surfaces.
- Set scenes in London weather and light: fog, lamps, wind, the moon, empty streets at night.
- Show character through action and speech, and through the narrator's restrained judgement.
- Describe Hyde through the effect he has on others, never through exact features.

## Don't

- No modern words or idioms ("okay", "creepy", "split personality", "trauma"), and no modern explanations of the science.
- No graphic violence beyond what the text has; no sentiment or melodrama in the narrator's voice.
- Don't tell the reader what to feel.
- Don't modernise the spelling, punctuation or dialogue of the existing text.

## Examples

Sounds right (Chapter 1, as it is typed):

```typst
It chanced on one of these rambles that their way led them down a by-street in a busy quarter of London.
The street was small and what is called quiet, but it drove a thriving trade on the weekdays.
```

Doesn't:

```typst
Utterson had a bad feeling about the creepy old door. Something was definitely off, and he was going to get to the bottom of it!
```

Modern idiom, an exclamation in the narration, two sentences on one line, and a narrator who announces the feeling; Stevenson shows the door's "prolonged and sordid negligence" and lets Utterson's unease come out in what he asks.
