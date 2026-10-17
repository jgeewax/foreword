import { describe, expect, it } from 'vitest';
import { draftStyleGuidePrompt, STYLE_GUIDE_MAX_CHARS, styleGuideTemplate, styleInstructions } from './style-guide';

describe('styleInstructions', () => {
  it('wraps the guide and tells the agent to follow it', () => {
    const text = styleInstructions('  Always use British spelling: colour.  ');
    expect(text).toContain('must follow this guide');
    expect(text).toContain('<style-guide>\nAlways use British spelling: colour.\n</style-guide>');
  });

  it('cuts very long guides and says so', () => {
    const text = styleInstructions('x'.repeat(STYLE_GUIDE_MAX_CHARS + 500));
    expect(text).toContain('the rest of the guide was cut for length');
    expect(text.length).toBeLessThan(STYLE_GUIDE_MAX_CHARS + 1000);
  });
});

describe('styleGuideTemplate', () => {
  it('has a section for each part of a style guide, named for the book', () => {
    const t = styleGuideTemplate('Linear Algebra Notes');
    expect(t.startsWith('# Writing style: Linear Algebra Notes')).toBe(true);
    for (const h of ['Audience', 'Voice and tone', 'Point of view and tense', 'Sentences and paragraphs', 'Words and spelling', 'Formatting in Typst', 'Do', "Don't", 'Examples']) {
      expect(t).toContain(`## ${h}\n`);
    }
  });
});

describe('draftStyleGuidePrompt', () => {
  it('asks the agent to read first, ask questions, then write the file without touching chapters', () => {
    const p = draftStyleGuidePrompt();
    expect(p).toMatch(/Read the manuscript first/);
    expect(p).toMatch(/Ask me up to three short questions/);
    expect(p).toContain('WRITING_STYLE.md');
    expect(p).toMatch(/Don't change any chapter files/);
  });
});
