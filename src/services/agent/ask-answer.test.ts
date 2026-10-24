import { describe, expect, it } from 'vitest';
import { ASK_INSTRUCTIONS, changePrompt, meantMessage } from './ask-mode';
import { parseChart } from '../../lib/chart';
import { answerOf, answerText, hasAnswerBlocks, markedTerms, markPieces, proseAndCharts, quoteOf, segments, sureOf, withoutAnswerBlocks } from './ask-answer';

const EARLY = '```answer\nasked: Do I use *orthogonal* anywhere in the book before the place where I define it?\n```';
const REPLY = [
  '```answer',
  'answer: Yes, once. Line 76 of chapter 3 uses it,',
  '967 lines before § Orthogonality defines it.',
  'sure: certain | searched all 25 chapters and the front matter',
  'where: chapters/ch03.typ:76 | First use | Glossed by “perpendicular”',
  'where: `chapters/ch03.typ:1043` | Definition',
  'stat: 0 | uses in chapters 1 and 2',
  'next: Where else do I use a term before I define it?',
  'next: Should the definition move up? | discuss',
  '```',
  '',
  'Line 76 glosses it as “perpendicular”, so nobody is lost there.',
  '',
  '```change',
  'at: chapters/ch03.typ:76',
  'find: perpendicular (orthogonal)',
  'replace: perpendicular (or _orthogonal_; see @sec:ch3-orthogonality)',
  'why: Point ahead to the definition',
  '```',
].join('\n');

describe('segments', () => {
  it('sets the blocks it reads apart from the prose, and leaves other code in it', () => {
    const segs = segments('Intro.\n```typst\n#set page()\n```\n```answer\nanswer: Yes.\n```\nAfter.');
    expect(segs).toEqual([
      { kind: 'prose', text: 'Intro.\n```typst\n#set page()\n```' },
      { kind: 'block', lang: 'answer', body: 'answer: Yes.', closed: true },
      { kind: 'prose', text: 'After.' },
    ]);
  });

  it('never reads a block inside other code', () => {
    const segs = segments('````md\n```answer\nanswer: no\n```\n````');
    expect(segs).toEqual([{ kind: 'prose', text: '````md\n```answer\nanswer: no\n```\n````' }]);
  });

  it('a block still being written runs to the end, open', () => {
    expect(segments('```answer\nasked: Why')).toEqual([{ kind: 'block', lang: 'answer', body: 'asked: Why', closed: false }]);
  });
});

describe('answerOf', () => {
  it('is null for a reply without the blocks', () => {
    expect(answerOf(['Just an answer.', '```typst\n#x\n```'])).toBeNull();
    expect(hasAnswerBlocks('```chart\nbar: a | 1\n```')).toBe(false);
    expect(hasAnswerBlocks(REPLY)).toBe(true);
  });

  it('puts what it said before it looked together with its reply', () => {
    const a = answerOf([EARLY, 'Let me look.', REPLY])!;
    expect(a.asked).toBe('Do I use *orthogonal* anywhere in the book before the place where I define it?');
    expect(a.answer).toBe('Yes, once. Line 76 of chapter 3 uses it,\n967 lines before § Orthogonality defines it.');
    expect(a.sure).toEqual({ level: 'certain', checked: 'searched all 25 chapters and the front matter' });
    expect(a.where).toEqual([
      { place: 'chapters/ch03.typ:76', label: 'First use', note: 'Glossed by “perpendicular”' },
      { place: 'chapters/ch03.typ:1043', label: 'Definition', note: '' },
    ]);
    expect(a.stats).toEqual([{ value: '0', label: 'uses in chapters 1 and 2' }]);
    expect(a.next).toEqual([
      { text: 'Where else do I use a term before I define it?', mode: null },
      { text: 'Should the definition move up?', mode: 'discuss' },
    ]);
    expect(a.changes).toEqual([{ at: 'chapters/ch03.typ:76', find: 'perpendicular (orthogonal)', replace: 'perpendicular (or _orthogonal_; see @sec:ch3-orthogonality)', why: 'Point ahead to the definition', complete: true }]);
    expect(a.writing).toBe(false);
  });

  it('a later block takes the place of an earlier one’s fields and places', () => {
    const a = answerOf(['```answer\nasked: One?\nwhere: a.typ:1 | A\n```', '```answer\nasked: Two?\nwhere: b.typ:2 | B\n```'])!;
    expect(a.asked).toBe('Two?');
    expect(a.where.map((p) => p.place)).toEqual(['b.typ:2']);
  });

  it('keeps the other reading, and an answer with only that much', () => {
    const a = answerOf(['```answer\nasked: Is chapter 13 long next to the others?\nother: Is it longer than what it covers needs?\n```'])!;
    expect(a).toMatchObject({ asked: 'Is chapter 13 long next to the others?', other: 'Is it longer than what it covers needs?', answer: '', where: [] });
  });

  it('while a block streams, a place waits for the end of its line', () => {
    const a = answerOf(['```answer\nanswer: Yes.\nwhere: chapters/ch03.typ:7'])!;
    expect(a.writing).toBe(true);
    expect(a.where).toEqual([]);
    expect(answerOf(['```answer\nanswer: Yes, on'])!.answer).toBe('Yes, on');
  });

  it('a change block still coming isn’t complete, and one with no words is none', () => {
    expect(answerOf(['```change\nat: a.typ:3\nfind: x\nreplace: y'])!.changes).toEqual([{ at: 'a.typ:3', find: 'x', replace: 'y', why: '', complete: false }]);
    expect(answerOf(['```change\nat: a.typ:3\n```'])!.changes).toEqual([]);
  });

  it('a change keeps its lines, and a line that only looks like a field', () => {
    const c = answerOf(['```change\nat: a.typ:3\nfind:\nNote: the old line\nsecond\nreplace: Note: the new line\n```'])!.changes[0];
    expect(c.find).toBe('Note: the old line\nsecond');
    expect(c.replace).toBe('Note: the new line');
  });

  it('reads fields written as a list, in bold', () => {
    expect(answerOf(['```answer\n- **asked**: Why?\n* answer: Because.\n```'])).toMatchObject({ asked: 'Why?', answer: 'Because.' });
  });
});

