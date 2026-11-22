import { describe, expect, it } from 'vitest';
import { BOOK_COLORS } from './book-color';
import { colorFromWords } from './color-words';
import { MARK_COLORS } from './settings';

const BLUE = '#2f6fde';
const PINK = '#d0457f';
const read = (text: string, current: string | null = BLUE) => colorFromWords(text, current, BOOK_COLORS, () => 0.5);
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
const brightness = (hex: string) => [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0);

describe('a colour in words', () => {
  it('names the setting’s own swatch first', () => {
    expect(read('pink')).toMatchObject({ color: PINK, read: 'Pink' });
    expect(colorFromWords('pink', BLUE, MARK_COLORS).color).toBe('#db61a2');
    // Not CSS's pink, which is nearly white.
    expect(read('yellow').color).toBe('#e8c22e');
    expect(read('hot pink')).toMatchObject({ color: '#ff4fa3', read: 'Hot pink' });
    expect(read('more like the sea, please')).toMatchObject({ color: '#2e8bab', read: 'Sea' });
    expect(read('the colour of grass').color).toBe('#4caf3a');
    expect(read('blues').color).toBe(BLUE);
  });

  it('changes the colour shown, or the one named', () => {
    const brighter = read('brighter pink please');
    expect(brighter.read).toBe('Brighter pink');
    expect(brightness(brighter.color!)).toBeGreaterThan(brightness(PINK));
    // A pink already shown is the pink made brighter.
    expect(read('brighter pink', '#e05a95').color).not.toBe(brighter.color);
    expect(Math.abs(hue(read('brighter pink', '#e05a95').color!) - hue('#e05a95'))).toBeLessThan(2);
    expect(read('a bit darker', PINK).read).toBe('A bit darker');
    expect(brightness(read('much darker', PINK).color!)).toBeLessThan(brightness(read('a bit darker', PINK).color!));
    expect(read('too bright', PINK).read).toBe('Less bright');
    expect(read('not bright enough', PINK).color).toBe(read('brighter', PINK).color);
    expect(read('make it pop', PINK).read).toBe('More vivid');
    expect(read('tone it down', PINK).read).toBe('Muted');
    expect(read('20% darker', PINK).read).toBe('20% darker');
    expect(read('light blue', PINK).read).toBe('Light blue');
  });

  it('turns it round the wheel', () => {
    // Pink towards blue goes purple, not round through orange.
    const bluer = read('more blue', PINK).color!;
    expect(hue(bluer)).toBeLessThan(hue(PINK));
    expect(hue(bluer)).toBeGreaterThan(280);
    expect(read('bluer', PINK).color).toBe(bluer);
    expect(read('less blue', '#0d98a0').read).toBe('Less blue');
    expect(hue(read('warmer', '#808080').color!)).toBeCloseTo(30, -1);
    expect(read('the opposite', PINK).read).toBe('The opposite');
    expect(Math.round(hue(read('the opposite', PINK).color!) - hue(PINK) + 360) % 360).toBe(180);
  });

  it('mixes colours', () => {
    const teal = hue(read('blue and green').color!);
    expect(teal).toBeGreaterThan(hue('#2f9e57'));
    expect(teal).toBeLessThan(hue(BLUE));
    expect(read('bluish green').read).toBe('Bluish green');
    expect(hue(read('bluish green').color!)).toBeLessThan(teal);
  });

  it('takes a colour given whole', () => {
    expect(read('#2F6FDE')).toMatchObject({ color: BLUE, read: BLUE });
    expect(read('2f6fde').color).toBe(BLUE);
    expect(read('rgb(47, 111, 222)').color).toBe(BLUE);
    expect(read('#2f6fde but darker').read).toBe('#2f6fde, darker');
    // A number isn't a colour.
    expect(read('100 percent').color).toBeNull();
  });

  it('forgives a slip of the keys and letters held down', () => {
    expect(read('brigther', PINK).color).toBe(read('brighter', PINK).color);
    expect(read('purpel').color).toBe('#8e44ad');
    expect(read('brighterrr', PINK).color).toBe(read('brighter', PINK).color);
  });

  it('says what it didn’t know, and when there’s nothing to change', () => {
    expect(read('pinj')).toEqual({ color: null, read: '', unknown: ['pinj'] });
    expect(read('brighter pinj', PINK)).toMatchObject({ read: 'Brighter', unknown: ['pinj'] });
    expect(read('brighter', null)).toMatchObject({ color: null, read: 'Brighter than what? Name a colour too, as in “brighter pink”.' });
    expect(read('', PINK).color).toBeNull();
  });

  it('picks one at random when asked', () => {
    let n = 0;
    const steps = [0.1, 0.9, 0.2];
    const surprise = colorFromWords('surprise me', PINK, BOOK_COLORS, () => steps[n++ % 3]);
    expect(surprise).toMatchObject({ read: 'A colour at random' });
    expect(surprise.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(read('a different pink', PINK).read).toBe('Another pink');
  });
});
