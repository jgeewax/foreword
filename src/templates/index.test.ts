import { describe, expect, it } from 'vitest';
import { bookFolderName, TEMPLATES, templateFiles, typstLength, typstString } from './index';

const info = { title: 'The "Quiet" Harbour \\ Part One', author: 'Ada Example', year: '2026' };

describe('templateFiles', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: a complete project with every placeholder filled`, () => {
      const files = templateFiles(t, info);
      const paths = files.map((f) => f.path);
      expect(paths).toContain('main.typ');
      expect(paths).toContain(t.firstFile);
      expect(paths).toEqual(expect.arrayContaining(['.typst-studio.json', '.gitignore', 'WRITING_STYLE.md']));
      expect(JSON.parse(files.find((f) => f.path === '.typst-studio.json')!.text)).toEqual({ entryPoint: 'main.typ', outputDir: 'export' });
      for (const f of files) expect(f.text, f.path).not.toMatch(/\{\{\w+\}\}/);
      const main = files.find((f) => f.path === 'main.typ')!.text;
      expect(main).toContain('#let title = "The \\"Quiet\\" Harbour \\\\ Part One"');

      // Every #include, #import and image path points at a file in the template.
      for (const f of files.filter((x) => x.path.endsWith('.typ'))) {
        const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
        for (const m of f.text.matchAll(/(?:#include|#import|image\(|bibliography\()\s*"([^"]+)"/g)) {
          const target = new URL(m[1], `file:///${dir}`).pathname.slice(1);
          expect(paths, `${f.path} → ${m[1]}`).toContain(target);
        }
      }
    });
  }

  it('starts the style guide with the book title and genre hints', () => {
    const guide = templateFiles(TEMPLATES[0], info).find((f) => f.path === 'WRITING_STYLE.md')!.text;
    expect(guide.startsWith(`# Writing style: ${info.title}`)).toBe(true);
    expect(guide).toContain('#scene-break()');
  });
});

describe('page sizes', () => {
  it('every template offers sizes and uses the chosen one', () => {
    for (const t of TEMPLATES) {
      expect(t.sizes.length, t.id).toBeGreaterThan(1);
      const main = templateFiles(t, { ...info, size: { width: '5.5in', height: '210mm' } }).find((f) => f.path === 'main.typ')!.text;
      expect(main, t.id).toMatch(/width: 5\.5in, height: 210mm/);
    }
  });

  it('accepts only plain positive lengths', () => {
    expect(typstLength(' 6 in ')).toBe('6in');
    expect(typstLength('148.5mm')).toBe('148.5mm');
    for (const bad of ['6', '0in', '-6in', '6in)', '6in + 1in', 'calc(1)', '12345in']) expect(typstLength(bad), bad).toBeNull();
    expect(() => templateFiles(TEMPLATES[0], { ...info, size: { width: '6in); #panic(', height: '9in' } })).toThrow();
  });
});

describe('typstString', () => {
  it('escapes quotes and backslashes and keeps it on one line', () => {
    expect(typstString(' a "b"\\c\nd ')).toBe('a \\"b\\"\\\\c d');
  });
});

describe('bookFolderName', () => {
  it('makes a safe folder name from the title', () => {
    expect(bookFolderName('  My Book: Part 1/2 ')).toBe('My Book- Part 1-2');
    expect(bookFolderName('...hidden')).toBe('hidden');
    expect(bookFolderName('   ')).toBe('Untitled Book');
  });
});