describe('sureOf', () => {
  it('reads how sure from the first words', () => {
    expect(sureOf('certain | read every chapter')).toEqual({ level: 'certain', checked: 'read every chapter' });
    expect(sureOf('Fairly sure, words in the source')).toEqual({ level: 'fairly', checked: 'words in the source' });
    expect(sureOf('a guess — I only read chapter 2')).toEqual({ level: 'guess', checked: 'I only read chapter 2' });
    expect(sureOf('not sure')).toEqual({ level: 'guess', checked: '' });
    expect(sureOf('read chapters 1 to 3')).toEqual({ level: 'fairly', checked: 'read chapters 1 to 3' });
  });
});

describe('the reply around the card', () => {
  it('without its blocks, it keeps its charts and other code', () => {
    const text = `${REPLY}\n\n\`\`\`chart\nbar: a | 1\n\`\`\`\n\`\`\`typst\n#x\n\`\`\``;
    expect(withoutAnswerBlocks(text)).toBe('Line 76 glosses it as “perpendicular”, so nobody is lost there.\n\n```chart\nbar: a | 1\n```\n```typst\n#x\n```');
    expect(withoutAnswerBlocks('Plain.')).toBe('Plain.');
  });

  it('the prose and the charts, apart', () => {
    expect(proseAndCharts('Why.\n```chart\nbar: a | 1\n```\nMore.')).toEqual({ prose: 'Why.\n\nMore.', charts: [{ body: 'bar: a | 1', closed: true }] });
  });

  it('as plain text', () => {
    const a = answerOf([EARLY, REPLY])!;
    expect(answerText(a, 'Because.')).toBe(
      [
        'Do I use *orthogonal* anywhere in the book before the place where I define it?',
        'Yes, once. Line 76 of chapter 3 uses it,\n967 lines before § Orthogonality defines it.',
        '- chapters/ch03.typ:76 (First use): Glossed by “perpendicular”\n- chapters/ch03.typ:1043 (Definition)',
        'Because.',
        'chapters/ch03.typ:76: “perpendicular (orthogonal)” → “perpendicular (or _orthogonal_; see @sec:ch3-orthogonality)” (Point ahead to the definition)',
      ].join('\n\n'),
    );
  });
});

describe('quotes', () => {
  it('quotes a line as words', () => {
    expect(quoteOf('- *Zero:* vectors are perpendicular (orthogonal)')).toBe('Zero: vectors are perpendicular (orthogonal)');
    expect(quoteOf('== Orthogonality <sec:ch3-orthogonality>')).toBe('Orthogonality');
    expect(quoteOf('#index[orthogonal]We keep running into it.')).toBe('We keep running into it.');
    expect(quoteOf('This condition is called _orthogonality_.')).toBe('This condition is called orthogonality.');
  });

  it('marks the words the question singles out, and the longer words they start', () => {
    expect(markedTerms('Do I use *orthogonal* before “Sam” and `#vect`?')).toEqual(['orthogonal', 'Sam', '#vect']);
    expect(markPieces('What orthogonality means, and Orthogonal', ['orthogonal'])).toEqual([
      { text: 'What ', mark: false },
      { text: 'orthogonality', mark: true },
      { text: ' means, and ', mark: false },
      { text: 'Orthogonal', mark: true },
    ]);
    expect(markPieces('Nothing here', [])).toEqual([{ text: 'Nothing here', mark: false }]);
  });
});

describe('the instructions', () => {
  it('their own examples read as an answer card, and their chart as a chart', () => {
    const a = answerOf([ASK_INSTRUCTIONS])!;
    expect(a.asked).toBe('Why does Sam lie to Ada about the letter in chapter 4?');
    expect(a.answer).toMatch(/^To protect his brother/);
    expect(a.sure?.level).toBe('fairly');
    expect(a.where.map((p) => p.place)).toEqual(['chapters/03-harbour.typ:88', 'chapters/04-storm.typ:112-118']);
    expect(a.next).toEqual([
      { text: 'Does Ada ever find out?', mode: null },
      { text: 'Should the promise be clearer in chapter 3?', mode: 'discuss' },
    ]);
    expect(a.changes).toHaveLength(1);
    const chart = proseAndCharts(ASK_INSTRUCTIONS).charts[0];
    expect(parseChart(chart.body)?.bars.filter((b) => b.on).map((b) => b.label)).toEqual(['Ch 4']);
  });

  it('the messages the card sends', () => {
    expect(meantMessage(' Is it too long for what it covers? ')).toBe('I meant: Is it too long for what it covers?');
    expect(changePrompt({ at: 'chapters/04-storm.typ:114', find: 'a', replace: 'b', why: 'Show him hiding it.' })).toBe(
      'Make just this one change from your answer, and nothing else, in chapters/04-storm.typ:114: replace “a” with “b” (Show him hiding it). If those words have changed since, make the same change to the passage as it is now. Afterwards, say in a sentence what you changed.',
    );
  });
});
