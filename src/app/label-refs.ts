// Where a label is named in Typst text, for Rename Label (F2) and Find All
// References (⇧F12), as in VS Code: where it's put on something (`= Intro
// <intro>`), the references to it (`@intro`, `#ref(<intro>)`), and its other
// uses in code (`#show <intro>: …`, `query(<intro>)`, `label("intro")`). Read
// as broken-refs.ts reads them: not in comments, raw text, maths or strings.
// Pure; studio.ts reads the book's files and makes the edits.
import { scanRefs } from './broken-refs';

/** Put on something, referred to, or named in code. */
export type NameKind = 'label' | 'ref' | 'use';

/** A place a text names a label: how, and the offsets of the name alone (no `@`, brackets or quotes). */
export type NamePlace = { name: string; kind: NameKind; start: number; end: number };

// What a label's name is made of (as Typst's label literals are).
const LABEL_NAME = /^[\p{L}\p{M}\p{N}_:.-]+$/u;

/** Every place a text names a label, in order. */
export function namePlaces(text: string): NamePlace[] {
  const scan = scanRefs(text);
  const places: NamePlace[] = [
    ...scan.labels.map((l): NamePlace => ({ name: l.name, kind: 'label', start: l.start + 1, end: l.end - 1 })),
    // `@intro` from its `@`, or a label given to ref(…) with its brackets. An email address isn't meant as one.
    ...scan.refs.filter((r) => !r.email).map((r): NamePlace => ({ name: r.name, kind: 'ref', start: r.start + 1, end: text[r.start] === '@' ? r.end : r.end - 1 })),
    ...scan.uses.map((u): NamePlace => ({ name: u.name, kind: 'use', start: u.start + 1, end: u.end - 1 })),
  ];
  return places.sort((a, b) => a.start - b.start);
}

/** The places a text names the label `name` (quick when it doesn't). */
export function placesOf(text: string, name: string): NamePlace[] {
  return text.includes(name) ? namePlaces(text).filter((p) => p.name === name) : [];
}

/** The place a text names a label at `offset` (between characters, as the cursor is): in its name, or at its `@` or `<`. Null elsewhere. */
export function nameAt(text: string, offset: number): NamePlace | null {
  return namePlaces(text).find((p) => p.start - 1 <= offset && offset <= p.end) ?? null;
}

/** A new name as the author may type it (`@intro`, `<intro>`, with spaces round it): the name alone. */
export function cleanLabelName(typed: string): string {
  const name = typed.trim();
  return name.replace(/^<(.*)>$/, '$1').replace(/^@/, '').trim();
}

/** Why `name` can't be a label's (its references are written `@name`), or null if it can. */
export function badLabelName(name: string): string | null {
  if (!name) return 'A label needs a name.';
  if (/\s/.test(name)) return `A label’s name can’t have a space in it: try ${name.replace(/\s+/g, '-')}.`;
  if (!LABEL_NAME.test(name)) return `A label’s name is letters, digits and _ - : . only, so <${name}> can’t be one.`;
  // `@fig.` ends a sentence: Typst leaves a final "." or ":" out of a reference.
  if (/[.:]$/.test(name)) return `A label’s name can’t end with “${name.slice(-1)}”: a reference to it, @${name}, would leave it out.`;
  return null;
}

/** `text` with the label's name at `places` (namePlaces' offsets in it) changed to `to`. */
export function renameAt(text: string, places: readonly NamePlace[], to: string): string {
  let out = text;
  for (const p of [...places].sort((a, b) => b.start - a.start)) out = out.slice(0, p.start) + to + out.slice(p.end);
  return out;
}
