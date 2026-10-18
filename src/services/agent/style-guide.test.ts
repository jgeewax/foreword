import { describe, expect, it } from 'vitest';
import { STYLE_DRAFT_MESSAGE, STYLE_GUIDE_MAX_CHARS, styleDraftBrief, styleGuideTemplate, styleInstructions } from './style-guide';

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
    for (const h of ['Audience', 'Voice and tone', 'Point of view and tense', 'Sentences and paragraphs', 'Words and spelling', 'Formatting in Typst', 'Figures', 'Do', "Don't", 'Examples']) {
      expect(t).toContain(`## ${h}\n`);
    }
  });
});

describe('drafting the guide', () => {
  it('shows the author one short message', () => {
    expect(STYLE_DRAFT_MESSAGE).toBe('Draft my writing style guide from the chapters.');
  });

  it('briefs the assistant out of sight: read first, write the file, touch nothing else', () => {
    const p = styleDraftBrief();
    expect(p).toMatch(/Read the manuscript before anything else/);
    expect(p).toContain('WRITING_STYLE.md');
    expect(p).toMatch(/Change nothing else: no chapter/);
    expect(p).toContain('Formatting in Typst; Figures; Do;');
    expect(p).toMatch(/Don't paste the guide into the chat/);
  });

  it('never lets it ask about the guide itself, and keeps questions about the book few, with answers to pick', () => {
    const p = styleDraftBrief();
    expect(p).toMatch(/"Audience" means the book's readers/);
    expect(p).toMatch(/Don't ask the author anything about the guide itself: who it's for, who reads it/);
    expect(p).toMatch(/At most two questions, asked together/);
    expect(p).toMatch(/three answers drawn from the book/);
    expect(p).toMatch(/Never ask about something the chapters already show/);
  });
});
