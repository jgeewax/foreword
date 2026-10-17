// The cover designer: a printable wrap cover (back, spine, front, bleed) in
// the book's cover/ folder. spec.typ holds the measurements (kept in step with
// the book's page size and page count), design.typ the design (one of the
// styles here), cover.typ is what's printed and preview.typ adds guides.
import { typstLength, typstString } from '../templates';
import coverEntry from './cover.typ?raw';
import frontPicture from './front.svg?raw';
import guides from './guides.typ?raw';
import previewEntry from './preview.typ?raw';
import spec from './spec.typ?raw';
import band from './styles/band.typ?raw';
import classic from './styles/classic.typ?raw';
import picture from './styles/picture.typ?raw';

export const COVER_DIR = 'cover';
export const COVER_SPEC = 'cover/spec.typ';
export const COVER_DESIGN = 'cover/design.typ';
export const COVER_PRINT = 'cover/cover.typ';
export const COVER_PREVIEW = 'cover/preview.typ';

export type CoverStyle = {
  id: 'classic' | 'band' | 'picture';
  name: string;
  description: string;
  source: string;
  /** Files the style needs besides design.typ (e.g. a placeholder picture). */
  extra?: { path: string; text: string }[];
};

export const COVER_STYLES: CoverStyle[] = [
  { id: 'classic', name: 'Classic', description: 'A solid colour, a centred serif title. Novels and non-fiction.', source: classic },
  { id: 'band', name: 'Band', description: 'A colour band across the wrap, bold title. Textbooks and technical books.', source: band },
  {
    id: 'picture',
    name: 'Picture',
    description: 'An illustration fills the front (a placeholder to replace). Picture books.',
    source: picture,
    extra: [{ path: 'cover/front.svg', text: frontPicture }],
  },
];

/** Paper presets: thickness per page, as published by the printer. */
export const PAPERS = [
  { id: 'kdp-cream', label: 'Amazon KDP, cream paper', thickness: '0.0025in' },
  { id: 'kdp-white', label: 'Amazon KDP, white paper', thickness: '0.002252in' },
  { id: 'kdp-colour', label: 'Amazon KDP, colour (premium)', thickness: '0.002347in' },
] as const;

export type CoverInfo = {
  title: string;
  author: string;
  width: string;
  height: string;
  pages: number;
  /** Thickness per page (a length), or null when an exact spine width is given. */
  paper: string;
  /** Exact spine width from the printer (a length), or null. */
  spineWidth: string | null;
};

const length = (v: string, what: string) => {
  const l = typstLength(v);
  if (!l) throw new Error(`Not a ${what}: ${v}`);
  return l;
};

export function coverFiles(style: CoverStyle, info: CoverInfo): { path: string; text: string }[] {
  const specText = spec
    .replace('{{width}}', length(info.width, 'page width'))
    .replace('{{height}}', length(info.height, 'page height'))
    .replace('{{pages}}', String(Math.max(1, Math.round(info.pages))))
    .replace('{{paper}}', length(info.paper, 'paper thickness'))
    .replace('{{spine}}', info.spineWidth ? length(info.spineWidth, 'spine width') : 'none');
  const design = style.source.replace('{{title}}', typstString(info.title)).replace('{{author}}', typstString(info.author));
  return [
    { path: COVER_SPEC, text: specText },
    { path: 'cover/guides.typ', text: guides },
    { path: COVER_DESIGN, text: design },
    { path: COVER_PRINT, text: coverEntry },
    { path: COVER_PREVIEW, text: previewEntry },
    ...(style.extra ?? []),
  ];
}

/** spec.typ with new page size, page count or exact spine width (leaves everything else as the author left it). */
export function updateSpec(text: string, update: { width?: string | null; height?: string | null; pages?: number | null; spineWidth?: string | null }): string {
  let out = text;
  const set = (name: string, value: string) => {
    out = out.replace(new RegExp(`^(#let ${name} = ).*$`, 'm'), `$1${value}`);
  };
  if (update.width && typstLength(update.width)) set('trim-width', typstLength(update.width)!);
  if (update.height && typstLength(update.height)) set('trim-height', typstLength(update.height)!);
  if (update.pages && update.pages > 0) set('pages', String(Math.round(update.pages)));
  if (update.spineWidth && typstLength(update.spineWidth)) set('spine-width', typstLength(update.spineWidth)!);
  return out;
}

/** The book's page size from its main file (`width: 6in, height: 9in`, as the templates write it). */
export function trimFromMain(main: string): { width: string; height: string } | null {
  const m = /\bwidth:\s*(\d+(?:\.\d+)?(?:in|mm|cm|pt))\s*,\s*height:\s*(\d+(?:\.\d+)?(?:in|mm|cm|pt))/.exec(main);
  if (m) return { width: m[1], height: m[2] };
  const paper = /paper:\s*"(a5|a4|us-letter)"/.exec(main);
  return paper ? ({ a5: { width: '148mm', height: '210mm' }, a4: { width: '210mm', height: '297mm' }, 'us-letter': { width: '8.5in', height: '11in' } } as const)[paper[1] as 'a5'] : null;
}

/** The book's title and author, as the templates declare them (`#let title = "…"`). */
export function namesFromMain(main: string): { title: string | null; author: string | null } {
  const get = (name: string) => {
    const m = new RegExp(`^#let ${name} = "((?:[^"\\\\]|\\\\.)*)"`, 'm').exec(main);
    return m ? m[1].replace(/\\(.)/g, '$1') : null;
  };
  // Books not made from the templates may only name themselves in `#set document(title: "…")`.
  const doc = (name: string) => {
    const m = new RegExp(`document\\([^)]*\\b${name}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(main);
    return m ? m[1].replace(/\\(.)/g, '$1') : null;
  };
  return { title: get('title') ?? doc('title'), author: get('author') ?? doc('author') };
}

/** Spine width in mm for display (pages × thickness), from Typst lengths. */
export function spineMm(pages: number, thickness: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(in|mm|cm|pt)$/.exec(thickness);
  if (!m) return null;
  const mm = { in: 25.4, mm: 1, cm: 10, pt: 25.4 / 72 }[m[2] as 'in'];
  return Math.round(pages * parseFloat(m[1]) * mm * 10) / 10;
}
