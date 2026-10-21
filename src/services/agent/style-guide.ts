// The book's writing style guide: WRITING_STYLE.md in the project root. Its
// text is added to every agent session (instruction entry `writing-style`) and
// refreshed when the file changes, so the agent always writes to it.

export const STYLE_GUIDE_FILE = 'WRITING_STYLE.md';
export const STYLE_INSTRUCTIONS_KEY = 'writing-style';
/** Long guides are cut here so they can't crowd out the conversation. */
export const STYLE_GUIDE_MAX_CHARS = 16000;

export function styleInstructions(guide: string): string {
  const text = guide.trim();
  const cut = text.length > STYLE_GUIDE_MAX_CHARS;
  return `# The author's writing style guide (${STYLE_GUIDE_FILE})

Everything you write or revise in this book must follow this guide: voice, tone, point of view, tense, terminology, spelling, and formatting. If a request conflicts with the guide, follow the request but point out the conflict in one sentence. If the guide is silent on something, match the existing chapters.

<style-guide>
${cut ? text.slice(0, STYLE_GUIDE_MAX_CHARS) + '\n…(the rest of the guide was cut for length; read the file for the full text)' : text}
</style-guide>`;
}

export const STYLE_SECTIONS = [
  'Audience',
  'Voice and tone',
  'Point of view and tense',
  'Sentences and paragraphs',
  'Words and spelling',
  'Formatting in Typst',
  'Figures',
  'Do',
  "Don't",
  'Examples',
] as const;
export type StyleSection = (typeof STYLE_SECTIONS)[number];

const DEFAULT_HINTS: Record<StyleSection, string> = {
  Audience: 'Who reads this book, and what do they already know?',
  'Voice and tone': 'e.g. warm and direct; dry humour is fine; never condescending.',
  'Point of view and tense': 'e.g. second person ("you"), present tense; first person plural in proofs.',
  'Sentences and paragraphs': 'e.g. prefer short sentences; one idea per paragraph; no rhetorical questions.',
  'Words and spelling': 'Preferred terms, words to avoid, British or American spelling, capitalisation.',
  'Formatting in Typst': `How the book uses Typst markup, e.g.:
- One sentence per line; a blank line between paragraphs.
- Chapter headings: \`= Title <ch-label>\`; sections \`==\`, no deeper than \`===\`.
- Emphasis with \`_..._\`, never bold in running text.
- Every displayed equation gets a label: \`$ ... $ <eq-name>\`.
- Cite with \`@key\`; every figure has a caption.`,
  Figures: `How figures look and read, e.g.:
- Diagrams in CeTZ, drawn with the wrappers in figures/figure-style.typ (one palette, one line width).
- The accent colour only for what the figure is about.
- Captions: one sentence, ending with a full stop; the text refers to each figure before it appears.`,
  Do: 'Things you always want.',
  "Don't": 'Things to avoid, e.g. clichés, filler phrases, exclamation marks.',
  Examples: "A short passage that sounds right, and optionally one that doesn't (and why).",
};

/**
 * Starting point for a guide; each section explains what to write. `hints`
 * replaces a section's prompt (book templates use this for their genre).
 */
export function styleGuideTemplate(projectName: string, hints: Partial<Record<StyleSection, string>> = {}): string {
  const sections = STYLE_SECTIONS.map((h) => `## ${h}\n<!-- ${hints[h] ?? DEFAULT_HINTS[h]} -->`);
  return `# Writing style: ${projectName}

<!--
This file tells the writing assistant how this book should read. Replace the
prompts under each heading with your own notes. Short, concrete rules work
best, especially with an example. Delete sections you don't need.
-->

${sections.join('\n\n')}
`;
}

/**
 * "Draft from my chapters": the author sees only this message in the chat;
 * how to do it goes with it as instructions (STYLE_DRAFT_KEY), out of sight.
 */
