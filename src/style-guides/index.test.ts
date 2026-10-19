import { describe, expect, it } from 'vitest';
import { SAMPLES } from '../samples';
import { STYLE_SECTIONS } from '../services/agent/style-guide';
import { STYLE_TEMPLATES, suggestedStyleTemplate } from '.';

const sampleGuides = import.meta.glob('/samples/*/WRITING_STYLE.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('style guide templates', () => {
  it('one for each sample, and Blank', () => {
    expect(STYLE_TEMPLATES.filter((t) => t.sample).map((t) => t.sample).sort()).toEqual(SAMPLES.map((s) => s.id).sort());
    expect(STYLE_TEMPLATES.at(-1)?.id).toBe('blank');
  });

  for (const t of STYLE_TEMPLATES) {
    it(`${t.id}: a whole guide, named for the book, with the sections in order`, () => {
      const text = t.text('The Lighthouse');
      expect(text.startsWith('# Writing style: The Lighthouse\n')).toBe(true);
      expect(text).not.toContain('{{');
      const headings = text.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
      expect(headings).toEqual([...STYLE_SECTIONS]);
      if (t.id === 'blank') return;
      // Rules to change, not prompts: every section has some, and an example to go by.
      for (const section of text.split('\n## ').slice(1)) expect(section.split('\n').slice(1).join('\n').trim().length, section.slice(0, 20)).toBeGreaterThan(20);
      expect(text).toMatch(/Every rule is a starting point/);
    });
  }

  it('each names its sample, and the sample’s guide names it back: the worked example', () => {
    for (const t of STYLE_TEMPLATES.filter((x) => x.sample)) {
      const sample = SAMPLES.find((s) => s.id === t.sample)!;
      // The note wraps the name over lines.
      expect(t.text('x').replace(/\s+/g, ' '), t.id).toContain(`${sample.name} sample (New Book ▸ Samples)`);
      expect(sampleGuides[`/samples/${sample.id}/WRITING_STYLE.md`], sample.id).toContain(`A worked example of the ${t.name} style guide template.`);
    }
  });

  it('nothing from the picture-book sample’s own words (it isn’t public domain): no run of seven words in common', () => {
    const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const runs = (t: string) => {
      const w = words(t);
      return new Set(w.slice(0, Math.max(0, w.length - 6)).map((_, i) => w.slice(i, i + 7).join(' ')));
    };
    const luca = runs(sampleGuides['/samples/lucas-wonderful-brain/WRITING_STYLE.md'].replace(/<!--[\s\S]*?-->/, ''));
    const template = STYLE_TEMPLATES.find((t) => t.id === 'picture-book')!.text('x').replace(/<!--[\s\S]*?-->/, '');
    expect([...runs(template)].filter((r) => luca.has(r))).toEqual([]);
    for (const name of ['Luca', 'Summer', 'Auntie', 'autism']) expect(template, name).not.toContain(name);
  });

  it('suggests the one that fits the book’s files', () => {
    expect(suggestedStyleTemplate(['main.typ', 'story.typ', 'style.typ'])).toBe('picture-book');
    expect(suggestedStyleTemplate(['main.typ', 'code.typ', 'chapters/01.typ'])).toBe('programming-book');
    expect(suggestedStyleTemplate(['main.typ', 'refs.bib'])).toBe('research-paper');
    expect(suggestedStyleTemplate(['main.typ', 'refs.bib', 'chapters/01.typ', 'chapters/02.typ'])).toBe('blank');
    expect(suggestedStyleTemplate(['main.typ', 'chapters/01.typ'])).toBe('blank');
  });
});
