// Book templates (TODO #12). Each folder here is a complete Typst project
// (checked to compile by `npm run check-templates`); creating a book copies
// one into a new folder with the title and author filled in, plus project
// settings, a .gitignore and a starter WRITING_STYLE.md for the genre.
import { serializeProjectSettings, PROJECT_FILE } from '../app/project-settings';
import { STYLE_GUIDE_FILE, styleGuideTemplate, type StyleSection } from '../services/agent/style-guide';
import { HELPER_FILE, OUTPUTS_FILE } from '../code/cells';
import codeHelper from '../code/code.typ?raw';
import { makefile } from './makefile';

const RAW = import.meta.glob('./*/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Where a size is used, to group the list. */
export type SizeRegion = 'United States' | 'UK' | 'Continental Europe' | 'ISO (international)' | 'Japan' | 'China' | 'Korea';

/** The order the groups are shown in. */
export const REGIONS: SizeRegion[] = ['United States', 'UK', 'Continental Europe', 'ISO (international)', 'Japan', 'China', 'Korea'];

/** A page (trim) size; width and height are Typst lengths like "6in" or "148mm". */
export type PageSize = { label: string; width: string; height: string; region: SizeRegion };

const size = (region: SizeRegion, label: string, width: string, height: string): PageSize => ({ label, width, height, region });

// Common trim sizes. Names and exact sizes vary a little between printers
// (the Japanese, Chinese and Korean ones by a few millimetres).
const US = {
  massMarket: size('United States', 'Mass-market paperback (4.25 × 6.87 in)', '4.25in', '6.87in'),
  fiveByEight: size('United States', '5 × 8 in', '5in', '8in'),
  fiveQuarter: size('United States', '5.25 × 8 in', '5.25in', '8in'),
  digest: size('United States', 'Digest (5.5 × 8.5 in)', '5.5in', '8.5in'),
  trade: size('United States', 'US Trade (6 × 9 in)', '6in', '9in'),
  royal: size('United States', 'Royal (6.14 × 9.21 in)', '6.14in', '9.21in'),
  executive: size('United States', 'Executive (7 × 10 in)', '7in', '10in'),
  textbook: size('United States', '7.5 × 9.25 in', '7.5in', '9.25in'),
  eightByTen: size('United States', '8 × 10 in', '8in', '10in'),
  letter: size('United States', 'US Letter (8.5 × 11 in)', '8.5in', '11in'),
};
const UK = {
  aFormat: size('UK', 'A-format paperback (110 × 178 mm)', '110mm', '178mm'),
  bFormat: size('UK', 'B-format paperback (129 × 198 mm)', '129mm', '198mm'),
  demy: size('UK', 'Demy (138 × 216 mm)', '138mm', '216mm'),
  royal: size('UK', 'Royal (156 × 234 mm)', '156mm', '234mm'),
  crownQuarto: size('UK', 'Crown quarto (189 × 246 mm)', '189mm', '246mm'),
};
const EUROPE = {
  novel: size('Continental Europe', '13.5 × 21.5 cm', '135mm', '215mm'),
  large: size('Continental Europe', '17 × 24 cm', '170mm', '240mm'),
};
const ISO = {
  a6: size('ISO (international)', 'A6 (105 × 148 mm)', '105mm', '148mm'),
  a5: size('ISO (international)', 'A5 (148 × 210 mm)', '148mm', '210mm'),
  b5: size('ISO (international)', 'B5 (176 × 250 mm)', '176mm', '250mm'),
  a4: size('ISO (international)', 'A4 (210 × 297 mm)', '210mm', '297mm'),
};
const JAPAN = {
  bunko: size('Japan', 'Bunko 文庫 (105 × 148 mm)', '105mm', '148mm'),
  shinsho: size('Japan', 'Shinsho 新書 (103 × 182 mm)', '103mm', '182mm'),
  shiroku: size('Japan', 'Shiroku-ban 四六判 (127 × 188 mm)', '127mm', '188mm'),
  b6: size('Japan', 'B6 (JIS, 128 × 182 mm)', '128mm', '182mm'),
  kiku: size('Japan', 'Kiku-ban 菊判 (150 × 220 mm)', '150mm', '220mm'),
  b5: size('Japan', 'B5 (JIS, 182 × 257 mm)', '182mm', '257mm'),
};
const CHINA = {
  k32: size('China', '32 kai 32开 (130 × 184 mm)', '130mm', '184mm'),
  k32Large: size('China', 'Large 32 kai 大32开 (140 × 203 mm)', '140mm', '203mm'),
  k16: size('China', '16 kai 16开 (185 × 260 mm)', '185mm', '260mm'),
  k16Large: size('China', 'Large 16 kai 大16开 (210 × 285 mm)', '210mm', '285mm'),
};
const KOREA = {
  sayuk: size('Korea', 'Sayuk-pan 4·6판 (127 × 188 mm)', '127mm', '188mm'),
  guk: size('Korea', 'Guk-pan 국판 (148 × 210 mm)', '148mm', '210mm'),
  singuk: size('Korea', 'Singuk-pan 신국판 (152 × 225 mm)', '152mm', '225mm'),
  crown: size('Korea', 'Crown-pan 크라운판 (176 × 248 mm)', '176mm', '248mm'),
  sayukBae: size('Korea', 'Sayuk-baepan 4·6배판 (188 × 257 mm)', '188mm', '257mm'),
};
const PICTURE_BOOK = {
  square8: size('United States', '8 × 8 in square', '8in', '8in'),
  square85: size('United States', '8.5 × 8.5 in square', '8.5in', '8.5in'),
  landscape10: size('United States', '10 × 8 in landscape', '10in', '8in'),
  portrait8: size('United States', '8 × 10 in portrait', '8in', '10in'),
  landscape11: size('United States', '11 × 8.5 in landscape', '11in', '8.5in'),
  square210: size('UK', '210 × 210 mm square', '210mm', '210mm'),
  a4Landscape: size('ISO (international)', 'A4 landscape (297 × 210 mm)', '297mm', '210mm'),
};

/** Novels and other prose. */
const TRADE_SIZES: PageSize[] = [
  US.massMarket,
  US.fiveByEight,
  US.fiveQuarter,
  US.digest,
  US.trade,
  US.royal,
  UK.aFormat,
  UK.bFormat,
  UK.demy,
  UK.royal,
  EUROPE.novel,
  EUROPE.large,
  ISO.a6,
  ISO.a5,
  JAPAN.bunko,
  JAPAN.shinsho,
  JAPAN.shiroku,
  JAPAN.b6,
  JAPAN.kiku,
  CHINA.k32,
  CHINA.k32Large,
  KOREA.sayuk,
  KOREA.guk,
  KOREA.singuk,
];

/** Textbooks and technical books: bigger pages, for equations, figures and code. */
const LARGE_SIZES: PageSize[] = [
  US.trade,
  US.executive,
  US.textbook,
  US.eightByTen,
  US.letter,
  UK.royal,
  UK.crownQuarto,
  EUROPE.large,
  ISO.b5,
  ISO.a4,
  JAPAN.kiku,
  JAPAN.b5,
  CHINA.k16,
  CHINA.k16Large,
  KOREA.singuk,
  KOREA.crown,
  KOREA.sayukBae,
];

const PICTURE_BOOK_SIZES: PageSize[] = [
  PICTURE_BOOK.square8,
  PICTURE_BOOK.square85,
  PICTURE_BOOK.landscape10,
  PICTURE_BOOK.portrait8,
  PICTURE_BOOK.landscape11,
  US.letter,
  PICTURE_BOOK.square210,
  ISO.a4,
  PICTURE_BOOK.a4Landscape,
];

/** Every size once, for the blank template. */
const ALL_SIZES: PageSize[] = [...new Set([...TRADE_SIZES, ...LARGE_SIZES, ...PICTURE_BOOK_SIZES])].sort(
  (a, b) => REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region),
);

