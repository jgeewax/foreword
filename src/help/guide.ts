// "Typst basics": a short guide for writers who haven't used Typst (TODO #11).
// The content is JSON so `npm run check-templates` can compile every example.
import data from './typst-basics.json';

export type GuideItem = {
  title: string;
  text: string;
  code?: string;
  /** Offer "Insert" (markup patterns, not sample prose). */
  insert?: boolean;
  /** False for examples that need other files to compile. */
  compile?: boolean;
};
export type Guide = { sections: { title: string; items: GuideItem[] }[]; shortcuts: [string, string][] };

export const GUIDE = data as Guide;

/** Headings, lists, figures, display math…: things that need their own paragraph. */
export function isBlockSnippet(code: string): boolean {
  return code.includes('\n') || /^(=|- |\+ |#pagebreak|#figure|#quote|\$ )/.test(code);
}

/**
 * The text to insert at the cursor: inline snippets as they are; block
 * snippets padded with blank lines so they start and end their own paragraph.
 */
export function snippetInsertion(code: string, beforeCursor: string, afterCursor: string): string {
  if (!isBlockSnippet(code)) return code;
  return `${beforeCursor.trim() ? '\n\n' : ''}${code}${afterCursor.trim() ? '\n\n' : '\n'}`;
}
