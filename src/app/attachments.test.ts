import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/ipc', () => ({ ipc: { fsReadBytes: vi.fn() } }));

import { fitWithin, inlineFiles, pastedFiles, pastedName } from './attachments';

const file = (name: string) => ({ name });

describe('attachments', () => {
  it('a paste attaches its files, unless they came beside text of their own', () => {
    // A screenshot; a picture copied in Preview or Safari (with its address).
    expect(pastedFiles([file('image.png')], '')).toHaveLength(1);
    expect(pastedFiles([file('image.png')], 'https://example.com/cat.jpg')).toHaveLength(1);
    // A file copied in Finder: its name is the text.
    expect(pastedFiles([file('Contract.pdf')], 'Contract.pdf')).toHaveLength(1);
    expect(pastedFiles([file('a.pdf'), file('b.png')], 'a.pdf\nb.png')).toHaveLength(2);
    // Cells from Numbers or a paragraph from Word, with a picture of them: text.
    expect(pastedFiles([file('image.png')], 'Name\tAge\nAda\t36')).toEqual([]);
    expect(pastedFiles([], 'just words')).toEqual([]);
  });

  it('pasted pictures get a name of their own', () => {
    const at = new Date(2026, 10, 13, 14, 32, 5);
    expect(pastedName({ name: 'image.png', type: 'image/png' }, at)).toBe('Pasted image 2026-11-13 at 14.32.05.png');
    expect(pastedName({ name: '', type: 'image/jpeg' }, at)).toBe('Pasted image 2026-11-13 at 14.32.05.jpg');
    expect(pastedName({ name: 'Cover draft.png', type: 'image/png' }, at)).toBe('Cover draft.png');
  });

  it('pictures fit within the longest side, never grown', () => {
    expect(fitWithin(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(1000, 3000, 2000)).toEqual({ width: 667, height: 2000 });
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });

  it('what goes in the message is what the agent takes; the rest goes by its path', async () => {
    const files = [
      { path: '.foreword/attachments/a.pdf', name: 'a.pdf', size: 4 },
      { path: '.foreword/attachments/notes.docx', name: 'notes.docx', size: 4 },
      { path: 'chapters', name: 'chapters', size: 0, dir: true },
    ];
    const read = async () => new TextEncoder().encode('%PDF').buffer as ArrayBuffer;
    expect(await inlineFiles(files, { pictures: true, files: false }, read)).toEqual([]);
    // Gemini CLI: a PDF's bytes (a Word file it can't take goes by its path).
    expect(await inlineFiles(files, { pictures: true, files: true }, read)).toEqual([{ path: '.foreword/attachments/a.pdf', mime: 'application/pdf', data: btoa('%PDF'), picture: false }]);
    // A file that's gone since is just left out.
    expect(await inlineFiles(files, { pictures: true, files: true }, () => Promise.reject(new Error('gone')))).toEqual([]);
  });
});
