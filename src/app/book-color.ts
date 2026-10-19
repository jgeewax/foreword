// A book's own colour on its window's title bar, activity bar and status bar,
// as VS Code's Peacock does, so a glance tells one book's window from
// another's. The shades are Peacock's: the colour on the title and status
// bars, 10% lighter on the activity bar, badges a third of the way round the
// colour wheel from that (as light as stands out), and text light or dark by
// how bright each is.

/** Swatches to pick from: mid-tones that read in light and dark windows. */
export const BOOK_COLORS: { name: string; color: string }[] = [
  { name: 'Red', color: '#c8414b' },
  { name: 'Orange', color: '#dd6b20' },
  { name: 'Gold', color: '#d4a20b' },
  { name: 'Green', color: '#2f9e57' },
  { name: 'Teal', color: '#00a396' },
  { name: 'Blue', color: '#2f6fde' },
  { name: 'Indigo', color: '#5a4fcf' },
  { name: 'Purple', color: '#8e44ad' },
  { name: 'Pink', color: '#d0457f' },
  { name: 'Slate', color: '#56697d' },
];

/** Peacock's text colours: light on a dark colour, dark on a light one. */
const LIGHT_TEXT = '#e7e7e7';
const DARK_TEXT = '#15202b';

const HEX = /^#[0-9a-f]{6}$/i;

/** "#00AD9F" or "#0ad" → "#00ad9f"; null for anything else. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`;
  return HEX.test(v) ? v : null;
}

type Rgb = [number, number, number];
type Hsl = [number, number, number];

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')}`;

function toHsl([r, g, b]: Rgb): Hsl {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function fromHsl([h, s, l]: Hsl): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
/** tinycolor (Peacock's) keeps saturation and lightness to a hundredth of a percent on the way back to RGB. */
const hundredths = (n: number) => Math.floor(n * 10000) / 10000;
const back = ([h, s, l]: Hsl) => toHex(fromHsl([h, hundredths(s), hundredths(l)]));

/** Lighter (or darker, for a negative amount) by `amount` of lightness, as tinycolor's lighten. */
export function lighten(hex: string, amount: number): string {
  const [h, s, l] = toHsl(rgb(hex));
  return back([h, s, clamp01(l + amount / 100)]);
}

/** The hue turned `degrees` round the colour wheel. */
export function spin(hex: string, degrees: number): string {
  const [h, s, l] = toHsl(rgb(hex));
  return back([(h + degrees + 360) % 360, s, l]);
}

/** Bright enough for dark text on it (tinycolor's isLight: perceived brightness of half or more). */
export function isLight(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128;
}

/** WCAG contrast between two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = rgb(hex).map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * A badge on the activity bar, as Peacock makes it: the bar's colour turned a
 * third of the way round the wheel, at the lightness (in sixteenths) closest
 * to the bar's that still stands out from it (2:1).
 */
function badgeOn(bar: string): string {
  const [h0, s0, l0] = toHsl(rgb(spin(bar, 120)));
  const h = s0 === 0 ? 60 * Math.round(6 * l0) : h0;
  const s = s0 < 0.15 ? 0.5 : s0;
  const shades = Array.from({ length: 16 }, (_, k) => toHex(fromHsl([h, s, 0.0625 * k]))).map((hex) => ({ hex, contrast: contrast(hex, bar) }));
  return shades.sort((a, b) => a.contrast - b.contrast).find((c) => c.contrast >= 2)?.hex ?? '#ffffff';
}

const textOn = (hex: string) => (isLight(hex) ? DARK_TEXT : LIGHT_TEXT);
/** Peacock's "inactive" text: the text colour at 60% (its `99` alpha). */
const dim = (hex: string) => `${hex}99`;

/** The window's shades of a book's colour, as CSS custom properties. */
export function bookPalette(color: string): Record<string, string> {
  const base = normalizeHex(color) ?? '#000000';
  const bar = lighten(base, 10);
  const badge = badgeOn(bar);
  return {
    '--book': base,
    '--book-fg': textOn(base),
    '--book-fg-dim': dim(textOn(base)),
    '--book-hover': isLight(base) ? lighten(base, -10) : lighten(base, 10),
    '--book-bar': bar,
    '--book-bar-fg': textOn(bar),
    '--book-bar-fg-dim': dim(textOn(bar)),
    '--book-badge': badge,
    '--book-badge-fg': textOn(badge),
  };
}

/** A colour of its own, at random, for "Surprise me": bright enough to see, not so bright it glares. */
export function randomBookColor(random = Math.random): string {
  return toHex(fromHsl([Math.floor(random() * 360), 0.55 + random() * 0.3, 0.38 + random() * 0.14]));
}

/**
 * Peacock's colour from a VS Code settings file (`.vscode/settings.json`,
 * which may have comments and trailing commas), or null.
 */
export function peacockColor(settingsText: string | null): string | null {
  if (!settingsText) return null;
  const json = settingsText
    // Comments out, leaving strings alone.
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, str: string | undefined) => str ?? '')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return normalizeHex(parsed?.['peacock.color']);
  } catch {
    return null;
  }
}

/**
 * The colour the window wears: the book's own (Settings ▸ This book ▸
 * Colour), else Peacock's from its VS Code settings; "none" in the book's
 * settings turns Peacock's off too.
 */
export function effectiveBookColor(own: string | undefined, peacock: string | null): string | null {
  if (own === 'none') return null;
  return normalizeHex(own) ?? peacock;
}