export const STYLE_DRAFT_MESSAGE = 'Draft my writing style guide from the chapters.';
/** "Redraft…" when the guide isn't quite right. */
export const STYLE_REDRAFT_MESSAGE = 'Redraft my writing style guide from the chapters.';
/** Examples for "Revise…": what to change, in the author's own words. */
export const STYLE_REVISE_PLACEHOLDER = 'e.g. Less formal. Never use semicolons. Numbers under ten in words.';

/** A part of the guide the author changed after an assistant wrote it: theirs to keep. */
export type GuideChange = { wrote: string; now: string };

/** A passage an assistant wrote in the book, and what the author changed it to by hand (from History). */
export type AuthorRevision = { path: string; wrote: string; now: string };

/** Most revisions, and lines of each, in a brief. */
const MAX_REVISIONS = 12;
const MAX_REVISION_LINES = 12;

const capLines = (text: string) => {
  const lines = text.split('\n');
  return lines.length > MAX_REVISION_LINES ? [...lines.slice(0, MAX_REVISION_LINES), `… (${lines.length - MAX_REVISION_LINES} more lines)`].join('\n') : text;
};

/** The author's rewrites of the assistant's text, for the brief: what they want that it didn't do. */
function revisionsSection(revisions: readonly AuthorRevision[]): string {
  if (!revisions.length) return '';
  const shown = revisions.slice(0, MAX_REVISIONS).map((r) =>
    !r.now.trim()
      ? `<author-removed path="${r.path}">\n${capLines(r.wrote)}\n</author-removed>`
      : `<author-revision path="${r.path}">\n<assistant-wrote>\n${capLines(r.wrote)}\n</assistant-wrote>\n<author-made-it>\n${capLines(r.now)}\n</author-made-it>\n</author-revision>`,
  );
  return `
## How the author rewrites the assistant's text
From History: passages a writing assistant wrote in this book, and what the author changed them to by hand afterwards (or took out). They show what the author wants that the assistant didn't do, so let them shape the guide: a word they keep swapping for another, phrases they cut, sentences they shorten or split, a tone they keep pulling back to. Look for what several have in common, and write it as a rule (under Do, Don't, or Words and spelling). A single fix of a fact or a typo isn't a style rule. Don't quote these passages in the guide.
${shown.join('\n')}
`;
}

export type StyleDraftOptions = {
  /** The author's rewrites of an assistant's text, from History (newest first). */
  revisions?: readonly AuthorRevision[];
  /**
   * The guide is there and isn't quite right. `authorChanges`: what the author
   * changed in it since an assistant last wrote it; null when no assistant ever
   * did (the author wrote it, by hand or from the template); undefined when
   * that isn't known (History is off).
   */
  redraft?: { authorChanges?: GuideChange[] | null };
};

/** What the brief says about the guide that's there, for a redraft. */
function redraftSection({ authorChanges }: NonNullable<StyleDraftOptions['redraft']>): string {
  const whose =
    authorChanges === null
      ? '- The author wrote the guide themselves: keep its rules, unless the chapters plainly go against one. Fill in what it’s missing, and make vague rules concrete.'
      : authorChanges?.length
        ? `- An assistant wrote it, and the author has changed these parts since. They're the author's own words: keep them as they are, unless the chapters plainly go against them.\n${authorChanges
            .map((c) => (!c.wrote.trim() ? `<author-added>\n${c.now}\n</author-added>` : !c.now.trim() ? `<author-removed>\n${c.wrote}\n</author-removed>` : `<author-change>\n<it-was>\n${c.wrote}\n</it-was>\n<the-author-made-it>\n${c.now}\n</the-author-made-it>\n</author-change>`))
            .join('\n')}`
        : authorChanges
          ? '- An assistant wrote it, and the author hasn’t changed it: redraft it from the chapters, keeping what’s right.'
          : '- Keep the rules the author wrote or changed themselves, unless the chapters plainly go against them.';
  return `
## Redrafting
${STYLE_GUIDE_FILE} is there already, and the author wants it redrafted: it isn't quite right. Read it before the chapters.
${whose}
- Don't keep a rule only because it was there, nor drop one only because you'd say it differently. Write the whole file again (History keeps the old one).
`;
}

