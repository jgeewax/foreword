import { describe, expect, it } from 'vitest';
import { coverSpinePt, edgeToEdgeWithoutBleed, lengthPt, mixamSiteFor, mixamUrl, parseCoverSpec, printChecks, printWrapper, readyToPrint, type PrintFacts } from './index';

const SPEC = `#let trim-width = 6in
#let trim-height = 9in
#let pages = 240
#let paper = 0.0025in
#let spine-width = none
#let bleed = 0.125in
`;
// A 6×9in book of 240 pages, with bleed, and its 6×9in cover (spine 0.6in).
const good: PrintFacts = {
  trim: { width: 432, height: 648 },
  interior: { pages: 240, media: [450, 666], trim: [9, 9, 432, 648], uniform: true },
  cover: { spec: parseCoverSpec(SPEC), pdf: { pages: 1, media: [2 * 432 + 43.2 + 18, 666], trim: null, uniform: true } },
  errors: 0,
  staleCode: 0,
  edgeToEdge: [],
};
const levels = (f: PrintFacts) => printChecks(f).filter((c) => c.level === 'bad' || c.level === 'warn').map((c) => c.text);

describe('print checks', () => {
  it('passes a book with bleed and a matching cover', () => {
    const checks = printChecks(good);
    expect(levels(good)).toEqual([]);
    expect(readyToPrint(checks)).toBe(true);
    expect(checks.find((c) => c.text.startsWith('Interior'))?.text).toBe('Interior: 240 pages, 6 × 9 in (152.4 × 228.6 mm), with 0.125in bleed on every side.');
    expect(checks.find((c) => c.text.startsWith('Cover'))?.text).toContain('spine 15.2 mm (for 240 pages)');
  });

  it('catches what would go wrong at the printer', () => {
    expect(levels({ ...good, interior: { ...good.interior!, media: [432, 648], trim: null } })[0]).toMatch(/without bleed/);
    expect(levels({ ...good, interior: { ...good.interior!, pages: 241 } }).join()).toMatch(/even number/);
    expect(levels({ ...good, interior: { ...good.interior!, pages: 240, uniform: false } })[0]).toMatch(/different sizes/);
    const short = levels({ ...good, interior: { ...good.interior!, pages: 24 } });
    expect(short.join()).toMatch(/32–48 pages/);
    const grown = printChecks({ ...good, interior: { ...good.interior!, pages: 260 } });
    expect(grown.find((c) => c.action === 'update-cover')?.text).toBe('The cover’s spine is worked out for 240 pages; the book has 260.');
    expect(readyToPrint(grown)).toBe(false);
    const smaller = parseCoverSpec(SPEC.replace('6in', '5.5in'));
    expect(levels({ ...good, cover: { ...good.cover!, spec: smaller } }).join()).toMatch(/cover is for 5\.5 × 9 in/);
    expect(printChecks({ ...good, cover: null }).find((c) => c.action === 'design-cover')).toBeTruthy();
    // A cover PDF one page of spine out of date (0.18pt) is caught.
    const stale = { ...good.cover!, pdf: { ...good.cover!.pdf!, media: [good.cover!.pdf!.media![0] - 0.18, 666] as [number, number] } };
    expect(levels({ ...good, cover: stale }).join()).toMatch(/cover PDF is/);
    expect(printChecks({ ...good, errors: 2 })[0]).toMatchObject({ level: 'bad', action: 'show-problems' });
    expect(printChecks({ ...good, staleCode: 1 }).find((c) => c.action === 'run-code')).toBeTruthy();
    expect(levels({ ...good, edgeToEdge: ['style.typ'] }).join()).toMatch(/style\.typ has pages without margins/);
  });

  it('accepts an exact spine width from the printer', () => {
    const exact = parseCoverSpec(SPEC.replace('spine-width = none', 'spine-width = 16.3mm'));
    expect(coverSpinePt(exact)).toBeCloseTo((16.3 / 25.4) * 72);
    const pdf = { pages: 1, media: [2 * 432 + (16.3 / 25.4) * 72 + 18, 666] as [number, number], trim: null, uniform: true };
    // The page count no longer decides the spine, so a changed count is fine.
    const f = { ...good, interior: { ...good.interior!, pages: 250 }, cover: { spec: exact, pdf } };
    expect(levels(f)).toEqual([]);
    expect(printChecks(f).find((c) => c.text.startsWith('Cover'))?.text).toContain('spine 16.3 mm (the width you entered)');
  });
});

describe('helpers', () => {
  it('converts lengths and parses the cover spec', () => {
    expect(lengthPt('6in')).toBe(432);
    expect(lengthPt('25.4mm')).toBeCloseTo(72);
    expect(lengthPt('nope')).toBeNull();
    expect(parseCoverSpec(SPEC)).toEqual({ width: '6in', height: '9in', pages: 240, paper: '0.0025in', spineWidth: null, bleed: '0.125in' });
  });

  it('picks the Mixam site and builds only Mixam URLs', () => {
    expect(mixamSiteFor('en-GB')).toBe('uk');
    expect(mixamSiteFor('en-AU')).toBe('au');
    expect(mixamSiteFor('fr-CA')).toBe('ca');
    expect(mixamSiteFor('en-US')).toBe('us');
    expect(mixamSiteFor('de')).toBe('us');
    expect(mixamUrl('uk', 'novels')).toBe('https://mixam.co.uk/novels');
  });

  it('wraps the book with bleed', () => {
    expect(printWrapper('main.typ')).toContain('#set page(bleed: 0.125in)\n#include "/main.typ"');
  });

  it('spots full-page pictures that stop at the trim', () => {
    expect(edgeToEdgeWithoutBleed('#let p(x) = page(margin: 0pt, image(x, width: 100%))')).toBe(true);
    expect(edgeToEdgeWithoutBleed('#let p(x) = page(margin: 0pt, context { let b = page.bleed })')).toBe(false);
    expect(edgeToEdgeWithoutBleed('#set page(margin: 2cm)')).toBe(false);
  });
});
