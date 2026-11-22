// A colour said in words, as typed into a colour setting: "brighter pink
// please", "a bit darker", "bluish green", "more like the sea", "#2f6fde".
// Read here, at each key, with no assistant: names (the setting's own
// swatches first, then everyday names, things, and CSS's), changes to the
// colour shown (brighter, darker, warmer, more blue), and words for how much
// (a bit, much, 20%). Words it doesn't know are left out and named.

type Hsl = [number, number, number];

/** How a colour came out of the words, or (color null) why it didn't. */
export type ColorReading = { color: string | null; read: string; unknown: string[] };

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => `#${c.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')}`;

function toHsl(hex: string): Hsl {
  const [R, G, B] = rgb(hex).map((n) => n / 255);
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function fromHsl([h, s, l]: Hsl): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
/** From hue a to hue b the short way round: −180 to 180. */
const hueGap = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/**
 * Everyday names, as mid-tones that read on a window's bars (CSS's "pink" is
 * nearly white, its "lime" glares), and things with a colour: the sea, a banana.
 */
const NAMES: Record<string, string> = {
  red: '#d33a3a', orange: '#e8772e', yellow: '#e8c22e', gold: '#d4a20b', green: '#2f9e57', teal: '#00a396', cyan: '#17a8c4',
  blue: '#2f6fde', indigo: '#5a4fcf', purple: '#8e44ad', violet: '#8b5cf6', pink: '#e0559a', magenta: '#c42e9e', fuchsia: '#d1349b',
  brown: '#8b5a2b', grey: '#808080', gray: '#808080', black: '#141414', white: '#ffffff', lime: '#7cc23a', lavender: '#a98bd8',
  chartreuse: '#8fcc2f', aqua: '#17b8c9', chocolate: '#6b3e26', beige: '#e3d5b8', cream: '#f3e9cf', ivory: '#f6f1df',
  // Things.
  sea: '#2e8bab', ocean: '#1d5f8a', sky: '#5aa9e6', night: '#1e2a4a', midnight: '#1e2a4a', grass: '#4caf3a', leaf: '#5a9e2f',
  forest: '#2d6a3e', moss: '#6b7f3a', sage: '#8fa982', mint: '#5fc9a0', jade: '#00a86b', emerald: '#1f9d55', pine: '#2b5f3f',
  avocado: '#6e8b3d', pistachio: '#93c572', seafoam: '#6fd1b0', banana: '#f2d24b', lemon: '#f2d335', sun: '#f6c33b',
  sunshine: '#f6c33b', sunflower: '#f4c21c', mustard: '#d4a72c', honey: '#e0a526', amber: '#f0a020', apricot: '#f3a96b',
  peach: '#f6a37f', tangerine: '#f28a1d', pumpkin: '#e8731f', carrot: '#ed7d31', sunset: '#f26b4a', rust: '#b7472a',
  brick: '#a8432f', terracotta: '#c8653f', copper: '#b87333', bronze: '#a97142', sand: '#d6b98a', caramel: '#c27c3a',
  coffee: '#6f4e37', mocha: '#7b5a46', cherry: '#c2273b', strawberry: '#e0405a', raspberry: '#c72c5c', ruby: '#b3123a',
  wine: '#722f37', burgundy: '#800020', blood: '#8a0303', fire: '#e2482a', flame: '#e25822', rose: '#e05780', blush: '#de8fa6',
  bubblegum: '#f07ab4', flamingo: '#f2789f', lilac: '#b69ad6', mauve: '#b07ca8', plum: '#8e4585', grape: '#6f2da8',
  eggplant: '#5b2a52', aubergine: '#5b2a52', amethyst: '#9966cc', periwinkle: '#8c94e8', cornflower: '#6495ed', denim: '#3b5f9a',
  navy: '#1f3a6e', cobalt: '#0047ab', sapphire: '#0f52ba', royal: '#3256c8', steel: '#4682b4', slate: '#56697d',
  charcoal: '#36454f', graphite: '#474a51', ash: '#9a9a96', stone: '#8a8580', smoke: '#8a8d91', silver: '#aab0b6',
  pearl: '#e8e4da', turquoise: '#2ec4b6', cerulean: '#2a7fbd', peacock: '#0f7f8a', petrol: '#1e5b66', ink: '#23304a',
  ochre: '#c7862a', olive: '#7a7a2e', khaki: '#c3b091', tan: '#d2b48c', salmon: '#f08070', coral: '#f07a5a', tomato: '#e5533d',
  crimson: '#c8102e', scarlet: '#e0241b', maroon: '#800000', orchid: '#da70d6', thistle: '#c9a9c9', wheat: '#e8d3a2',
  // Two words, written together ("hot pink" is looked up as "hotpink").
  hotpink: '#ff4fa3', bluegreen: '#0d98a0', babyblue: '#89c4f4', babypink: '#f4b6c8', skyblue: '#5aa9e6', royalblue: '#3256c8',
  navyblue: '#1f3a6e', forestgreen: '#2d6a3e', seagreen: '#2e8b57', limegreen: '#5cb82e', mintgreen: '#5fc9a0', olivegreen: '#6b7a2e',
  burntorange: '#cc5500', dustyrose: '#c48b94', peacockblue: '#0f7f8a', bottlegreen: '#0b5b3a', racinggreen: '#124f32',
  electricblue: '#1f7fff', neongreen: '#39e75f', neonpink: '#ff3ea5', bloodred: '#8a0303', firetruckred: '#d8261d',
  firetruck: '#d8261d', postbox: '#d8261d', pillarbox: '#d8261d', tiffany: '#0abab5', tiffanyblue: '#0abab5', duckegg: '#a8d5cf',
  eggshell: '#efe8d4', robinsegg: '#7fd1d0', cornflowerblue: '#6495ed', dodgerblue: '#1e90ff', steelblue: '#4682b4',
  cadetblue: '#5f9ea0', slateblue: '#6a5acd', slategrey: '#56697d', slategray: '#56697d', springgreen: '#2fd07d',
  yellowgreen: '#9acd32', orangered: '#f0451c', indianred: '#cd5c5c', firebrick: '#b22222', rebeccapurple: '#663399',
  saddlebrown: '#8b4513', sandybrown: '#f4a460', rosybrown: '#bc8f8f', goldenrod: '#daa520', sienna: '#a0522d', peru: '#cd853f',
  powderblue: '#a8d8e0', aquamarine: '#5fd9b0', mistyrose: '#f7d4d0', seashell: '#f7ebe3', linen: '#f5efe6', snow: '#fbf8f8',
  midnightblue: '#191970', bubblegumpink: '#f07ab4', golden: '#d9a62e', fiery: '#e2482a', offwhite: '#f2efe6', fuschia: '#d1349b', fusia: '#d1349b',
};

type Op =
  | { kind: 'shade'; ds: number; dl: number; set?: Partial<{ s: number; l: number }>; word: [string, string] }
  | { kind: 'hue'; toward: number; step: number; word: [string, string] };

/** Changes to a colour, and how they read back (as asked, then the other way: "less bright"). */
const SHADES: Record<string, Op> = {};
const shade = (words: string[], ds: number, dl: number, word: [string, string], set?: Partial<{ s: number; l: number }>) => {
  for (const w of words) SHADES[w] = { kind: 'shade', ds, dl, set, word };
};
shade(['brighter', 'bright', 'brighten', 'brightened'], 0.15, 0.07, ['brighter', 'less bright']);
shade(['vivid', 'vivider', 'vibrant', 'saturated', 'bold', 'bolder', 'punchy', 'punchier', 'strong', 'stronger', 'intense', 'rich', 'richer', 'colourful', 'colorful', 'lively', 'livelier', 'pop', 'poppier', 'popping', 'loud', 'louder', 'juicy', 'juicier', 'zingy', 'zingier', 'cheerful', 'cheerier', 'happier', 'happy', 'sunnier'], 0.2, 0, ['more vivid', 'less vivid']);
shade(['lighter', 'light', 'lighten', 'airy', 'airier'], 0, 0.12, ['lighter', 'darker']);
shade(['paler', 'pale'], -0.1, 0.13, ['paler', 'less pale']);
shade(['darker', 'dark', 'darken', 'dim', 'dimmer', 'moodier', 'moody'], 0, -0.12, ['darker', 'lighter']);
shade(['deeper', 'deep', 'deepen'], 0.08, -0.1, ['deeper', 'less deep']);
shade(['muted', 'mute', 'duller', 'dull', 'softer', 'soft', 'subtle', 'subtler', 'subdued', 'calmer', 'calm', 'quieter', 'quiet', 'greyer', 'grayer', 'greyish', 'grayish', 'desaturated', 'gentler', 'gentle', 'mellow', 'mellower', 'faded', 'earthy', 'earthier', 'sober', 'sombre', 'somber', 'toned', 'tamer', 'tame', 'washed', 'weaker', 'weak', 'sadder'], -0.18, 0, ['more muted', 'less muted']);
shade(['dusty', 'dustier', 'smoky', 'smokier'], -0.25, 0.03, ['dustier', 'less dusty']);
shade(['pastel', 'pastels'], 0, 0, ['pastel', 'less pastel'], { l: 0.8 });
shade(['neon', 'electric', 'fluorescent', 'fluoro', 'acid', 'glowing', 'glowy', 'garish', 'loudest'], 0, 0, ['neon', 'less neon'], { s: 1, l: 0.55 });
const hueShift = (words: string[], toward: number, step: number, word: [string, string]) => {
  for (const w of words) SHADES[w] = { kind: 'hue', toward, step, word };
};
hueShift(['warmer', 'warm', 'warmed', 'cosier', 'cozier', 'cosy', 'cozy'], 30, 18, ['warmer', 'cooler']);
hueShift(['cooler', 'cool', 'colder', 'cold', 'icier', 'icy', 'frostier', 'frosty'], 210, 18, ['cooler', 'warmer']);

/** How much: "a bit" brighter is half a step, "much" two. */
const AMOUNTS: Record<string, number> = {
  bit: 0.5, little: 0.5, slightly: 0.5, slight: 0.5, touch: 0.5, tad: 0.5, smidge: 0.5, smidgen: 0.5, hint: 0.5, tiny: 0.5,
  somewhat: 0.5, fraction: 0.5, kinda: 0.5, sorta: 0.5, bitty: 0.5, wee: 0.5, marginally: 0.5, mildly: 0.5,
  quite: 1.5, rather: 1.5, noticeably: 1.5, fairly: 1.2,
  much: 2, lot: 2, lots: 2, way: 2, very: 2, really: 2, super: 2, far: 2, loads: 2, heaps: 2, tons: 2, ton: 2, extra: 2,
  seriously: 2, considerably: 2, significantly: 2, massively: 2.5, hugely: 2.5, totally: 2, bunch: 2, waaay: 2.5, ultra: 2.5,
};

/** Words that ask, or say "make it", and nothing about the colour. */
const FILLER = new Set(
  (
    'please pls plz thanks thank thx ty you can could would will make made it its it’s this that these the a an i id i’d ' +
    'want wanted prefer love need go try use used give me us let lets let’s something some colour color colours colors shade ' +
    'shades tone tones tint tints hue one just kind sort of ish maybe perhaps how about what instead than now again even still and ' +
    'or but with in to be is was are yeah yes ok okay no nope hmm um uh so pretty nice nicer lovely good better best ' +
    'beautiful cute same as for my our window title bar bars book theme look looks looking feel feeling version variant ' +
    'hey hi there change switch turn into towards toward closer close get gets do does mix mixed ' +
    'blend between halfway half middle mid shot through tinge tinged sprinkle splash dash dose bring keep like'
  ).split(/\s+/),
);

/** Turns the colour round the wheel to its opposite. */
const OPPOSITE = new Set(['opposite', 'complementary', 'complement', 'inverse', 'inverted', 'invert']);
const RANDOM = new Set(['random', 'surprise', 'anything', 'whatever', 'randomly', 'any', 'different', 'another', 'other', 'else']);

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/;

/** A swatch's name, an everyday name or a thing's, or a CSS name: lower case, without spaces. */
function named(word: string, swatches: Map<string, string>): string | null {
  return swatches.get(word) ?? NAMES[word] ?? null;
}

/** "bluish" → "blue", "reddish" → "red", "pinky" → "pink", "bluer" → "blue": the name and how it's said. */
function stem(word: string, swatches: Map<string, string>): { name: string; color: string; form: 'ish' | 'er' } | null {
  const tries: [string, 'ish' | 'er'][] = [];
  for (const [end, form] of [['ish', 'ish'], ['ey', 'ish'], ['y', 'ish'], ['er', 'er']] as const) {
    if (!word.endsWith(end) || word.length < end.length + 3) continue;
    const root = word.slice(0, -end.length);
    tries.push([root, form], [`${root}e`, form]);
    // "reddish", "redder": the doubled letter goes.
    if (root.at(-1) === root.at(-2)) tries.push([root.slice(0, -1), form]);
  }
  for (const [name, form] of tries) {
    const color = named(name, swatches);
    if (color) return { name, color, form };
  }
  return null;
}

/** Off by one letter (a slip of the keys), for words of five letters or more. */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a.length < 5 || b.length < 5) return false;
  let i = 0;
  let j = 0;
  let slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++slips > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      // Two letters swapped count as one slip.
      if (a[i + 1] === b[j] && a[i] === b[j + 1]) {
        i++;
        j++;
      }
      i++;
      j++;
    }
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

