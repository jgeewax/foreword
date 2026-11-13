import { describe, expect, it } from 'vitest';
import { splitUserText } from '../../app/tasks';
import { filesFromText, FILES_INTRO, formatFiles, isPictureFile, mimeOf, sizeLabel } from './attached-files';
import { inlineFiles, messageText } from './message-context';
import type { AttachedFile } from './types';

const photo: AttachedFile = { path: '.foreword/attachments/Pasted image 2026-11-13 at 14.32.05.png', name: 'Pasted image 2026-11-13 at 14.32.05.png', size: 1_234_567 };
const contract: AttachedFile = { path: '.foreword/attachments/Contract "final".pdf', name: 'Contract "final".pdf', size: 245_000 };
const chapters: AttachedFile = { path: 'chapters', name: 'chapters', size: 0, dir: true };

describe('attached files', () => {
  it('types and sizes from names', () => {
    expect(mimeOf('a.PNG')).toBe('image/png');
    expect(mimeOf('scan.heic')).toBe('image/heic');
    expect(mimeOf('notes.pdf')).toBe('application/pdf');
    expect(mimeOf('Makefile')).toBe('application/octet-stream');
    expect(isPictureFile({ name: 'x.jpg' })).toBe(true);
    expect(isPictureFile({ name: 'x.pdf' })).toBe(false);
    expect([0, 840, 12_400, 1_234_567, 45_600_000].map(sizeLabel)).toEqual(['0 B', '840 B', '12 KB', '1.2 MB', '46 MB']);
  });

  it('a line per file after the words, read back for the chat (quotes and folders too)', () => {
    const text = messageText('What does this say?', [{ files: [photo, contract, chapters], inline: [{ path: photo.path, mime: 'image/png', data: 'AAAA', picture: true }] }]);
    expect(text.startsWith(`What does this say?\n\n${FILES_INTRO}, in the book folder.`)).toBe(true);
    expect(text).toContain(`<attachment path="${photo.path}" type="image/png" size="1.2 MB" in-message="yes"/>`);
    expect(text).toContain('<attachment path=".foreword/attachments/Contract &quot;final&quot;.pdf" type="application/pdf" size="245 KB"/>');
    expect(text).toContain('<attachment path="chapters/" type="folder"/>');
    expect(filesFromText(text)).toEqual([
      { ...photo, size: 1_200_000 },
      contract,
      chapters,
    ]);
    // What the chat shows of it, from the agent's own record of the conversation.
    expect(splitUserText(text)).toEqual({ text: 'What does this say?', attachments: [], files: filesFromText(text) });
  });

  it('files alone: no words, and the chat shows none', () => {
    const text = messageText('', [{ files: [photo], inline: [] }]);
    expect(text.startsWith(FILES_INTRO)).toBe(true);
    expect(splitUserText(text)).toMatchObject({ text: '', files: [{ path: photo.path }] });
    // The same line in the author's own words isn't cut.
    expect(splitUserText(`Tell me about "${FILES_INTRO}"`).text).toBe(`Tell me about "${FILES_INTRO}"`);
  });

  it('formatFiles marks only what is in the message', () => {
    expect(formatFiles([contract], [])).not.toContain('in-message');
    expect(inlineFiles([{ reminder: 'x' }, { files: [photo], inline: [{ path: photo.path, mime: 'image/png', data: 'AAAA', picture: true }] }])).toHaveLength(1);
  });
});
