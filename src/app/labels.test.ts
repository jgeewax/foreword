import { describe, expect, it } from 'vitest';
import { labelPlaces, prose, referenceAt } from './labels';

describe('referenceAt', () => {
  const LINE = 'As @ch:matrices-as-functions showed, and @fig-1[Figure] and #ref(<eq-2>, form: "page").';
  const ref = (text: string, offset = 1) => referenceAt(LINE, LINE.indexOf(text) + offset);

  it('finds the @reference a place is in, all of its name', () => {
    expect(ref('matrices')).toEqual({ name: 'ch:matrices-as-functions', start: 3, end: 28 });
    expect(ref('functions', 9)?.name).toBe('ch:matrices-as-functions');
    expect(ref('@ch', 0)?.name).toBe('ch:matrices-as-functions');
  });

  it('leaves out a supplement and a final full stop or colon', () => {
    expect(ref('fig-1')).toMatchObject({ name: 'fig-1', end: LINE.indexOf('[Figure]') });
    expect(referenceAt('See @sec-intro.', 6)).toEqual({ name: 'sec-intro', start: 4, end: 14 });
    expect(referenceAt('In @sec-a: b', 5)?.name).toBe('sec-a');
  });

  it('finds a label given to a call', () => {
    expect(ref('eq-2')).toEqual({ name: 'eq-2', start: LINE.indexOf('<eq-2>'), end: LINE.indexOf('<eq-2>') + 6 });
  });

  it('finds nothing elsewhere, or on a label put on something, or an escaped @', () => {
    expect(ref('showed')).toBeNull();
    expect(referenceAt('= Intro <intro>', 10)).toBeNull();
    expect(referenceAt('mail me \\@home', 11)).toBeNull();
  });
});

describe('labelPlaces', () => {
  const TEXT = `= Vectors <ch-vectors>

// A note: <ch-vectors> is the chapter's label.
\`\`\`typ
= Example <ch-vectors>
\`\`\`
$ x <ch-vectors> y $

#figure(
  image("a.png"),
) <fig-a>
See @fig-a and #ref(<fig-a>).`;

  it('finds where a label is put on something', () => {
    expect(labelPlaces(TEXT, 'ch-vectors')).toEqual([{ start: 10, end: 22 }]);
    const at = TEXT.indexOf('<fig-a>');
    expect(labelPlaces(TEXT, 'fig-a')).toEqual([{ start: at, end: at + 7 }]);
  });

  it('leaves out references, comments, raw blocks and maths', () => {
    expect(labelPlaces(TEXT, 'fig-a')).toHaveLength(1);
    expect(labelPlaces(TEXT, 'ch-vectors')).toHaveLength(1);
    expect(labelPlaces(TEXT, 'nowhere')).toEqual([]);
  });
});

describe('prose', () => {
  it('keeps every place where it is', () => {
    const text = 'a /* B\nC */ d // E\n```\nF\n``` $ G\nH $ <i> `$` http://x';
    const out = prose(text);
    expect(out).toHaveLength(text.length);
    expect(out.split('\n').map((l) => l.length)).toEqual(text.split('\n').map((l) => l.length));
    expect(out.indexOf('<i>')).toBe(text.indexOf('<i>'));
    expect(out).toContain('`$` http://x');
    expect(out).not.toMatch(/[BCEFGH]/);
  });
});