/** The sizes in groups by region, in the order they're listed, each with its index in `sizes`. */
export function sizesByRegion(sizes: PageSize[]): [SizeRegion, { size: PageSize; index: number }[]][] {
  const groups = new Map<SizeRegion, { size: PageSize; index: number }[]>();
  sizes.forEach((s, index) => groups.set(s.region, [...(groups.get(s.region) ?? []), { size: s, index }]));
  return [...groups];
}

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
  /** Comes with runnable code examples (code.typ and an outputs file). */
  code?: boolean;
};

export const TEMPLATES: BookTemplate[] = [
  {
    id: 'novel',
    name: 'Novel',
    description: 'Fiction in chapters, with scene breaks, a title page and running headers.',
    details: 'Libertinus Serif · running headers',
    sizes: TRADE_SIZES,
    defaultSize: TRADE_SIZES.indexOf(US.trade),
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
    sizes: TRADE_SIZES,
    defaultSize: TRADE_SIZES.indexOf(US.trade),
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
    sizes: LARGE_SIZES,
    defaultSize: LARGE_SIZES.indexOf(US.textbook),
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
    id: 'programming',
    name: 'Programming book',
    description: 'A technical book whose code examples run, show their real output, and can check it.',
    details: 'New Computer Modern · runnable Python examples',
    sizes: LARGE_SIZES,
    defaultSize: LARGE_SIZES.indexOf(US.textbook),
    firstFile: 'chapters/01-first-steps.typ',
    code: true,
    styleHints: {
      Audience: 'Who is learning, and what do they already know? e.g. people new to Python who can use a terminal.',
      'Voice and tone': 'e.g. practical and encouraging; show, then explain; one new idea per example.',
      'Point of view and tense': 'e.g. "we" while working through examples, "you" in exercises; present tense.',
      'Formatting in Typst': `- Code examples as \`#run("name", \`\`\`python … \`\`\`)\`, each with its own name; add \`expect:\` when the output is fixed.
- Short inline code in backticks: \`print()\`.
- Sections \`==\`; end chapters with \`#exercises[...]\`.`,
    },
  },
  {
    id: 'picture-book',
    name: "Children's picture book",
    description: 'A short illustrated story: a cover, one picture and a line or two of text per page.',
    details: 'Large rounded type · full-page pictures',
    sizes: PICTURE_BOOK_SIZES,
    defaultSize: PICTURE_BOOK_SIZES.indexOf(PICTURE_BOOK.square85),
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
    sizes: ALL_SIZES,
    defaultSize: ALL_SIZES.indexOf(ISO.a5),
    firstFile: 'chapters/01-chapter.typ',
    styleHints: {},
  },
];

