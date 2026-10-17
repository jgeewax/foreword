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

/** Message that asks the agent to draft the guide from the manuscript. */
export function draftStyleGuidePrompt(): string {
  return `Help me write a style guide for this book, saved as ${STYLE_GUIDE_FILE} in the project root.

1. Read the manuscript first: the main file and several chapters, enough to get a real sense of how the book is written.
2. Describe what you see in a few bullet points: audience, voice and tone, point of view and tense, sentence style, terminology and spelling, how Typst markup is used (headings, emphasis, equations, labels, citations), and how the figures look (kind, colours, captions).
3. Ask me up to three short questions about anything the text alone can't tell you (for example who the reader is, or what I want to avoid). Wait for my answers.
4. Then write ${STYLE_GUIDE_FILE} with these sections: ${STYLE_SECTIONS.join('; ')}. Keep the rules short and concrete, and include a short example passage taken from or modelled on the book.

Don't change any chapter files.`;
}
