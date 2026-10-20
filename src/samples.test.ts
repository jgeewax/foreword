import { describe, expect, it } from 'vitest';
import { SAMPLES } from './samples';

const texts = import.meta.glob('/samples/*/**/*.{typ,md,bib,txt,json,svg}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const extras = import.meta.glob('/samples/*/{.foreword.json,.gitignore,Makefile}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const styles = import.meta.glob('/src/templates/*/style.typ', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const codeHelper = import.meta.glob('/src/code/code.typ', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const file = (id: string, path: string) => texts[`/samples/${id}/${path}`] ?? extras[`/samples/${id}/${path}`];

describe('sample books', () => {
  it('lists every folder in samples/, and only those', () => {
    const folders = new Set(Object.keys(texts).map((p) => p.split('/')[2]));
    expect([...folders].sort()).toEqual(SAMPLES.map((s) => s.id).sort());
  });

  for (const s of SAMPLES) {
    it(`${s.id}: a complete book, as one made from its template`, () => {
      expect(file(s.id, 'main.typ'), 'main.typ').toBeDefined();
      expect(file(s.id, s.firstFile), s.firstFile).toBeDefined();
      expect(file(s.id, 'WRITING_STYLE.md')).toMatch(/^# Writing style: /);
      // A sample may bring its own fonts, in folders the Makefile passes to typst too.
      const { fontPaths = [], ...settings } = JSON.parse(file(s.id, '.foreword.json'));
      expect(settings).toEqual({ entryPoint: 'main.typ', outputDir: 'export' });
      expect(file(s.id, '.gitignore')).toContain('export/');
      expect(file(s.id, 'Makefile')).toMatch(/^pdf:$/m);
      for (const f of fontPaths) expect(file(s.id, 'Makefile')).toContain(`--font-path "${f}"`);
      // Its look is the template's, unchanged, so it shows what the template makes.
      if (s.template) expect(file(s.id, 'style.typ') === styles[`/src/templates/${s.template}/style.typ`], 'style.typ is the template’s').toBe(true);
      if (file(s.id, 'code.typ')) expect(file(s.id, 'code.typ') === Object.values(codeHelper)[0], 'code.typ is the app’s').toBe(true);
    });
  }

  it('keeps no trace of where the public-domain texts were downloaded', () => {
    for (const [path, text] of Object.entries(texts)) expect(text, path).not.toMatch(/gutenberg/i);
  });
});