type Mention = { name: string; color: string; weight: number; said: string };
/** A change, and the word typed for it when it reads back as typed ("light blue", "calmer"). */
type Change = { op: Op; amount: number; percent: number | null; typed: string | null };
type Shift = { name: string; color: string; amount: number };

const capital = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);
const NEGATE = new Set(['less', 'too', 'not', 'fewer', 'nor']);

/** Words that say what to do ("make it pop"), which read back as what it does ("more vivid"). */
const VERBS = new Set(['pop', 'popping', 'brighten', 'brightened', 'darken', 'lighten', 'deepen', 'mute', 'warmed', 'toned', 'washed', 'glowing']);

/** How a change reads back: "a bit brighter", "20% darker", "less bright", "light" as in "light blue". */
function said({ op, amount, percent, typed }: Change): string {
  const word = typed && amount === 1 && percent === null ? typed : op.word[amount < 0 ? 1 : 0];
  if (percent !== null) return `${percent}% ${word}`;
  return `${Math.abs(amount) <= 0.5 ? 'a bit ' : Math.abs(amount) >= 2 ? 'much ' : ''}${word}`;
}

function saidShift({ name, amount }: Shift): string {
  return `${Math.abs(amount) <= 0.5 ? 'a bit ' : Math.abs(amount) >= 2 ? 'much ' : ''}${amount < 0 ? 'less' : 'more'} ${name}`;
}

