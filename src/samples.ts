// Sample books that come with the app: one finished book of each kind, to
// look through and to try the assistant on. They're the repo's samples/
// folder, bundled as the app's resources; opening one copies it into
// ~/Documents/Typst Studio Samples (once), so the author can change anything.

export type Sample = {
  id: string;
  /** The book's title, and its copy's folder name. */
  name: string;
  /** What kind of book it is (the template it was made with). */
  kind: string;
  /** The template whose style.typ it uses, if any. */
  template?: string;
  description: string;
  /** Where the text comes from. */
  source: string;
  /** The file opened first. */
  firstFile: string;
};

export const SAMPLES_FOLDER = 'Typst Studio Samples';

export const SAMPLES: Sample[] = [
  {
    id: 'jekyll-and-hyde',
    name: 'Strange Case of Dr Jekyll and Mr Hyde',
    kind: 'Novel',
    template: 'novel',
    description: 'Stevenson’s novella, complete: ten chapters, a dedication, and the letters and statements set apart.',
    source: 'Robert Louis Stevenson, 1886 · public domain',
    firstFile: 'chapters/01-story-of-the-door.typ',
  },
  {
    id: 'elements-of-style',
    name: 'The Elements of Style',
    kind: 'Non-fiction',
    template: 'nonfiction',
    description: 'Strunk’s rules of usage and composition, with his examples of what to write and what not to.',
    source: 'William Strunk Jr., 1918 · public domain',
    firstFile: 'chapters/01-introductory.typ',
  },
  {
    id: 'calculus-made-easy',
    name: 'Calculus Made Easy',
    kind: 'Textbook',
    template: 'textbook',
    description: 'The first chapters of Thompson’s classic, with their mathematics, figures, exercises and answers.',
    source: 'Silvanus P. Thompson, 1914 · public domain',
    firstFile: 'chapters/00-prologue.typ',
  },
  {
    id: 'counting-words',
    name: 'Counting Words',
    kind: 'Programming book',
    template: 'programming',
    description: 'Python for writers: code examples that run, show their real output and check it.',
    source: 'Written for Typst Studio',
    firstFile: 'chapters/01-first-steps.typ',
  },
  {
    id: 'peter-rabbit',
    name: 'The Tale of Peter Rabbit',
    kind: 'Children’s picture book',
    template: 'picture-book',
    description: 'Potter’s tale with her own illustrations: a picture and a line or two on every page.',
    source: 'Beatrix Potter, 1902 · public domain',
    firstFile: 'story.typ',
  },
  {
    id: 'attention-paper',
    name: 'Attention Is All You Need',
    kind: 'Research paper',
    description: 'The Transformer paper restated in our own words, in the NeurIPS template: equations, tables, a figure and references.',
    source: 'After Vaswani et al., NeurIPS 2017',
    firstFile: 'main.typ',
  },
];
