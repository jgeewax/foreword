// Book templates (TODO #12). Each folder here is a complete Typst project
// (checked to compile by `npm run check-templates`); creating a book copies
// one into a new folder with the title and author filled in, plus project
// settings, a .gitignore and a starter WRITING_STYLE.md for the genre.
import { serializeProjectSettings, PROJECT_FILE } from '../app/project-settings';
import { STYLE_GUIDE_FILE, styleGuideTemplate, type StyleSection } from '../services/agent/style-guide';

const RAW = import.meta.glob('./*/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** A page (trim) size; width and height are Typst lengths like "6in" or "148mm". */
export type PageSize = { label: string; width: string; height: string };

const BOOK_SIZES: PageSize[] = [
  { label: '5 × 8 in', width: '5in', height: '8in' },
  { label: '5.25 × 8 in', width: '5.25in', height: '8in' },
  { label: '5.5 × 8.5 in', width: '5.5in', height: '8.5in' },
  { label: '6 × 9 in', width: '6in', height: '9in' },
  { label: 'A5 (148 × 210 mm)', width: '148mm', height: '210mm' },
  { label: 'B-format (129 × 198 mm)', width: '129mm', height: '198mm' },
];

export type BookTemplate = {
  id: string;
  name: string;
  description: string;
  /** The look, one line (the size is shown separately). */
  details: string;
  sizes: PageSize[];
  /** Index into `sizes`. */
  defaultSize: number;
  /** The file to open first. */
  firstFile: string;
  styleHints: Partial<Record<StyleSection, string>>;
};

export const TEMPLATES: BookTemplate[] = [
  {
    id: 'novel',
    name: 'Novel',
    description: 'Fiction in chapters, with scene breaks, a title page and running headers.',
    details: 'Libertinus Serif · running headers',
    sizes: BOOK_SIZES,
    defaultSize: 3,
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
    details: 'Libertinus Serif · citations',
    sizes: BOOK_SIZES,
    defaultSize: 3,
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
    details: 'New Computer Modern · math',
    sizes: [
      { label: '7 × 10 in', width: '7in', height: '10in' },
      { label: '7.5 × 9.25 in', width: '7.5in', height: '9.25in' },
      { label: 'US Letter (8.5 × 11 in)', width: '8.5in', height: '11in' },
      { label: 'A4 (210 × 297 mm)', width: '210mm', height: '297mm' },
    ],
    defaultSize: 1,
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
    details: 'Large rounded type · full-page pictures',
    sizes: [
      { label: '8 × 8 in square', width: '8in', height: '8in' },
      { label: '8.5 × 8.5 in square', width: '8.5in', height: '8.5in' },
      { label: '10 × 8 in landscape', width: '10in', height: '8in' },
      { label: '8 × 10 in portrait', width: '8in', height: '10in' },
    ],
    defaultSize: 1,
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
    details: 'Libertinus Serif',
    sizes: [
      { label: 'A5 (148 × 210 mm)', width: '148mm', height: '210mm' },
      { label: 'A4 (210 × 297 mm)', width: '210mm', height: '297mm' },
      { label: 'US Letter (8.5 × 11 in)', width: '8.5in', height: '11in' },
      { label: '6 × 9 in', width: '6in', height: '9in' },
    ],
    defaultSize: 0,
    firstFile: 'chapters/01-chapter.typ',
    styleHints: {},
  },
];

export type BookInfo = { title: string; author: string; year: string; size?: { width: string; height: string } };

const LENGTH = /^(\d{1,4}(\.\d{1,3})?)(in|mm|cm|pt)$/;

/** A page dimension the author typed: a positive Typst length in in/mm/cm/pt, or null. */
export function typstLength(value: string): string | null {
  const v = value.replace(/\s+/g, '').toLowerCase();
  const m = LENGTH.exec(v);
  return m && parseFloat(m[1]) > 0 ? v : null;
}

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
  const size = info.size ?? template.sizes[template.defaultSize];
  const width = typstLength(size.width);
  const height = typstLength(size.height);
  if (!width || !height) throw new Error(`Not a page size: ${size.width} × ${size.height}`);
  const fill = (text: string) =>
    text
      // Lengths are validated above; they go into the markup as they are.
      .replaceAll('{{width}}', width)
      .replaceAll('{{height}}', height)
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

// ---- research papers: official templates from Typst Universe ---------------------

export type PaperTemplate = {
  id: string;
  name: string;
  description: string;
  /**
   * A Typst Universe template package, verified to compile with Typst 0.15.1
   * (`npm run check-templates -- --papers`). Not offered: lucky-icml 0.7.0 and
   * clear-iclr 0.7.0, which don't compile with 0.15 yet.
   */
  package: { name: string; version: string };
  /** Free fonts the template asks for (it falls back without them). */
  fonts?: { name: string; cask: string }[];
};

const TERMES = [
  { name: 'TeX Gyre Termes', cask: 'font-tex-gyre-termes' },
  { name: 'TeX Gyre Cursor', cask: 'font-tex-gyre-cursor' },
];

export const PAPER_TEMPLATES: PaperTemplate[] = [
  { id: 'ieee', name: 'IEEE', description: 'IEEE conference and journal papers, two columns.', package: { name: 'charged-ieee', version: '0.1.4' }, fonts: TERMES },
  { id: 'acm', name: 'ACM', description: 'ACM papers matching LaTeX acmart (sigconf and other formats).', package: { name: 'faithful-acmart', version: '0.2.0' }, fonts: [{ name: 'Libertinus', cask: 'font-libertinus' }] },
  { id: 'neurips', name: 'NeurIPS', description: 'Conference on Neural Information Processing Systems.', package: { name: 'bloated-neurips', version: '0.8.0' } },
  { id: 'cvpr', name: 'CVPR', description: 'Computer Vision and Pattern Recognition.', package: { name: 'blind-cvpr', version: '0.7.0' } },
  { id: 'aaai', name: 'AAAI', description: 'AAAI Conference on Artificial Intelligence.', package: { name: 'triple-aaai', version: '0.8.0' } },
  {
    id: 'acl',
    name: 'ACL',
    description: '*ACL venues (ACL, EMNLP, NAACL…).',
    package: { name: 'tracl', version: '0.8.1' },
    fonts: [TERMES[0], { name: 'Inconsolata', cask: 'font-inconsolata' }],
  },
  {
    id: 'lncs',
    name: 'Springer LNCS',
    description: 'Lecture Notes in Computer Science.',
    package: { name: 'fine-lncs', version: '0.6.5' },
    fonts: [{ name: 'New Computer Modern', cask: 'font-new-computer-modern' }],
  },
  { id: 'arxiv', name: 'arXiv preprint', description: 'The look of popular arXiv papers.', package: { name: 'arkheion', version: '0.1.2' } },
  {
    id: 'ams',
    name: 'AMS',
    description: 'American Mathematical Society papers.',
    package: { name: 'unequivocal-ams', version: '0.1.2' },
    fonts: [{ name: 'New Computer Modern', cask: 'font-new-computer-modern' }],
  },
  { id: 'apa', name: 'APA 7', description: 'Manuscripts in APA style (psychology and social sciences).', package: { name: 'apa7-ish', version: '0.3.0' } },
];

const PAPER_STYLE: Partial<Record<StyleSection, string>> = {
  Audience: "Reviewers and researchers in your field: what do they already know, and what's new to them?",
  'Voice and tone': 'e.g. precise and direct; every claim backed by evidence or a citation; no hype ("novel", "groundbreaking").',
  'Point of view and tense': 'e.g. "we" for the authors; present tense for what the paper shows, past tense for what was done.',
  'Formatting in Typst': `- Sections \`=\`, subsections \`==\` (the template numbers them).
- Cite with \`@key\` from the .bib file.
- Figures and tables get captions and labels (\`<fig-…>\`, \`<tab-…>\`), referred to as @fig-….
- Keep to the venue's page limit: watch the page count in the status bar.`,
};

/** Files Typst Studio adds to a paper made from a template package (never replacing the template's own). */
export function paperExtras(info: { title: string }): { path: string; text: string }[] {
  return [
    { path: PROJECT_FILE, text: serializeProjectSettings({}, { entryPoint: 'main.typ', outputDir: 'export' }) },
    { path: '.gitignore', text: '# Exported PDFs\nexport/\n' },
    { path: STYLE_GUIDE_FILE, text: styleGuideTemplate(info.title.trim() || 'Untitled', PAPER_STYLE) },
  ];
}

/** The chat message that fills in the template's title and authors (sent when the author is ready). */
export function paperSetupMessage(info: { title: string; author: string }): string {
  const who = info.author.trim() ? ` and the author(s) to “${info.author.trim()}”` : '';
  return `This paper was just created from a template. In main.typ, set the title to “${info.title.trim()}”${who}, replacing the template's placeholder title, authors and affiliations. Keep the template's layout, and leave the sample text in place for now.`;
}

