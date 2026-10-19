// Style guide templates: a WRITING_STYLE.md to start from, one for each kind
// of book the samples are. Each is modelled on its sample's own guide, made
// general (every rule a starting point to change), and the sample stays its
// worked example: the picker shows that guide beside the template, and the
// sample's guide says which template it shows.
import { styleGuideTemplate } from '../services/agent/style-guide';
import classicFiction from './classic-fiction.md?raw';
import friendlyTextbook from './friendly-textbook.md?raw';
import pictureBook from './picture-book.md?raw';
import programmingBook from './programming-book.md?raw';
import researchPaper from './research-paper.md?raw';
import rulesAndReference from './rules-and-reference.md?raw';

export type StyleTemplate = {
  id: string;
  name: string;
  /** For the picker: what kind of book it suits. */
  description: string;
  /** The sample whose guide is this template's worked example (samples.ts), if any. */
  sample?: string;
  /** The guide, for a book with this title. */
  text(title: string): string;
};

const filled = (source: string) => (title: string) => source.replace('{{title}}', title);

export const STYLE_TEMPLATES: StyleTemplate[] = [
  {
    id: 'classic-fiction',
    name: 'Classic fiction',
    description: 'A novel or story in a measured, period voice: third person, past tense, close to one character at a time.',
    sample: 'jekyll-and-hyde',
    text: filled(classicFiction),
  },
  {
    id: 'friendly-textbook',
    name: 'Friendly textbook',
    description: 'Teaching a hard subject to beginners: plain words before symbols, every step worked, exercises.',
    sample: 'calculus-made-easy',
    text: filled(friendlyTextbook),
  },
  {
    id: 'picture-book',
    name: 'Picture book',
    description: 'Read aloud to young children: a few short lines a page, the pictures doing the rest.',
    sample: 'lucas-wonderful-brain',
    text: filled(pictureBook),
  },
  {
    id: 'research-paper',
    name: 'Research paper',
    description: 'Precise and compact for researchers: every claim backed, notation defined, numbered equations and citations.',
    sample: 'attention-paper',
    text: filled(researchPaper),
  },
  {
    id: 'rules-and-reference',
    name: 'Rules and reference',
    description: 'A how-to or usage guide: short numbered rules in the imperative, each led by an example.',
    sample: 'elements-of-style',
    text: filled(rulesAndReference),
  },
  {
    id: 'programming-book',
    name: 'Programming book',
    description: 'Teaching code through examples that run and show their real output, one new idea at a time.',
    sample: 'counting-words',
    text: filled(programmingBook),
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'Just the headings, each with a prompt saying what to write.',
    text: (title) => styleGuideTemplate(title),
  },
];

/** The template that fits a book, from its files: a picture book's story.typ, a programming book's code.typ, a paper's single file and bibliography. */
export function suggestedStyleTemplate(files: readonly string[]): string {
  if (files.includes('story.typ')) return 'picture-book';
  if (files.includes('code.typ')) return 'programming-book';
  const chapters = files.filter((f) => f.endsWith('.typ') && f.includes('/')).length;
  if (files.some((f) => f.endsWith('.bib')) && chapters <= 1) return 'research-paper';
  return 'blank';
}
