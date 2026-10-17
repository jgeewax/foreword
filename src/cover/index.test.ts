import { describe, expect, it } from 'vitest';
import { COVER_STYLES, coverFiles, namesFromMain, spineMm, trimFromMain, updateSpec } from './index';

const info = { title: 'The "Quiet" Harbour', author: 'Ada Example', width: '6in', height: '9in', pages: 240, paper: '0.0025in', spineWidth: null };

describe('coverFiles', () => {
  it('fills in the measurements and escapes the title', () => {
    for (const style of COVER_STYLES) {
      const files = coverFiles(style, info);
      expect(files.map((f) => f.path).slice(0, 5)).toEqual(['cover/spec.typ', 'cover/guides.typ', 'cover/design.typ', 'cover/cover.typ', 'cover/preview.typ']);
      // Everything a style refers to comes with it.
      for (const [, ref] of files[2].text.matchAll(/^#let picture = "([^"]+)"/gm)) expect(files.map((f) => f.path)).toContain(`cover/${ref}`);
      const spec = files[0].text;
      expect(spec).toMatch(/^#let trim-width = 6in$/m);
      expect(spec).toMatch(/^#let pages = 240$/m);
      expect(spec).toMatch(/^#let spine-width = none$/m);
      expect(files[2].text).toContain('#let title = "The \\"Quiet\\" Harbour"');
      for (const f of files) expect(f.text, f.path).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it('takes an exact spine width and rejects lengths that are not lengths', () => {
    expect(coverFiles(COVER_STYLES[0], { ...info, spineWidth: '15.2mm' })[0].text).toMatch(/^#let spine-width = 15\.2mm$/m);
    expect(() => coverFiles(COVER_STYLES[0], { ...info, width: '6in) #panic(' })).toThrow();
  });
});

describe('keeping the cover in step with the book', () => {
  it('updates page size and page count only', () => {
    const spec = coverFiles(COVER_STYLES[0], info)[0].text.replace('#let bleed = 0.125in', '#let bleed = 3mm');
    const next = updateSpec(spec, { width: '5.5in', height: '8.5in', pages: 312 });
    expect(next).toMatch(/^#let trim-width = 5\.5in$/m);
    expect(next).toMatch(/^#let pages = 312$/m);
    expect(next).toContain('#let bleed = 3mm');
  });

  it("reads the book's page size from its main file", () => {
    expect(trimFromMain('#show: book.with(title: title, author: author, width: 5.25in, height: 8in)')).toEqual({ width: '5.25in', height: '8in' });
    expect(trimFromMain('#set page(width: 148mm, height: 210mm, margin: 2cm)')).toEqual({ width: '148mm', height: '210mm' });
    expect(trimFromMain('#set page(paper: "a5")')).toEqual({ width: '148mm', height: '210mm' });
    expect(trimFromMain('= Hello')).toBeNull();
  });

  it("reads the book's title and author", () => {
    expect(namesFromMain('#let title = "The \\"Quiet\\" Harbour"\n#let author = "Ada"')).toEqual({ title: 'The "Quiet" Harbour', author: 'Ada' });
    expect(namesFromMain('= Hi')).toEqual({ title: null, author: null });
  });

  it('works out the spine for display', () => {
    expect(spineMm(240, '0.0025in')).toBe(15.2);
    expect(spineMm(100, '0.1mm')).toBe(10);
  });
});