/**
 * The colour some words ask for. `current` is the colour shown (null for
 * none), which "brighter" changes; `swatches` are the setting's own, which
 * "pink" means before any other pink.
 */
export function colorFromWords(text: string, current: string | null, swatches: { name: string; color: string }[] = [], random: () => number = Math.random): ColorReading {
  const own = new Map(swatches.map((s) => [s.name.toLowerCase().replace(/\s+/g, ''), s.color.toLowerCase()]));
  const vocabulary = [...own.keys(), ...Object.keys(NAMES), ...Object.keys(SHADES)];
  const unknown: string[] = [];
  const mentions: Mention[] = [];
  const changes: Change[] = [];
  const shifts: Shift[] = [];
  let opposite = false;
  let randomly = false;
  let exact: string | null = null;

  const lowered = text.toLowerCase().replace(/['‘’]/g, '’');
  // "rgb(47, 111, 222)", "hsl(218 73% 53%)": a colour given whole.
  const fn = /\b(rgb|hsl)a?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?[^)]*\)/.exec(lowered);
  if (fn) {
    const [a, b, c] = [fn[2], fn[3], fn[4]].map(Number);
    exact = fn[1] === 'rgb' ? toHex([a, b, c]) : fromHsl([a % 360, clamp(b / 100), clamp(c / 100)]);
  }
  // Words, letters held down ("brighterrr", "waaay") let go, and a few sayings as the word they mean.
  const words = lowered
    .replace(/\b(rgb|hsl)a?\([^)]*\)/g, ' ')
    .replace(/\b(?:tone[ds]?|turn(?:ed)?|dial(?:led)?|bring|calm(?:ed)?)(?: it| that| this)? down\b|\bwashed[ -]out\b/g, ' muted ')
    .replace(/\b(?:turn(?:ed)?|crank(?:ed)?|dial(?:led)?|amp(?:ed)?|ramp(?:ed)?|pump(?:ed)?|juice)(?: it| that| this)? up\b/g, ' vivid ')
    .split(/[^a-z0-9#%’]+/)
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1{2,}/g, '$1'));

  // What the words so far say about the next change: how much, and which way.
  let amount = 1;
  let percent: number | null = null;
  let against = false; // "less", "too", "not": the other way.
  let more = false; // "more" before a name: towards it, not it.
  const take = () => {
    const out = { amount: against ? -amount : amount, percent };
    amount = 1;
    percent = null;
    against = false;
    more = false;
    return out;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const hex = HEX.exec(word);
    if (hex && (word.startsWith('#') || (hex[1].length === 6 && /\d/.test(word)))) {
      exact = `#${hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]}`;
      continue;
    }
    const number = /^(\d+(?:\.\d+)?)(%?)$/.exec(word);
    if (number) {
      // "20% brighter", "20 percent darker", "20 per cent".
      const next = words[i + 1];
      if (number[2] || next === 'percent' || (next === 'per' && words[i + 2] === 'cent')) percent = Math.min(100, Number(number[1]));
      if (next === 'percent') i++;
      else if (next === 'per' && words[i + 2] === 'cent') i += 2;
      continue;
    }
    if (NEGATE.has(word)) {
      against = !against;
      continue;
    }
    if (word === 'enough' && changes.length) {
      // "not bright enough": brighter after all.
      const last = changes[changes.length - 1];
      last.amount = Math.abs(last.amount);
      last.typed = null;
      continue;
    }
    if (word === 'more') {
      more = true;
      continue;
    }
    if (word === 'like' && more) {
      // "more like the sea": the sea.
      more = false;
      continue;
    }
    if (AMOUNTS[word] !== undefined) {
      amount = Math.min(3, amount * AMOUNTS[word]);
      continue;
    }
    if (OPPOSITE.has(word)) {
      opposite = true;
      continue;
    }
    if (RANDOM.has(word)) {
      // "any" only as "any colour" or at the end.
      if (word !== 'any' || !words[i + 1] || words[i + 1] === 'colour' || words[i + 1] === 'color') randomly = true;
      continue;
    }
    if (FILLER.has(word)) continue;

    // A name of up to three words, the longest first: "hot pink", "fire truck red".
    let found: Mention | null = null;
    for (let n = Math.min(3, words.length - i); n >= 1 && !found; n--) {
      // "light blue" is blue made lighter: those words change a colour, they don't name one.
      if (n > 1 && SHADES[words[i]]) continue;
      const name = words.slice(i, i + n).join(' ');
      const color = named(name.replace(/ /g, ''), own);
      if (color) {
        found = { name, color, weight: 1, said: name };
        i += n - 1;
      }
    }
    if (!found && word.endsWith('s') && named(word.slice(0, -1), own)) {
      // "blues", "greens".
      found = { name: word.slice(0, -1), color: named(word.slice(0, -1), own)!, weight: 1, said: word.slice(0, -1) };
    }
    if (!found && !SHADES[word]) {
      const stemmed = stem(word, own);
      if (stemmed?.form === 'er') {
        // "bluer": towards blue.
        shifts.push({ name: stemmed.name, color: stemmed.color, amount: take().amount });
        continue;
      }
      if (stemmed) found = { name: stemmed.name, color: stemmed.color, weight: 0.4, said: word };
    }
    if (found) {
      if (more || against) shifts.push({ name: found.name, color: found.color, amount: take().amount });
      else {
        mentions.push(found);
        amount = 1;
        percent = null;
      }
      continue;
    }
    let op = SHADES[word];
    if (!op) {
      // A slip of the keys: "brigther", "purpel".
      const near = vocabulary.find((v) => nearly(word, v));
      if (near && !SHADES[near]) {
        words[i] = near;
        i--;
        continue;
      }
      if (near) op = SHADES[near];
    }
    if (op) {
      const negated = against;
      const comparing = more;
      const a = take();
      // "20% darker": that much lightness (or strength, for "more vivid").
      const step = op.kind === 'shade' ? Math.max(Math.abs(op.dl), Math.abs(op.ds)) : 0;
      changes.push({ op, amount: a.percent !== null && step ? (Math.sign(a.amount) * a.percent) / 100 / step : a.amount, percent: a.percent, typed: negated || VERBS.has(words[i]) || !SHADES[words[i]] ? null : comparing ? `more ${words[i]}` : words[i] });
      continue;
    }
    unknown.push(words[i]);
  }

  if (!exact && !mentions.length && !changes.length && !shifts.length && !opposite && !randomly) return { color: null, read: '', unknown };

  // Where to start: a colour given whole, the colours named (mixed), at random, or the one shown.
  let hsl: Hsl;
  let base = '';
  const shown = current ? toHsl(current) : null;
  if (exact) {
    hsl = toHsl(exact);
    base = exact;
  } else if (mentions.length) {
    const only = mentions.length === 1 && mentions[0].weight === 1 ? toHsl(mentions[0].color) : null;
    const sameFamily = only && shown && (only[1] < 0.12 ? shown[1] < 0.12 : shown[1] >= 0.12 && Math.abs(hueGap(only[0], shown[0])) <= 25);
    // "Brighter pink" with a pink already shown: that pink, brighter.
    hsl = sameFamily && (changes.length || shifts.length) ? shown! : mix(mentions);
    base = mentions.some((m) => m.weight < 1) ? mentions.map((m) => m.said).join(' ') : mentions.map((m) => m.name).join(' and ');
  } else if (randomly) {
    hsl = [Math.floor(random() * 360), 0.55 + random() * 0.3, 0.38 + random() * 0.14];
    base = 'a colour at random';
  } else if (shown) {
    hsl = shown;
  } else {
    const what = changes.length ? said(changes[0]) : shifts.length ? saidShift(shifts[0]) : 'the opposite';
    return { color: null, read: `${capital(what)} than what? Name a colour too, as in “${what} pink”.`, unknown };
  }
  if (randomly && (exact || mentions.length)) {
    // "A different pink": near it, not anywhere.
    hsl = [(hsl[0] + (random() - 0.5) * 36 + 360) % 360, clamp(hsl[1] + (random() - 0.5) * 0.24), clamp(hsl[2] + (random() - 0.5) * 0.2, 0.15, 0.85)];
    base = `another ${base}`;
  }

  for (const { op, amount } of changes) {
    let [h, s, l] = hsl;
    if (op.kind === 'shade') {
      if (op.set && amount > 0) {
        s = op.set.s ?? clamp(s, 0.35, 0.75);
        l = op.set.l ?? l;
      } else if (op.set) {
        // "Less neon", "less pastel": back towards the middle.
        s = clamp(s - 0.15);
        l += (0.5 - l) * 0.4;
      }
      s = clamp(s + op.ds * amount);
      l = clamp(l + op.dl * amount, 0.04, 0.96);
    } else if (s < 0.08) {
      // A warm grey: a little warmth in it.
      [h, s] = [amount >= 0 ? op.toward : (op.toward + 180) % 360, clamp(0.1 * Math.abs(amount))];
    } else {
      const toward = amount >= 0 ? op.toward : (op.toward + 180) % 360;
      const gap = hueGap(h, toward);
      h = (h + Math.sign(gap) * Math.min(Math.abs(gap), op.step * Math.abs(amount)) + 360) % 360;
    }
    hsl = [h, s, l];
  }
  for (const shift of shifts) {
    const [th, ts, tl] = toHsl(shift.color);
    let [h, s, l] = hsl;
    if (ts < 0.12) {
      // More grey, more white: towards it, not round the wheel.
      const t = clamp(0.3 * Math.abs(shift.amount)) * Math.sign(shift.amount);
      s = clamp(s + (ts - s) * t);
      l = clamp(l + (tl - l) * t, 0.04, 0.96);
    } else if (s < 0.08) {
      // A grey made bluer: a little blue in it.
      if (shift.amount > 0) [h, s] = [th, clamp(0.2 * shift.amount)];
    } else {
      const toward = shift.amount >= 0 ? th : (th + 180) % 360;
      const gap = hueGap(h, toward);
      h = (h + Math.sign(gap) * Math.min(Math.abs(gap), 20 * Math.abs(shift.amount)) + 360) % 360;
    }
    hsl = [h, s, l];
  }
  if (opposite) hsl = [(hsl[0] + 180) % 360, hsl[1], hsl[2]];

  const asIs = !changes.length && !shifts.length && !opposite && !randomly;
  const color = exact && asIs ? exact : mentions.length === 1 && asIs ? mentions[0].color : fromHsl(hsl);
  // "Brighter pink", "Much darker, warmer", "#2f6fde, brighter", then "more blue" and the opposite.
  const how = changes.map(said).join(', ');
  const front = !base ? how : !how ? base : base.startsWith('#') || base.startsWith('a colour') ? `${base}, ${how}` : `${how} ${base}`;
  const read = [front, ...shifts.map(saidShift), ...(opposite ? [front ? 'its opposite' : 'the opposite'] : [])].filter(Boolean).join(', ');
  return { color, read: capital(read), unknown };
}

/** Colours mixed by weight: their hues round the wheel (greys don't pull), their strength and lightness averaged. */
function mix(mentions: Mention[]): Hsl {
  let x = 0;
  let y = 0;
  let s = 0;
  let l = 0;
  let total = 0;
  for (const m of mentions) {
    const [h, ms, ml] = toHsl(m.color);
    x += Math.cos((h * Math.PI) / 180) * m.weight * ms;
    y += Math.sin((h * Math.PI) / 180) * m.weight * ms;
    s += ms * m.weight;
    l += ml * m.weight;
    total += m.weight;
  }
  return [((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, s / total, l / total];
}
