import { describe, expect, it } from 'vitest';
import { STYLE_DRAFT_MESSAGE, STYLE_GUIDE_MAX_CHARS, STYLE_INTERVIEW_MESSAGE, STYLE_REDRAFT_MESSAGE, styleDraftBrief, styleGuideTemplate, styleInstructions, styleInterviewBrief } from './style-guide';

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

describe('redrafting the guide', () => {
  it('a first draft says nothing about a guide that’s there', () => {
    expect(styleDraftBrief()).not.toMatch(/Redrafting/);
    expect(styleDraftBrief()).toMatch(/what the guide says their book sounds like/);
  });

  it('reads the guide first, writes it all again, and says what changed', () => {
    expect(STYLE_REDRAFT_MESSAGE).toBe('Redraft my writing style guide from the chapters.');
    const p = styleDraftBrief({ redraft: { authorChanges: [] } });
    expect(p).toMatch(/## Redrafting\nWRITING_STYLE.md is there already.*Read it before the chapters/);
    expect(p).toMatch(/hasn’t changed it: redraft it from the chapters/);
    expect(p).toMatch(/Write the whole file again \(History keeps the old one\)/);
    expect(p).toMatch(/tell the author what changed from the old guide/);
  });

  it('keeps what the author wrote: all of it, or the parts they changed', () => {
    expect(styleDraftBrief({ redraft: { authorChanges: null } })).toMatch(/The author wrote the guide themselves: keep its rules/);
    const p = styleDraftBrief({ redraft: { authorChanges: [{ wrote: '- Avoid jargon.', now: '- Avoid jargon. Never say “leverage”.' }] } });
    expect(p).toMatch(/the author has changed these parts since\. They're the author's own words: keep them/);
    expect(p).toContain('<author-change>\n<it-was>\n- Avoid jargon.\n</it-was>\n<the-author-made-it>\n- Avoid jargon. Never say “leverage”.\n</the-author-made-it>\n</author-change>');
    expect(styleDraftBrief({ redraft: {} })).toMatch(/Keep the rules the author wrote or changed themselves/);
    // What they added or took out, said as that.
    const more = styleDraftBrief({ redraft: { authorChanges: [{ wrote: '', now: '- Never begin with “So”.' }, { wrote: '- Use the Oxford comma.', now: '' }] } });
    expect(more).toContain('<author-added>\n- Never begin with “So”.\n</author-added>\n<author-removed>\n- Use the Oxford comma.\n</author-removed>');
  });
});

describe('the author’s rewrites of the assistant’s text', () => {
  const revisions = [
    { path: 'chapters/ch1.typ', wrote: 'We utilize the dot product in order to measure angles.', now: 'We use the dot product to measure angles.' },
    { path: 'chapters/ch2.typ', wrote: 'Basically, this is very important.', now: '' },
  ];

  it('go in the brief, as what the author wants that the assistant didn’t do, to make rules of', () => {
    const p = styleDraftBrief({ revisions });
    expect(p).toMatch(/## How the author rewrites the assistant's text\nFrom History/);
    expect(p).toMatch(/Look for what several have in common, and write it as a rule/);
    expect(p).toMatch(/A single fix of a fact or a typo isn't a style rule/);
    expect(p).toContain('<author-revision path="chapters/ch1.typ">\n<assistant-wrote>\nWe utilize the dot product in order to measure angles.\n</assistant-wrote>\n<author-made-it>\nWe use the dot product to measure angles.\n</author-made-it>\n</author-revision>');
    expect(p).toContain('<author-removed path="chapters/ch2.typ">\nBasically, this is very important.\n</author-removed>');
  });

  it('for a redraft too, and none when there aren’t any', () => {
    expect(styleDraftBrief({ revisions, redraft: { authorChanges: [] } })).toMatch(/## Redrafting[\s\S]*## How the author rewrites/);
    expect(styleDraftBrief({ revisions: [] })).not.toMatch(/How the author rewrites/);
  });

  it('a few, each cut short', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ path: 'a.typ', wrote: `line ${i}\n`.repeat(20), now: `x ${i}` }));
    const p = styleDraftBrief({ revisions: many });
    expect(p.match(/<author-revision /g)).toHaveLength(12);
    expect(p).toMatch(/… \(9 more lines\)/);
  });
});

describe('the style guide by interview', () => {
  it('shows the author one short message, and settles the guide as the draft does', () => {
    expect(STYLE_INTERVIEW_MESSAGE).toBe('Interview me to write my style guide.');
    const p = styleInterviewBrief();
    expect(p).toMatch(/"Audience" means the book's readers/);
    expect(p).toMatch(/Don't ask the author anything about the guide itself/);
    expect(p).toMatch(/Every question is about the book, never about the guide/);
  });

  it('looks at the book first, then asks in a few rounds with answers to pick, then writes from the answers', () => {
    const p = styleInterviewBrief();
    expect(p).toMatch(/1\. Look first: read the main file and skim the chapters, if there are any/);
    expect(p).toMatch(/up to four questions a round, each with three answers that fit this book/);
    expect(p).toMatch(/Three rounds, four at most/);
    expect(p).toMatch(/Skip a question the book's text already answers/);
    expect(p).toMatch(/The author's answers come first, the chapters second/);
    expect(p).toMatch(/Change nothing else: no chapter/);
  });

  it('builds on a guide that’s there, and on how the author rewrites the assistant', () => {
    expect(styleInterviewBrief()).not.toMatch(/The guide that's there/);
    expect(styleInterviewBrief({ existing: true })).toMatch(/## The guide that's there\nWRITING_STYLE.md exists already\. Read it first/);
    expect(styleInterviewBrief({ revisions: [{ path: 'a.typ', wrote: 'utilize', now: 'use' }] })).toMatch(/How the author rewrites the assistant's text/);
  });
});