export type BookInfo = { title: string; author: string; year: string; size?: { width: string; height: string } };

const LENGTH = /^(\d{1,4}(\.\d{1,6})?)(in|mm|cm|pt)$/;

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
    ...(template.code
      ? [
          { path: HELPER_FILE, text: codeHelper },
          { path: OUTPUTS_FILE, text: '{}\n' },
        ]
      : []),
    { path: PROJECT_FILE, text: serializeProjectSettings({}, { entryPoint: 'main.typ', outputDir: 'export' }) },
    { path: '.gitignore', text: '# Exported PDFs\nexport/\n' },
    { path: 'Makefile', text: makefile(info.title) },
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
    { path: 'Makefile', text: makefile(info.title) },
    { path: STYLE_GUIDE_FILE, text: styleGuideTemplate(info.title.trim() || 'Untitled', PAPER_STYLE) },
  ];
}

/** The chat message that fills in the template's title and authors (sent when the author is ready). */
export function paperSetupMessage(info: { title: string; author: string }): string {
  const who = info.author.trim() ? ` and the author(s) to “${info.author.trim()}”` : '';
  return `This paper was just created from a template. In main.typ, set the title to “${info.title.trim()}”${who}, replacing the template's placeholder title, authors and affiliations. Keep the template's layout, and leave the sample text in place for now.`;
}

