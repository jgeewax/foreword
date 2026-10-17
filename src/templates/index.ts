// Book templates (TODO #12). Each folder here is a complete Typst project
// (checked to compile by `npm run check-templates`); creating a book copies
// one into a new folder with the title and author filled in, plus project
// settings, a .gitignore and a starter WRITING_STYLE.md for the genre.
import { serializeProjectSettings, PROJECT_FILE } from '../app/project-settings';
import { STYLE_GUIDE_FILE, styleGuideTemplate, type StyleSection } from '../services/agent/style-guide';

const RAW = import.meta.glob('./*/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export type BookTemplate = {
  id: string;
  name: string;
  description: string;
  /** Page size and look, one line. */
  details: string;
  /** The file to open first. */
  firstFile: string;
  styleHints: Partial<Record<StyleSection, string>>;
};

export const TEMPLATES: BookTemplate[] = [
  {
    id: 'novel',
    name: 'Novel',
    description: 'Fiction in chapters, with scene breaks, a title page and running headers.',
    details: '6 × 9 in paperback · Libertinus Serif',
    firstFile: 'chapters/01-chapter-one.typ',
    styleHints: {
      Audience: 'Genre and readers, e.g. a literary mystery for adults; readers of Tana French.',
      'Voice and tone': 'e.g. close and wry; dialogue-led; spare description.',
      'Point of view and tense': 'e.g. close third person on Mara, past tense; one point of view per scene.',
      'Formatting in Typst': `- One chapter per file in chapters/, starting with \`= Title\`; no headings inside chapters.
- Scene changes: \`#scene-break()\` on its own line.
- Italics for emphasis, thoughts and foreign words: \`_like this_\`.
- Dialogue in plain double quotes; Typst curls them.`,
    },
  },
  {
    id: 'nonfiction',
    name: 'Non-fiction',
    description: 'Ideas and advice: contents, an introduction, sections, footnotes, sources and boxed asides.',
    details: '6 × 9 in · Libertinus Serif · citations',
    firstFile: 'chapters/01-first-chapter.typ',
    styleHints: {
      Audience: 'Who is this for, what do they already know, and what problem brings them to the book?',
      'Voice and tone': 'e.g. warm and practical; evidence first; short stories from real life; no hype.',
      'Point of view and tense': 'e.g. first person for stories, "you" for advice; present tense.',
      'Formatting in Typst': `- Chapters \`= Title\`, sections \`== Title\`, no deeper than \`===\`.
- Cite sources with \`@key\` (refs.bib); \`#footnote[...]\` only for asides.
- At most one \`#pull-quote[...]\` per chapter; \`#note(title: "Try this")[...]\` for exercises.`,
    },
  },
  {
    id: 'textbook',
    name: 'Textbook',
    description: 'Teaching material: numbered sections, equations, figures, definitions, examples and exercises.',
    details: '7.5 × 9.25 in · New Computer Modern · math',
    firstFile: 'chapters/01-getting-started.typ',
    styleHints: {
      Audience: 'Course and level, e.g. first-year undergraduates who know algebra but not calculus.',
      'Voice and tone': 'e.g. clear and encouraging; define every term before using it; one idea per paragraph.',
      'Point of view and tense': 'e.g. "we" in explanations, "you" in exercises; present tense.',
      'Formatting in Typst': `- Sections \`==\`, subsections \`===\`.
- New terms in \`#definition("Term")[...]\` and in _italics_ at first use.
- Displayed equations \`$ ... $ <eq-name>\`, referred to as @eq-name.
- Figures with a caption and a \`<fig-name>\` label.
- End each chapter with \`#exercises[...]\`.`,
    },
  },
  {
    id: 'picture-book',
    name: "Children's picture book",
    description: 'A short illustrated story: a cover, one picture and a line or two of text per page.',
    details: '8.5 × 8.5 in square · large rounded type',
    firstFile: 'story.typ',
    styleHints: {
      Audience: 'Reading age and who reads it aloud, e.g. read aloud to ages 3–6 by a parent.',
      'Voice and tone': 'e.g. playful and rhythmic; repetition children can join in on.',
      'Point of view and tense': 'e.g. third person, past tense.',
      'Sentences and paragraphs': 'e.g. at most two short sentences per page; words a five-year-old knows.',
      'Formatting in Typst': `- One \`#story-page(picture: "illustrations/...")[...]\` per page.
- A backslash \`\\\` at the end of a line where the reader should pause.
- About 32 pages in total, like a printed picture book.`,
    },
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'A title page and one chapter. Everything else is up to you.',
    details: 'A5 · Libertinus Serif',
    firstFile: 'chapters/01-chapter.typ',
    styleHints: {},
  },
];

export type BookInfo = { title: string; author: string; year: string };

/** A value placed inside a Typst string literal ("..."). */
export function typstString(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Folder name for a new book: the title, made safe for the file system. */
export function bookFolderName(title: string): string {
  const name = title
    .replace(/[/:\\\0]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return name || 'Untitled Book';
}

/** The files of a template, ready to write. Placeholders only appear inside Typst strings. */
export function templateFiles(template: BookTemplate, info: BookInfo): { path: string; text: string }[] {
  const prefix = `./${template.id}/`;
  const fill = (text: string) =>
    text
      .replaceAll('{{title}}', typstString(info.title))
      .replaceAll('{{author}}', typstString(info.author))
      .replaceAll('{{year}}', typstString(info.year));
  const files = Object.entries(RAW)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, text]) => ({ path: key.slice(prefix.length), text: key.endsWith('.typ') ? fill(text) : text }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return [
    ...files,
    { path: PROJECT_FILE, text: serializeProjectSettings({}, { entryPoint: 'main.typ', outputDir: 'export' }) },
    { path: '.gitignore', text: '# Exported PDFs\nexport/\n' },
    { path: STYLE_GUIDE_FILE, text: styleGuideTemplate(info.title.trim() || 'Untitled', template.styleHints) },
  ];
}
