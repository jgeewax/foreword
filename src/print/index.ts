// Printing the book: print-ready PDFs (the interior with bleed, and the cover)
// and checks on them before the author orders from a printer. Foreword
// opens the printer's site; the order (and payment) happens there.
//
// Mixam's requirements (mixam.com/support/filesetup, checked 2026-10):
// 0.125in / 3mm bleed on inner pages and covers (files without bleed are
// scaled up to it), single pages for the interior, the cover as one spread
// with the spine, perfect binding from 32–48 pages (depending on paper),
// CMYK preferred (RGB is converted on upload).

/** Generated for each print export: the book, with bleed. Lives with Foreword's other files. */
export const PRINT_WRAPPER = '.foreword/interior.typ';
export const BLEED = '0.125in';
export const BLEED_PT = 9;

export function printWrapper(entry: string): string {
  return `// Foreword writes this file for printing (File → Print with Mixam…) and
// rewrites it each time: the book exactly as it is, with ${BLEED} bleed around
// every page, which printers trim off. Edit the book, not this file.
#set page(bleed: ${BLEED})
#include "/${entry.replace(/"/g, '')}"
`;
}

export const MIXAM_SITES = [
  { id: 'us', label: 'United States (mixam.com)', host: 'mixam.com', units: 'in' },
  { id: 'uk', label: 'United Kingdom (mixam.co.uk)', host: 'mixam.co.uk', units: 'mm' },
  { id: 'ca', label: 'Canada (mixam.ca)', host: 'mixam.ca', units: 'in' },
  { id: 'au', label: 'Australia (mixam.com.au)', host: 'mixam.com.au', units: 'mm' },
] as const;
export type MixamSite = (typeof MIXAM_SITES)[number]['id'];

/** Mixam's product pages that fit a Typst book (the same paths on every site above). */
export const MIXAM_PRODUCTS = [
  { id: 'novels', label: 'Novel' },
  { id: 'paperbackbooks', label: 'Paperback book' },
  { id: 'textbook', label: 'Textbook' },
  { id: 'childrensbooks', label: 'Children’s book' },
  { id: 'hardcoverbooks', label: 'Hardcover book' },
] as const;
export type MixamProduct = (typeof MIXAM_PRODUCTS)[number]['id'];

export function mixamSiteFor(locale: string): MixamSite {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase();
  return region === 'GB' || region === 'IE' ? 'uk' : region === 'CA' ? 'ca' : region === 'AU' || region === 'NZ' ? 'au' : 'us';
}

export function mixamUrl(site: MixamSite, path: string): string {
  const host = MIXAM_SITES.find((s) => s.id === site)!.host;
  return `https://${host}/${path.replace(/^\/+/, '')}`;
}

const UNIT_PT = { pt: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54 } as const;

/** A Typst length (`6in`, `15.2mm`) in points, or null. */
export function lengthPt(value: string | null | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(pt|in|mm|cm)\s*$/.exec(value ?? '');
  return m ? parseFloat(m[1]) * UNIT_PT[m[2] as keyof typeof UNIT_PT] : null;
}

export const ptToMm = (pt: number) => Math.round((pt / UNIT_PT.mm) * 10) / 10;
export const ptToIn = (pt: number) => Math.round((pt / 72) * 1000) / 1000;

/** The measurements in cover/spec.typ (lines `#let name = value`). */
export function parseCoverSpec(text: string) {
  const get = (name: string) => new RegExp(`^#let ${name} = (.+?)\\s*$`, 'm').exec(text)?.[1] ?? null;
  const pages = Number(get('pages'));
  const spineWidth = get('spine-width');
  return {
    width: get('trim-width'),
    height: get('trim-height'),
    pages: Number.isFinite(pages) && pages > 0 ? pages : null,
    paper: get('paper'),
    spineWidth: spineWidth && spineWidth !== 'none' ? spineWidth : null,
    bleed: get('bleed'),
  };
}
export type CoverSpec = ReturnType<typeof parseCoverSpec>;

/** The cover's spine in points: the exact width, or pages × paper thickness. */
export function coverSpinePt(spec: CoverSpec): number | null {
  if (spec.spineWidth) return lengthPt(spec.spineWidth);
  const paper = lengthPt(spec.paper);
  return paper != null && spec.pages ? spec.pages * paper : null;
}

export type PdfInfo = { pages: number; media: [number, number] | null; trim: [number, number, number, number] | null; uniform: boolean };

export type PrintFacts = {
  /** The book's trim size from its main file, in points. */
  trim: { width: number; height: number } | null;
  interior: PdfInfo | null;
  /** null: the book has no cover/ yet. */
  cover: { spec: CoverSpec; pdf: PdfInfo | null } | null;
  errors: number;
  staleCode: number;
  /** Files with pages that have no margin (full-page pictures) and don't reach into the bleed. */
  edgeToEdge: string[];
};

export type CheckAction = 'design-cover' | 'update-cover' | 'run-code' | 'show-problems';
export type Check = { level: 'ok' | 'warn' | 'bad' | 'info'; text: string; action?: CheckAction };

// Typst writes exact sizes: a few hundredths of a point apart is the same; a page more of spine (≈0.2pt) isn't.
const near = (a: number, b: number, tolerance = 0.1) => Math.abs(a - b) <= tolerance;
const inches = (w: number, h: number) => `${ptToIn(w)} × ${ptToIn(h)} in (${ptToMm(w)} × ${ptToMm(h)} mm)`;

