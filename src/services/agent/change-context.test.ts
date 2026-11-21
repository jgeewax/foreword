import { describe, expect, it } from 'vitest';
import { CHANGE_INTRO, changeHunks, changeLabel, formatChange, type ChangeNote } from './change-context';
import { messageText } from './message-context';
import { splitUserText } from '../../app/tasks';
import { stockTitle } from '../../app/stock-prompts';

const before = ['= Vectors', '', 'A vector has size.', 'It also has direction.', '', 'Vectors add.', 'They scale.'].join('\n');
const after = ['= Vectors', '', 'A vector has size and direction.', '', 'Vectors add.', 'They scale.', 'They make spaces.'].join('\n');

describe('the stretches a version changed', () => {
  it('each with a line either side, as it was and as the change left it', () => {
    expect(changeHunks(before, after)).toEqual({
      hunks: [
        { from: 2, before: '\nA vector has size.\nIt also has direction.\n', after: '\nA vector has size and direction.\n' },
        { from: 6, before: 'They scale.', after: 'They scale.\nThey make spaces.' },
      ],
      more: 0,
    });
  });

  it('a new file, all of it after; none when nothing changed', () => {
    expect(changeHunks(null, 'One.\nTwo.')).toEqual({ hunks: [{ from: 1, before: '', after: 'One.\nTwo.' }], more: 0 });
    expect(changeHunks(before, before)).toEqual({ hunks: [], more: 0 });
  });

  it('the one near a line first, when not all of them fit', () => {
    const a = Array.from({ length: 200 }, (_, i) => `Line ${i}.`);
    const b = a.map((l, i) => (i % 20 === 0 ? `${l} Changed.` : l));
    const { hunks, more } = changeHunks(a.join('\n'), b.join('\n'), 181);
    expect(hunks).toHaveLength(4);
    expect(more).toBe(6);
    // In the file's order, the one at line 181 among them.
    expect(hunks.map((h) => h.from)).toEqual([120, 140, 160, 180]);
  });
});

describe('the note that goes with the message', () => {
  const note: ChangeNote = {
    path: 'chapters/ch1.typ',
    version: { id: 'v7', label: 'Agent: Tighten the opening', time: Date.UTC(2026, 10, 21, 8, 3) / 1000, byAssistant: true },
    hunks: changeHunks(before, after).hunks.slice(0, 1),
    more: 1,
    turn: { task: 'Chapter 1', asked: 'Tighten the opening', said: 'Joined the two sentences about size and direction.' },
  };

  it('says which version, who made it and what they were asked, then the lines', () => {
    const text = formatChange(note);
    expect(text.startsWith(`${CHANGE_INTRO}chapters/ch1.typ, from History's version “Tighten the opening” (`)).toBe(true);
    expect(text).toMatch(/An assistant made it, in the task “Chapter 1”\. The author had asked: “Tighten the opening”\. Afterwards the assistant said: “Joined the two sentences about size and direction\.”\n<change/);
    expect(text).toMatch(/<change path="chapters\/ch1\.typ" version="v7">\n<lines from="2">\n<before>\n\nA vector has size\.\nIt also has direction\.\n\n<\/before>\n<after>\n\nA vector has size and direction\.\n\n<\/after>\n<\/lines>\n<\/change>/);
    expect(text).toMatch(/\(1 more changed stretch in the file, left out here\.\)$/);
  });

  it('without the conversation, or made by the author: nothing records why', () => {
    expect(formatChange({ ...note, turn: undefined })).toMatch(/An assistant made it\. Foreword doesn’t have that conversation, so nothing here records why\./);
    expect(formatChange({ ...note, version: { ...note.version, label: 'Edited ch1.typ', byAssistant: false }, turn: undefined })).toMatch(/The assistant didn’t make it: the author did/);
  });

  it('goes after the author’s words, and comes off again when the chat is read back', () => {
    const sent = messageText('Why did this change?', [{ change: note }, { reminder: '(Foreword, Ask mode: …)' }]);
    expect(sent.startsWith(`Why did this change?\n\n${CHANGE_INTRO}`)).toBe(true);
    expect(splitUserText(sent)).toEqual({ text: 'Why did this change?', attachments: ['Change to ch1.typ'] });
    expect(stockTitle(sent.replace(/\s+/g, ' '))).toBe('Why did this change?');
    expect(changeLabel(note)).toBe('Change to ch1.typ: “Tighten the opening”');
  });
});
