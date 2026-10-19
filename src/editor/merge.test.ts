import { describe, expect, it } from 'vitest';
import { includes, merge3, reconcile } from './merge';

const para = (...ps: string[]) => `${ps.join('\n\n')}\n`;

const base = para('= Chapter One', 'The sky was grey and the sea was calm.', 'Anna walked to the harbour every morning.', 'Nobody knew why she waited.');

describe('merge3', () => {
  it('keeps both sides when they changed different paragraphs', () => {
    const mine = base.replace('every morning', 'every single morning');
    const theirs = base.replace('grey', 'gray');
    const r = merge3(base, mine, theirs);
    expect(r.text).toBe(base.replace('every morning', 'every single morning').replace('grey', 'gray'));
    expect(r.conflicts).toEqual([]);
    expect(r.regions.map((x) => x.kind)).toEqual(['theirs', 'mine']);
  });

  it('merges word by word inside one paragraph (one line)', () => {
    const mine = base.replace('The sky', 'That morning the sky');
    const theirs = base.replace('the sea was calm', 'the sea lay calm');
    const r = merge3(base, mine, theirs);
    expect(r.text).toContain('That morning the sky was grey and the sea lay calm.');
    expect(r.conflicts).toEqual([]);
    expect(r.regions.map((x) => x.kind)).toEqual(['both']);
  });

  it('conflicts only where both changed the same words, keeping mine and naming theirs', () => {
    const mine = base.replace('grey', 'silver').replace('every morning', 'each morning');
    const theirs = base.replace('grey', 'leaden').replace('the sea was calm', 'the sea was still');
    const r = merge3(base, mine, theirs);
    expect(r.text).toContain('The sky was silver and the sea was still.');
    expect(r.text).toContain('each morning');
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0];
    expect(r.text.slice(c.start, c.end)).toBe(c.mine);
    expect(c.mine).toBe('The sky was silver and the sea was still.\n');
    expect(c.theirs).toBe('The sky was leaden and the sea was still.\n');
  });

  it('takes a change both sides made alike once', () => {
    const both = base.replace('Anna', 'Anne');
    const r = merge3(base, both, both.replace('Nobody', 'No one'));
    expect(r.text).toBe(both.replace('Nobody', 'No one'));
    expect(r.conflicts).toEqual([]);
  });

  it('keeps paragraphs each side added in different places', () => {
    const mine = base.replace('Anna walked', 'A gull cried.\n\nAnna walked');
    const theirs = `${base}\nThe end.\n`;
    const r = merge3(base, mine, theirs);
    expect(r.text).toBe(`${mine}\nThe end.\n`);
    expect(r.conflicts).toEqual([]);
  });

  it('keeps a paragraph added right after one the other side rewrote', () => {
    const mine = base.replace('Anna walked to the harbour every morning.', 'Anna went down to the harbour each dawn.');
    const theirs = base.replace('Anna walked to the harbour every morning.\n', 'Anna walked to the harbour every morning.\n\nShe wore a red coat.\n');
    const r = merge3(base, mine, theirs);
    expect(r.text).toContain('Anna went down to the harbour each dawn.\n\nShe wore a red coat.\n');
    expect(r.conflicts).toEqual([]);
  });

  it('conflicts when both added different text at the same place', () => {
    const r = merge3('a\n', 'a\nmine\n', 'a\ntheirs\n');
    expect(r.text).toBe('a\nmine\n');
    expect(r.conflicts).toEqual([{ start: 2, end: 7, mine: 'mine\n', theirs: 'theirs\n' }]);
  });

  it('conflicts when one side deleted a paragraph the other changed', () => {
    const mine = base.replace('Nobody knew why she waited.', 'Nobody ever knew why she waited.');
    const theirs = base.replace('\nNobody knew why she waited.\n', '');
    const r = merge3(base, mine, theirs);
    expect(r.text).toBe(mine);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].theirs).toBe('');
  });

  it('handles empty texts and texts without a final newline', () => {
    expect(merge3('', '', 'new').text).toBe('new');
    expect(merge3('', 'mine', '').text).toBe('mine');
    expect(merge3('a\nb', 'a\nB', 'A\nb').text).toBe('A\nB');
    expect(merge3('x', 'x', 'x')).toEqual({ text: 'x', conflicts: [], regions: [] });
  });

  it('keeps CRLF line endings as they are', () => {
    const b = 'one\r\ntwo\r\nthree\r\n';
    expect(merge3(b, b.replace('one', 'ONE'), b.replace('three', 'THREE')).text).toBe('ONE\r\ntwo\r\nTHREE\r\n');
  });

  it('keeps every word of both sides on a long merge (no text lost)', () => {
    const many = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} says something.`);
    const b = para(...many);
    const m = para(...many.map((p, i) => (i % 7 === 0 ? `${p} Mine ${i}.` : p)));
    const t = para(...many.map((p, i) => (i % 11 === 0 ? p.replace('says', 'said') : p)));
    const r = merge3(b, m, t);
    for (let i = 0; i < 400; i++) {
      if (i % 7 === 0) expect(r.text).toContain(`Mine ${i}.`);
      if (i % 11 === 0) expect(r.text).toContain(`Paragraph ${i} said`);
    }
    expect(r.conflicts).toEqual([]);
  });
});

describe('includes', () => {
  it('is true when theirs was made from mine', () => {
    const mine = base.replace('grey', 'gray');
    expect(includes(base, mine, mine.replace('Anna', 'Anne'))).toBe(true);
  });

  it('is false when theirs lacks a change of mine (made from the older text)', () => {
    const mine = base.replace('grey', 'gray');
    expect(includes(base, mine, base.replace('Anna', 'Anne'))).toBe(false);
  });

  it('is true when mine changed nothing', () => {
    expect(includes(base, base, 'anything')).toBe(true);
  });
});

describe('reconcile', () => {
  const agentFix = (t: string) => t.replace('Nobody knew', 'No one knew');

  it('merges an assistant edit into a buffer with unsaved edits elsewhere', () => {
    const buffer = base.replace('grey', 'silver');
    const r = reconcile({ seen: base, disk: base, buffer, incoming: agentFix(base) });
    expect(r.text).toBe(agentFix(buffer));
    expect(r.questions).toEqual([]);
    expect(r.repair).toBeNull();
  });

  it('asks where the assistant and the unsaved edit changed the same words; the buffer keeps the author’s', () => {
    const buffer = base.replace('Nobody knew', 'Nobody guessed');
    const r = reconcile({ seen: base, disk: base, buffer, incoming: base.replace('Nobody knew', 'Nobody understood') });
    expect(r.text).toBe(buffer);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]).toMatchObject({ kind: 'clash', mine: 'Nobody guessed why she waited.\n', theirs: 'Nobody understood why she waited.\n' });
    expect(r.text.slice(r.questions[0].start, r.questions[0].end)).toBe(r.questions[0].mine);
  });

  it('different words of one sentence are no conflict', () => {
    const buffer = base.replace('Nobody knew', 'Nobody guessed');
    const r = reconcile({ seen: base, disk: base, buffer, incoming: agentFix(base) });
    expect(r.text).toBe(base.replace('Nobody knew', 'No one guessed'));
    expect(r.questions).toEqual([]);
  });

  it('a clean buffer simply takes the new text', () => {
    const r = reconcile({ seen: base, disk: base, buffer: base, incoming: agentFix(base) });
    expect(r).toEqual({ text: agentFix(base), questions: [], repair: null });
  });

  it('new text made from the save (the assistant read it again) merges as usual', () => {
    const saved = base.replace('grey', 'silver');
    const r = reconcile({ seen: base, disk: saved, buffer: saved, incoming: agentFix(saved) });
    expect(r).toEqual({ text: agentFix(saved), questions: [], repair: null });
  });

  it('new text made from an older copy keeps the author’s save, in the buffer and back on disk', () => {
    const saved = base.replace('grey', 'silver');
    const incoming = agentFix(base); // written from the copy read before the save
    const r = reconcile({ seen: base, disk: saved, buffer: saved, incoming });
    expect(r.text).toBe(agentFix(saved));
    expect(r.repair).toBe(agentFix(saved));
    // The save's paragraph wasn't in their text: asked, with theirs being without it.
    expect(r.questions).toEqual([expect.objectContaining({ kind: 'kept', mine: 'The sky was silver and the sea was calm.\n', theirs: 'The sky was grey and the sea was calm.\n' })]);
  });

  it('an older copy plus unsaved typing: both kept, and only the saved text goes back on disk', () => {
    const saved = base.replace('grey', 'silver');
    const buffer = saved.replace('every morning', 'each morning');
    const incoming = agentFix(base);
    const r = reconcile({ seen: base, disk: saved, buffer, incoming });
    expect(r.text).toBe(agentFix(buffer));
    expect(r.repair).toBe(agentFix(saved));
    const q = r.questions[0];
    expect(r.text.slice(q.start, q.end)).toBe(q.mine);
  });

  it('a paragraph saved during the turn that the older copy lacks stays, and is asked about', () => {
    const saved = base.replace('Nobody knew', 'A gull cried.\n\nNobody knew');
    const incoming = base.replace('grey', 'gray');
    const r = reconcile({ seen: base, disk: saved, buffer: saved, incoming });
    expect(r.text).toBe(saved.replace('grey', 'gray'));
    expect(r.repair).toBe(r.text);
    expect(r.questions).toEqual([expect.objectContaining({ kind: 'kept', mine: 'A gull cried.\n\n', theirs: '' })]);
  });
});