export function printChecks(f: PrintFacts): Check[] {
  const out: Check[] = [];
  if (f.errors) out.push({ level: 'bad', text: `The book has ${f.errors} error${f.errors > 1 ? 's' : ''}. Fix ${f.errors > 1 ? 'them' : 'it'} first: the PDF shows the last version that worked.`, action: 'show-problems' });

  const pdf = f.interior;
  if (!pdf) out.push({ level: 'bad', text: 'The interior PDF couldn’t be made.' });
  else {
    if (!pdf.uniform) out.push({ level: 'bad', text: 'Pages have different sizes. A printed book needs every page the same size.' });
    const finished = pdf.trim ? { width: pdf.trim[2], height: pdf.trim[3] } : pdf.media ? { width: pdf.media[0], height: pdf.media[1] } : null;
    const bled = !!pdf.trim && !!pdf.media && near(pdf.media[0], pdf.trim[2] + 2 * BLEED_PT) && near(pdf.media[1], pdf.trim[3] + 2 * BLEED_PT);
    if (finished && pdf.uniform)
      out.push(
        bled
          ? { level: 'ok', text: `Interior: ${pdf.pages} pages, ${inches(finished.width, finished.height)}, with ${BLEED} bleed on every side.` }
          : { level: 'bad', text: `Interior: ${pdf.pages} pages without bleed. Printers scale pages without bleed up, which moves text toward the edge.` },
      );
    if (finished && f.trim && (!near(finished.width, f.trim.width) || !near(finished.height, f.trim.height)))
      out.push({ level: 'warn', text: `The pages are ${inches(finished.width, finished.height)}, but main.typ sets ${inches(f.trim.width, f.trim.height)}. Some pages may set their own size.` });
    if (pdf.pages % 2)
      out.push({ level: 'warn', text: `${pdf.pages} pages: a printed book has an even number (each sheet has two sides). Add a blank page at the end (#pagebreak() after the last page).` });
    if (pdf.pages < 32)
      out.push({ level: 'warn', text: `${pdf.pages} pages is short for a paperback: Mixam’s perfect binding starts at 32–48 pages, depending on the paper. Shorter books can be stapled booklets (pages in multiples of 4).` });
  }
  for (const file of f.edgeToEdge)
    out.push({ level: 'warn', text: `${file} has pages without margins (full-page pictures?) that stop at the trim. Pictures meant to run off the edge need to reach into the bleed (see page.bleed), or a thin white edge can show after cutting.` });

  if (!f.cover) out.push({ level: 'warn', text: 'No cover yet. Design one here, or upload one made elsewhere: Mixam takes the cover as one PDF spread (back, spine, front) with bleed.', action: 'design-cover' });
  else {
    const { spec, pdf: cover } = f.cover;
    const [cw, ch] = [lengthPt(spec.width), lengthPt(spec.height)];
    const finished = pdf?.trim ? { width: pdf.trim[2], height: pdf.trim[3] } : f.trim;
    if (cw != null && ch != null && finished && (!near(cw, finished.width) || !near(ch, finished.height)))
      out.push({ level: 'bad', text: `The cover is for ${inches(cw, ch)} pages, but the book’s are ${inches(finished.width, finished.height)}.`, action: 'update-cover' });
    if (pdf && !spec.spineWidth && spec.pages !== pdf.pages)
      out.push({ level: 'bad', text: `The cover’s spine is worked out for ${spec.pages ?? '?'} pages; the book has ${pdf.pages}.`, action: 'update-cover' });
    const spine = coverSpinePt(spec);
    const bleed = lengthPt(spec.bleed) ?? BLEED_PT;
    if (cover?.media && cw != null && ch != null && spine != null) {
      const want = [2 * cw + spine + 2 * bleed, ch + 2 * bleed];
      if (!near(cover.media[0], want[0]) || !near(cover.media[1], want[1]) || cover.pages !== 1)
        out.push({ level: 'bad', text: `The cover PDF is ${inches(cover.media[0], cover.media[1])}; it should be one page of ${inches(want[0], want[1])}. Check cover/design.typ’s page size.` });
      else
        out.push({
          level: 'ok',
          text: `Cover: one spread, ${inches(cover.media[0], cover.media[1])}, spine ${ptToMm(spine)} mm${spec.spineWidth ? ' (the width you entered)' : ` (for ${spec.pages} pages)`}, with bleed.`,
        });
    } else if (!cover) out.push({ level: 'bad', text: 'The cover PDF couldn’t be made. Check cover/design.typ for errors.' });
    out.push({
      level: 'info',
      text: 'The spine depends on the paper. Once you choose paper on Mixam, it shows the spine width (in the cart and the artwork step): enter it below if it differs.',
    });
  }
  if (f.staleCode)
    out.push({ level: 'warn', text: `${f.staleCode} code example${f.staleCode > 1 ? 's are' : ' is'} not up to date, so the book shows that. Run them first.`, action: 'run-code' });
  out.push({ level: 'info', text: 'Fonts are embedded in the PDFs (Typst always embeds them).' });
  out.push({
    level: 'info',
    text: 'Colours: Typst writes RGB and Mixam converts to CMYK on upload, which can dull bright colours. Order one copy first to see the printed result.',
  });
  out.push({ level: 'info', text: 'Margins: Mixam asks for text at least 0.25in (UK: 5mm) from the edges and 0.5in (UK: 12mm or more) from the binding.' });
  return out;
}

/** True if the facts allow printing (nothing marked bad). */
export const readyToPrint = (checks: Check[]) => !checks.some((c) => c.level === 'bad');

/** Pages with no margin whose content doesn't use page.bleed (heuristic, per file). */
export function edgeToEdgeWithoutBleed(text: string): boolean {
  return /\bpage\([^)]*margin:\s*0(pt|mm|in|cm)?\b/.test(text) && !/page\.bleed/.test(text);
}
