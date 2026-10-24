import { describe, expect, it } from 'vitest';
import { chartNumber, chartValue, chartWords, parseChart } from './chart';

describe('parseChart', () => {
  it('reads a title, a unit, reference lines and bars, the marked ones on', () => {
    expect(parseChart('title: Chapters by length\nunit: words\nmark: 10,087 | middle\nbar: Ch 1 | 8,775\nbar: Ch 13 | 13188 | *\n')).toEqual({
      title: 'Chapters by length',
      unit: 'words',
      marks: [{ value: 10087, label: 'middle' }],
      bars: [
        { label: 'Ch 1', value: 8775, on: false },
        { label: 'Ch 13', value: 13188, on: true },
      ],
    });
  });

  it('a line "label | value" is a bar; percentages give the unit', () => {
    expect(parseChart('Sam | 40%\nAda | 12.5%')).toMatchObject({ unit: '%', bars: [{ label: 'Sam', value: 40 }, { label: 'Ada', value: 12.5 }] });
  });

  it('nothing it can’t read: no bars, a word for a number, below zero, prose', () => {
    expect(parseChart('title: Nothing')).toBeNull();
    expect(parseChart('bar: a | many')).toBeNull();
    expect(parseChart('bar: a | -3')).toBeNull();
    expect(parseChart('bar: a | 3\nThe rest is prose.')).toBeNull();
    expect(parseChart(Array.from({ length: 61 }, (_, i) => `bar: ${i} | ${i}`).join('\n'))).toBeNull();
  });
});

describe('numbers', () => {
  it('reads numbers as written', () => {
    expect(chartNumber('13,188')).toBe(13188);
    expect(chartNumber('1 204')).toBe(1204);
    expect(chartNumber('.5')).toBe(0.5);
    expect(chartNumber('12 words')).toBeNull();
  });

  it('says them, and the chart, in words', () => {
    expect(chartValue(13188)).toBe('13,188');
    expect(chartValue(4.567)).toBe('4.57');
    expect(chartValue(42, '%')).toBe('42%');
    expect(chartWords(parseChart('title: Lengths\nunit: words\nmark: 5 | middle\nbar: a | 4\nbar: b | 6')!)).toBe('Lengths. a: 4 words; b: 6 words. middle at 5');
  });
});
