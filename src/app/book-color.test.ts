import { describe, expect, it } from 'vitest';
import { bookPalette, effectiveBookColor, isLight, lighten, normalizeHex, peacockColor, randomBookColor, spin } from './book-color';

describe('a book’s colour', () => {
  it('gives the window Peacock’s shades', () => {
    // As Peacock wrote them for the author's own books (#00ad9f, #22c55e).
    expect(bookPalette('#00ad9f')).toMatchObject({ '--book': '#00ad9f', '--book-fg': '#e7e7e7', '--book-bar': '#00e0ce', '--book-bar-fg': '#15202b', '--book-badge': '#ed20ff', '--book-hover': '#00e0ce' });
    expect(bookPalette('#22c55e')).toMatchObject({ '--book-fg': '#15202b', '--book-bar': '#3ddd78', '--book-badge': '#8e5ce2', '--book-hover': '#1a9949' });
    expect(bookPalette('#22c55e')['--book-fg-dim']).toBe('#15202b99');
  });

  it('works out shades and text', () => {
    expect(lighten('#000000', 50)).toBe('#808080');
    expect(lighten('#ffffff', -100)).toBe('#000000');
    expect(spin('#ff0000', 120)).toBe('#00ff00');
    expect(isLight('#ffca28')).toBe(true);
    expect(isLight('#3776ab')).toBe(false);
    expect(normalizeHex('#0AD')).toBe('#00aadd');
    expect(normalizeHex('teal')).toBeNull();
    for (let i = 0; i < 20; i++) expect(normalizeHex(randomBookColor())).not.toBeNull();
  });

  it('reads Peacock’s colour from VS Code’s settings, comments and all', () => {
    expect(peacockColor('{\n  // the window\n  "workbench.colorCustomizations": { "titleBar.activeBackground": "#00ad9f", },\n  "peacock.color": "#00AD9F", /* teal */\n}')).toBe('#00ad9f');
    expect(peacockColor('{ "url": "http://example.com/a//b", "peacock.color": "#123456" }')).toBe('#123456');
    expect(peacockColor('{ "editor.fontSize": 13 }')).toBeNull();
    expect(peacockColor('not json')).toBeNull();
    expect(peacockColor(null)).toBeNull();
  });

  it('wears the book’s own colour, else Peacock’s, unless it says none', () => {
    expect(effectiveBookColor('#2f6fde', '#00ad9f')).toBe('#2f6fde');
    expect(effectiveBookColor(undefined, '#00ad9f')).toBe('#00ad9f');
    expect(effectiveBookColor('none', '#00ad9f')).toBeNull();
    expect(effectiveBookColor(undefined, null)).toBeNull();
  });
});
