// The tour for someone new: a few steps, each lighting up one part of the
// window and saying what it's for. It starts by itself the first time a book
// is opened (when it's the only book ever opened), and Help ▸ Take the Tour
// runs it again.

export type TourStep = {
  /** The part of the window it lights up (a CSS selector); none for a card in the middle. */
  target: string | null;
  title: string;
  text: string;
  /** The preview is a native view over the page: it shows only on its own step. */
  preview?: boolean;
};

export const TOUR_STEPS: TourStep[] = [
  {
    target: null,
    title: 'Welcome to Typst Studio',
    text: 'A minute’s look around the window. Leave any time with Esc, and take the tour again from Help ▸ Take the Tour.',
  },
  {
    target: '.explorer',
    title: 'Your book’s files',
    text: 'Its chapters, pictures and the main file, which pulls the chapters in, in order. Right-click for New Chapter, Rename and more.',
  },
  {
    target: '.activity-bar',
    title: 'Views down the side',
    text: 'Files, Review (comments on the text), History (every version, saved as you work), and more as the book needs them. Hover an icon to see what it’s for.',
  },
  {
    target: '.editor-pane',
    title: 'Where you write',
    text: 'Plain text with a little Typst markup: = for a heading, _emphasis_, $x^2$ for maths. Typst basics, the ? at the bottom left, has the rest.',
  },
  {
    target: '.preview-pane',
    title: 'The typeset pages',
    text: 'They follow you as you type, saved or not. Click a word on a page to go to it in the text.',
    preview: true,
  },
  {
    target: '.agent-pane',
    title: 'Your writing assistant',
    text: 'Ask it about the book, or to change something. Select some text and press ⌘I to ask about it. Its changes are marked in the text and kept in History, so any of them can be undone.',
  },
  {
    target: '.command-center',
    title: 'Find anything',
    text: '⌘P goes to a chapter by its name or number, and ⇧⌘P runs any command by name.',
  },
  {
    target: '.statusbar',
    title: 'How the book stands',
    text: 'Typst errors (click to go to the next one), pages and words, and whether the preview and the assistant are ready.',
  },
  {
    target: null,
    title: 'That’s the tour',
    text: 'Write something and watch the pages change. When the book’s ready, Book ▸ Export PDF… makes the file to print or send.',
  },
];

/** Shown once: the tour doesn't start by itself after it has run, finished or not. */
export const TOUR_SEEN_KEY = 'studio.tourSeen';

/** Whether opening a book should start the tour: never seen it, and this is the only book opened so far. */
export function shouldStartTour(seen: boolean, recentBooks: number): boolean {
  return !seen && recentBooks <= 1;
}

export type Rect = { left: number; top: number; width: number; height: number };

/**
 * Where the card goes beside a lit-up part of the window, all of it inside
 * the window: to the right if it fits, else the left, below, above; in the
 * middle when there's nothing lit up.
 */
export function placeCard(target: Rect | null, card: { width: number; height: number }, view: { width: number; height: number }, gap = 14): { left: number; top: number } {
  const margin = 12;
  const clampX = (x: number) => Math.max(margin, Math.min(view.width - card.width - margin, x));
  const clampY = (y: number) => Math.max(margin, Math.min(view.height - card.height - margin, y));
  if (!target) return { left: clampX((view.width - card.width) / 2), top: clampY((view.height - card.height) / 2) };
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const midY = target.top + target.height / 2 - card.height / 2;
  const midX = target.left + target.width / 2 - card.width / 2;
  if (right + gap + card.width + margin <= view.width) return { left: right + gap, top: clampY(midY) };
  if (target.left - gap - card.width >= margin) return { left: target.left - gap - card.width, top: clampY(midY) };
  if (bottom + gap + card.height + margin <= view.height) return { left: clampX(midX), top: bottom + gap };
  if (target.top - gap - card.height >= margin) return { left: clampX(midX), top: target.top - gap - card.height };
  // Nowhere outside it: inside, at its top left.
  return { left: clampX(target.left + margin), top: clampY(target.top + margin) };
}