/** The draft's own instruction entry, for that conversation only. */
export const STYLE_DRAFT_KEY = 'style-draft';

/**
 * How to draft the guide. The author never sees this: it says what the guide
 * is (how this book is written, for whoever writes in it), that there's
 * nothing to ask about the guide itself, and that questions are a last resort,
 * about the book, at most two, with answers to pick from.
 */
/** What the guide is for: the same for a draft and an interview. */
const GUIDE_PURPOSE = `Foreword gives the guide to the writing assistant with every request, so that new and revised text sounds like the rest of the book. The author reads and edits it too, so write it plainly.`;

/** What's settled about the guide, so the author is never asked about it. */
const GUIDE_SETTLED = `What the guide is about, decided already:
- It describes this book's prose and markup, nothing else. "Audience" means the book's readers.
- Don't ask the author anything about the guide itself: who it's for, who reads it, its format, length, sections or tone, whether to write it, or where to save it. Those are settled here. Asking them would confuse the author.
- Don't explain this brief or repeat it to the author. They only see their own short message.`;

export function styleDraftBrief(opts: StyleDraftOptions = {}): string {
  return `# Drafting the book's writing style guide

The author pressed "Draft from my chapters" in Foreword. In this conversation your job is to write ${STYLE_GUIDE_FILE} in the book's folder (next to the main file): a short guide to how this book is written. ${GUIDE_PURPOSE}

${GUIDE_SETTLED}
${opts.redraft ? redraftSection(opts.redraft) : ''}${revisionsSection(opts.revisions ?? [])}
How to do it:
1. Read the manuscript before anything else: the main file, and enough of the chapters to see how the book is really written (all of a short book; for a long one, at least the first chapter, one from the middle and the last). Read; don't summarize what you read in the chat.
2. Work out from the text: who reads the book and what they already know; voice and tone; point of view and tense; how sentences and paragraphs are built; words and spelling (British or American, preferred terms, capitals, numbers); how the Typst markup is used (headings and labels, emphasis, lists, equations, citations, how chapters are included); and how figures look and are captioned.
3. Questions are a last resort. Ask only when the text can't tell you something the guide needs and a wrong guess would mislead every later edit, for example who the book is for when the chapters don't show it, or what the author wants the writing never to do. At most two questions, asked together, the way your instructions say to ask, each with three answers drawn from the book (the likeliest first, recommended). Never ask about something the chapters already show. When unsure, decide from the text instead.
4. Write ${STYLE_GUIDE_FILE} with these sections, in this order: ${STYLE_SECTIONS.join('; ')}. Leave out a section the book gives you nothing for. Each rule short, concrete and followable ("Second person, present tense", not "Engaging tone"), true to what the book does now. Under Examples, quote a short passage from the book that shows its voice (a few sentences).
5. Change nothing else: no chapter, no other file, no settings.
6. Then, in two or three sentences, tell the author ${opts.redraft ? 'what changed from the old guide' : 'what the guide says their book sounds like'}, and that they can change ${STYLE_GUIDE_FILE} any time. Don't paste the guide into the chat.`;
}

/** "Revise…": the author's own words go in the chat, so the task reads as what they asked for. */
export function styleReviseMessage(request: string): string {
  const text = request.trim();
  return text.includes('\n') ? `Revise my style guide:\n\n${text}` : `Revise my style guide: ${text}`;
}

/**
 * The revision's brief, out of sight like the draft's: change what the author
 * asks for in the guide and keep the rest as it is, word for word. It stays
 * with the conversation, so every later message there is another change (and
 * a draft's conversation gets it once the guide is written, for the same).
 */
