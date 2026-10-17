import { describe, expect, it } from 'vitest';
import { describeTool, fileName, firstHeading, includedFiles, type BookNames } from './tool-labels';

const names: BookNames = {
  root: '/b',
  entry: 'main.typ',
  chapters: ['chapters/01-storm.typ', 'chapters/02-harbour.typ'],
  titles: { 'chapters/01-storm.typ': 'The Storm', 'chapters/02-harbour.typ': 'The Harbour', 'notes.typ': 'Notes' },
};

describe('the book’s names', () => {
  it('reads headings and the include order', () => {
    expect(firstHeading('// a comment\n#import "x": *\n\n= The *Lighthouse* Keeper <ch-1>\n\nText.')).toBe('The Lighthouse Keeper');
    expect(firstHeading('== Only a subsection')).toBeNull();
    expect(includedFiles('#include "chapters/a.typ"\n// #include "chapters/old.typ"\n#include "./chapters/b.typ"', 'main.typ')).toEqual(['chapters/a.typ', 'chapters/b.typ']);
  });

  it('names files the way the author would', () => {
    expect(fileName('chapters/02-harbour.typ', names)).toBe('“The Harbour” (chapter 2)');
    expect(fileName('notes.typ', names)).toBe('“Notes”');
    expect(fileName('main.typ', names)).toBe('the main file');
    expect(fileName('WRITING_STYLE.md', names)).toBe('the style guide');
    expect(fileName('refs.bib', names)).toBe('refs.bib');
  });
});

describe('tool calls in words', () => {
  it('describes reads, searches and edits', () => {
    expect(describeTool('read', { path: 'chapters/01-storm.typ', offset: 1, limit: 200 }, names, 'x', { from: 1, to: 200 })).toEqual({
      done: 'Read “The Storm” (chapter 1)',
      running: 'Reading “The Storm” (chapter 1)',
      note: 'lines 1–200',
      path: 'chapters/01-storm.typ',
    });
    expect(describeTool('read', { filePath: '/b/main.typ' }, names).running).toBe('Reading the main file');
    expect(describeTool('grep', { pattern: 'lighthouse', path: 'chapters' }, names, 'Found 3 matches\n…')).toMatchObject({
      done: 'Searched for “lighthouse” in chapters/',
      note: '3 matches',
    });
    expect(describeTool('grep', { pattern: 'x' }, names, 'No matches found').note).toBe('no matches');
    expect(describeTool('glob', { pattern: '**/*.typ' }, names, '/b/a.typ\n/b/b.typ\n')).toMatchObject({ done: 'Looked for **/*.typ', note: '2 files' });
    expect(describeTool('edit', { path: 'chapters/02-harbour.typ', oldString: 'a', newString: 'b' }, names).done).toBe('Edited “The Harbour” (chapter 2)');
    expect(describeTool('apply_patch', { patchText: '*** Begin Patch\n*** Update File: /b/chapters/01-storm.typ\n@@\n-a\n+b\n*** End Patch' }, names)).toMatchObject({
      done: 'Edited “The Storm” (chapter 1)',
      path: 'chapters/01-storm.typ',
    });
  });

  it('describes commands, the web and anything else', () => {
    expect(describeTool('bash', { command: 'python3 count.py' }, names)).toMatchObject({ done: 'Ran a command', code: 'python3 count.py' });
    expect(describeTool('webfetch', { url: 'https://typst.app/docs/' }, names).done).toBe('Read a web page (typst.app)');
    expect(describeTool('websearch', { query: 'typst footnotes' }, names).running).toBe('Searching the web for “typst footnotes”');
    expect(describeTool('mystery', {}, names).done).toBe('Used mystery');
  });
});
