import { describe, expect, it } from 'vitest';
import { buildInstructions } from './instructions';

const ctx = {
  projectName: 'Linear Algebra Notes',
  entry: 'main.typ',
  typFiles: ['main.typ', 'chapters/ch1-vectors.typ', 'chapters/ch2-eigenvalues.typ'],
};

describe('buildInstructions', () => {
  const text = buildInstructions(ctx);

  it('frames the agent as a writing assistant on a Typst book, not a coder', () => {
    expect(text).toContain('writing assistant');
    expect(text).toContain('You are not writing software');
    expect(text).toMatch(/Do not create scripts, programs, build files/);
  });

  it('describes the project: name, entry point, chapter files', () => {
    expect(text).toContain('"Linear Algebra Notes"');
    expect(text).toContain('Entry point: `main.typ`');
    expect(text).toContain('`chapters/ch1-vectors.typ`, `chapters/ch2-eigenvalues.typ`');
    expect(text).not.toContain('`main.typ`, `chapters'); // entry isn't listed twice
  });

  it('explains attached selections and asks for brief change notes', () => {
    expect(text).toContain('<selection>');
    expect(text).toMatch(/one to three plain sentences/);
  });

  it('asks for one sentence per line, only in what it writes', () => {
    expect(text).toMatch(/One sentence per line/);
    expect(text).toMatch(/even where the file's existing paragraphs are wrapped differently/);
    expect(text).toMatch(/Don't rewrap paragraphs you aren't otherwise changing/);
  });

  it('says the preview is live and forbids compiling or offering to compile', () => {
    expect(text).toContain('## The preview is live');
    expect(text).toMatch(/Never compile, build, render, or export/);
    expect(text).toMatch(/never offer to do so/);
  });

  it('caps long file lists', () => {
    const many = Array.from({ length: 100 }, (_, i) => `chapters/ch${i}.typ`);
    const long = buildInstructions({ ...ctx, typFiles: many });
    expect(long).toContain('and 60 more');
    expect(long.length).toBeLessThan(6000);
  });

  it('handles a project without an entry point or chapters', () => {
    const empty = buildInstructions({ projectName: 'x', entry: null, typFiles: [] });
    expect(empty).toContain('Entry point: not set');
    expect(empty).toContain('Other Typst files: none yet');
  });
});