export function styleReviseBrief(): string {
  return `# Revising the book's writing style guide

The author wants to change ${STYLE_GUIDE_FILE}, the book's writing style guide (in the book's folder, next to the main file). Each of their messages in this conversation says what should change in it: a rule to add, change or drop, a section to rework, a different voice. ${GUIDE_PURPOSE}

${GUIDE_SETTLED}

How to do it:
1. Read ${STYLE_GUIDE_FILE} first. Read the chapters only when the request needs them, for example "add a rule for how we write numbers" (see how the book does it now) or "make it sound like chapter 3".
2. Make the change they ask for, and only that: edit the lines it touches and keep every other line as it is, word for word. Don't reword, reorder or tidy the rest, and don't write the whole file again.
3. Write as the guide does: each rule short, concrete and followable ("Second person, present tense", not "Engaging tone"). A new rule goes under the section it belongs to (${STYLE_SECTIONS.join('; ')}), and a section that isn't there yet goes in that order. When a new rule goes against one that's there, replace that one rather than keeping both. When they ask to drop or soften a rule, take it out or soften it rather than adding one against it.
4. Ask only when the request could mean two quite different rules and a wrong guess would mislead every later edit: one question, the way your instructions say to ask, with three answers to pick from (the likeliest first, recommended). Otherwise decide, and say what you decided.
5. Change nothing else: no chapter, no other file, no settings. If they ask for the chapters to change too (rewrite chapter 2 in the new voice), change the guide only, and say they can ask for that in a new task.
6. Then, in a sentence or two, say what you changed. Don't paste the guide into the chat.`;
}

/** "Interview me": the guide from the author's answers, for a book with little written yet, or an author who'd rather say it. */
export const STYLE_INTERVIEW_MESSAGE = 'Interview me to write my style guide.';

/**
 * The interview's brief, out of sight like the draft's: look at the book,
 * then ask in a few short rounds (the question panel, answers to pick from),
 * about the book and never about the guide, then write it from the answers.
 * `existing`: there's a guide already, to build on.
 */
export function styleInterviewBrief(opts: { revisions?: readonly AuthorRevision[]; existing?: boolean } = {}): string {
  return `# Writing the book's style guide by interview

The author pressed "Interview me" in Foreword: they want ${STYLE_GUIDE_FILE}, a short guide to how this book should be written, built from their answers to your questions. Write it in the book's folder (next to the main file). ${GUIDE_PURPOSE}

${GUIDE_SETTLED}
${opts.existing ? `\n## The guide that's there\n${STYLE_GUIDE_FILE} exists already. Read it first: ask only about what it leaves open or what the author wants different, and keep the rules they wrote themselves unless their answers change them. Write the whole file again (History keeps the old one).\n` : ''}${revisionsSection(opts.revisions ?? [])}
How to do it:
1. Look first: read the main file and skim the chapters, if there are any (a new book may have none), so your questions fit this book and you don't ask what its text already shows. Don't summarize what you read.
2. Then interview the author in rounds, asking the way your instructions say to ask (they answer in a panel): up to four questions a round, each with three answers that fit this book (the likeliest first, recommended); they can always give their own. Three rounds, four at most, in this order:
   - The book and its readers: who reads it, what they already know, and what the book is for (to teach, to entertain, to persuade, to keep).
   - The voice: formal or conversational, serious or light; point of view and tense; how it speaks to the reader.
   - The words: British or American spelling; plain or technical vocabulary, terms to use or avoid; short or long sentences and paragraphs.
   - Taste: books or writers it should sound like, what they never want to see (clichés, exclamation marks, jargon…), and how figures, math or code should look, if the book has them.
   Skip a question the book's text already answers, and a round with nothing left to ask. Every question is about the book, never about the guide.
3. Between rounds, say one short sentence at most: no summaries of their answers.
4. Then write ${STYLE_GUIDE_FILE} with these sections, in this order: ${STYLE_SECTIONS.join('; ')}. Leave out a section with nothing in it. The author's answers come first, the chapters second. Each rule short, concrete and followable ("Second person, present tense", not "Engaging tone"). Under Examples, a short passage in the voice they chose: quoted from the book if it has one that fits, otherwise written for this book.
5. Change nothing else: no chapter, no other file, no settings.
6. Then, in two or three sentences, tell the author what the guide says their book should sound like, and that they can change ${STYLE_GUIDE_FILE} any time. Don't paste the guide into the chat.`;
}
