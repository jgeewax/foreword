import { describe, expect, it } from 'vitest';
import type { ProofIssue } from '../lib/ipc';
import {
  bookLanguage,
  countIssues,
  countsLabel,
  fixLabel,
  groupWords,
  heldBack,
  issueMessage,
  languageName,
  nextIssue,
  normalizeLanguage,
  proofMenu,
  proofOptions,
  ruleTitle,
  wrapLanguage,
} from './proofing-core';
import { DEFAULT_SETTINGS } from './settings';

const issue = (over: Partial<ProofIssue>): ProofIssue => ({
  start: 0,
  end: 3,
  kind: 'spelling',
  rule: 'SpellCheck',
  message: 'Did you mean to spell `teh` this way?',
  word: 'teh',
  fixes: ['the', 'tea'],
  fixable: true,
  lang: 'en',
  key: 'k',
  name: null,
  ...over,
});

describe('heldBack', () => {
  it('holds back the misspelling being typed until the caret leaves it', () => {
    const i = issue({ start: 10, end: 13 });
    expect(heldBack(i, 13, 12)).toBe(true);
    // The caret moved on.
    expect(heldBack(i, 20, 12)).toBe(false);
    // Typed elsewhere, then came back with the arrow keys: it shows.
    expect(heldBack(i, 12, 30)).toBe(false);
    expect(heldBack(issue({ start: 10, end: 13, kind: 'grammar' }), 13, 12)).toBe(false);
  });
});

describe('menus', () => {
  it('offers the fixes first, then ignoring and learning the word', () => {
    const labels = proofMenu(issue({})).map((e) => (e === 'separator' ? '—' : e.label));
    expect(labels).toEqual(['the', 'tea', '—', 'Ignore Spelling', 'Add to Book Dictionary', 'Add to My Dictionary']);
    expect(proofMenu(issue({ fixes: [] }))[0]).toEqual({ label: 'No Guesses Found', action: null });
  });

  it('says what a grammar rule found, and can turn it off', () => {
    const entries = proofMenu(issue({ kind: 'grammar', rule: 'AnA', word: 'an', message: 'Incorrect indefinite article.', fixes: ['a'] }));
    const labels = entries.map((e) => (e === 'separator' ? '—' : e.label));
    expect(labels).toEqual(['Incorrect indefinite article.', 'a', '—', 'Ignore', 'Don’t Check for “An a”']);
  });

  it('shows fixes across markup but can’t apply them', () => {
    const [first] = proofMenu(issue({ kind: 'grammar', fixable: false, fixes: ['is'] })).filter((e) => e !== 'separator').slice(1);
    expect(first).toEqual({ label: 'is', action: null });
  });

  it('names code fixes whole and removals plainly', () => {
    expect(fixLabel({ word: 'tmie', name: 'tmie_zone' }, 'time')).toBe('time_zone');
    expect(fixLabel({ word: 'is', name: null }, '')).toBe('Remove “is”');
    expect(issueMessage(issue({ rule: 'CodeSpelling', word: 'tmie', name: 'tmie_zone' }))).toBe('“tmie” in tmie_zone isn’t in the dictionary.');
    expect(issueMessage(issue({ kind: 'grammar', rule: 'AnA', message: 'Use `a` here.' }))).toBe('Use “a” here.');
  });

  it('writes rule names in words', () => {
    expect(ruleTitle('SentenceCapitalization')).toBe('Sentence capitalization');
    expect(ruleTitle('ExpandMemoryShorthands')).toBe('Expand memory shorthands');
  });
});

describe('languages', () => {
  it('normalizes tags as Typst and BCP 47 write them', () => {
    expect(normalizeLanguage('en_gb')).toBe('en-GB');
    expect(normalizeLanguage('FR')).toBe('fr');
    expect(normalizeLanguage('English')).toBeNull();
  });

  it('takes the book’s, then its Typst’s, then the author’s, then the Mac’s', () => {
    const s = { ...DEFAULT_SETTINGS, spellingLanguage: 'en-AU' };
    expect(bookLanguage({ language: 'de' }, 'en-gb', s, 'en-US')).toBe('de');
    expect(bookLanguage({}, 'en-gb', s, 'en-US')).toBe('en-GB');
    expect(bookLanguage({}, null, s, 'en-US')).toBe('en-AU');
    expect(bookLanguage({}, null, DEFAULT_SETTINGS, 'fr-CA')).toBe('fr-CA');
    // A language without a region takes the Mac's, if it's the same language.
    expect(bookLanguage({}, 'en', DEFAULT_SETTINGS, 'en-GB')).toBe('en-GB');
    expect(bookLanguage({}, 'en', DEFAULT_SETTINGS, 'fr-FR')).toBe('en');
  });

  it('marks a passage as Typst does', () => {
    expect(wrapLanguage('Bonjour', 'fr')).toBe('#text(lang: "fr")[Bonjour]');
    expect(wrapLanguage('Colour', 'en-GB')).toBe('#text(lang: "en", region: "gb")[Colour]');
    expect(wrapLanguage('Un.\n\nDeux.', 'fr')).toBe('#[\n#set text(lang: "fr")\nUn.\n\nDeux.\n]');
  });

  it('names languages', () => {
    expect(languageName('fr')).toBe('French');
    expect(languageName('en-GB')).toBe('British English');
  });
});

describe('options', () => {
  it('sends nothing when every check is off, and the book’s rules over the author’s', () => {
    expect(proofOptions({ ...DEFAULT_SETTINGS, checkSpelling: false, checkGrammar: false }, {}, 'en', [])).toBeNull();
    const o = proofOptions({ ...DEFAULT_SETTINGS, proofRules: { AnA: false, Spaces: false } }, { proofRules: { AnA: true } }, 'en-GB', ['k']);
    expect(o?.rules).toEqual({ AnA: true, Spaces: false });
    expect(o?.language).toBe('en-GB');
    expect(o?.ignored).toEqual(['k']);
  });
});

describe('lists', () => {
  it('counts by kind and finds the next one, wrapping', () => {
    const list = [issue({ start: 5 }), issue({ start: 20, kind: 'grammar' }), issue({ start: 40 })];
    expect(countIssues(list)).toEqual({ spelling: 2, grammar: 1, style: 0 });
    expect(countsLabel(countIssues(list))).toBe('2 spelling · 1 grammar');
    expect(countsLabel({ spelling: 0, grammar: 0, style: 0 })).toBe('');
    expect(nextIssue(list, 10)).toBe(1);
    expect(nextIssue(list, 45)).toBe(0);
    expect(nextIssue(list, 10, true)).toBe(0);
    expect(nextIssue(list, 3, true)).toBe(2);
    expect(nextIssue([], 0)).toBe(-1);
  });

  it('groups a book’s unknown words, the most frequent first', () => {
    const groups = groupWords({
      'a.typ': [issue({ word: 'Grevlund' }), issue({ word: 'Grevlund' }), issue({ word: 'an', kind: 'grammar' })],
      'b.typ': [issue({ word: 'Grevlund' }), issue({ word: 'Ostrava' })],
    });
    expect(groups).toEqual([
      { word: 'Grevlund', count: 3, files: ['a.typ', 'b.typ'] },
      { word: 'Ostrava', count: 1, files: ['b.typ'] },
    ]);
  });
});
