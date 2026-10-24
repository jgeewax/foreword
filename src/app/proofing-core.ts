// Spelling and grammar, the parts with no editor in them: which squiggles show
// while typing, what a menu offers for a mistake, the options a check is sent
// with, and the language a book is checked in (proof/ in Rust does the checking).
import type { ProofIssue, ProofOptions, WordScope } from '../lib/ipc';
import type { ProjectSettings } from './project-settings';
import type { AppSettings } from './settings';

export type IssueKind = ProofIssue['kind'];

/** The squiggles' classes (styles.css): Word's red for spelling, blue for grammar, dotted purple for style. */
export const ISSUE_CLASS: Record<IssueKind, string> = { spelling: 'proof-spelling', grammar: 'proof-grammar', style: 'proof-style' };

/** Their marks in the scrollbar. */
export const ISSUE_RULER: Record<IssueKind, string> = { spelling: '#e5534b', grammar: '#4493f8', style: '#a371f7' };

export const ISSUE_TITLE: Record<IssueKind, string> = { spelling: 'Spelling', grammar: 'Grammar', style: 'Style' };

export type IssueCounts = Record<IssueKind, number>;

export function countIssues(issues: Pick<ProofIssue, 'kind'>[]): IssueCounts {
  const out: IssueCounts = { spelling: 0, grammar: 0, style: 0 };
  for (const i of issues) out[i.kind]++;
  return out;
}

/** The status bar's count: "3 spelling · 1 grammar"; '' for none. */
export function countsLabel(c: IssueCounts | undefined): string {
  if (!c) return '';
  return (['spelling', 'grammar', 'style'] as const)
    .filter((k) => c[k] > 0)
    .map((k) => `${c[k]} ${k}`)
    .join(' · ');
}

/** Files spelling checks (proof/mod.rs units_of): prose, and code files when code is checked. */
export function checkable(path: string, code: boolean): boolean {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (['typ', 'md', 'markdown', 'txt'].includes(ext)) return true;
  return code && ['py', 'js', 'mjs', 'ts', 'jsx', 'tsx', 'rs', 'go', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'dart', 'rb', 'lua', 'hs', 'php', 'html', 'css', 'tex', 'sh', 'java', 'kt', 'swift', 'jl', 'r', 'scala', 'sql'].includes(ext);
}

/** BCP 47-ish tag: "en", "en-GB", "pt-BR". */
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/** A tag as Typst and BCP 47 write it ("en-gb" → "en-GB"), or null. */
export function normalizeLanguage(tag: string | null | undefined): string | null {
  const m = /^\s*([a-zA-Z]{2,3})(?:[-_]([a-zA-Z]{2}))?\s*$/.exec(tag ?? '');
  if (!m) return null;
  return m[2] ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : m[1].toLowerCase();
}

/**
 * The language a book is checked in: its own setting (This book ▸ Spelling),
 * else what its Typst sets (`set text(lang: "en", region: "gb")`), else the
 * author's for every book, else the Mac's.
 */
export function bookLanguage(project: ProjectSettings, typst: string | null, settings: AppSettings, mac: string): string {
  const own = normalizeLanguage(mac);
  const tag = normalizeLanguage(project.language) ?? normalizeLanguage(typst) ?? normalizeLanguage(settings.spellingLanguage) ?? own ?? 'en-US';
  // "en" alone: English as the Mac writes it (a Mac in en-GB checks British spellings).
  if (!tag.includes('-') && own?.startsWith(`${tag}-`)) return own;
  return tag;
}

/** The settings a check depends on: changing one checks the open files again. */
export const PROOFING_KEYS = ['checkSpelling', 'checkGrammar', 'checkStyle', 'checkCode', 'ignoreUppercase', 'ignoreNumbers', 'spellingLanguage', 'proofRules'] as const satisfies readonly (keyof AppSettings)[];

/** What a check is sent with, or null when nothing is checked. Book rules win over the author's. */
export function proofOptions(settings: AppSettings, project: ProjectSettings, language: string, ignored: string[]): ProofOptions | null {
  if (!settings.checkSpelling && !settings.checkGrammar && !settings.checkStyle) return null;
  return {
    spelling: settings.checkSpelling,
    grammar: settings.checkGrammar,
    style: settings.checkStyle,
    code: settings.checkCode,
    ignoreUppercase: settings.ignoreUppercase,
    ignoreNumbers: settings.ignoreNumbers,
    language,
    rules: { ...settings.proofRules, ...project.proofRules },
    ignored,
  };
}

/**
 * The word being typed isn't flagged until the caret leaves it, as in Word and
 * Google Docs: a misspelling at the caret, where the last edit was, waits.
 */
export function heldBack(issue: Pick<ProofIssue, 'start' | 'end' | 'kind'>, caret: number | null, edited: number | null): boolean {
  if (issue.kind !== 'spelling' || caret === null || edited === null) return false;
  return issue.start <= caret && caret <= issue.end && issue.start <= edited && edited <= issue.end;
}

/** A rule's name in words: "SentenceCapitalization" is "Sentence capitalization". */
export function ruleTitle(rule: string): string {
  const words = rule.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return words.charAt(0) + words.slice(1).toLowerCase();
}

/** Harper's `word` in backticks, as a menu shows it: “word”. */
export const plainMessage = (message: string) => message.replace(/`([^`]*)`/g, '“$1”');

/** A fix as a menu reads it: the whole name for code (time_zone for “tmie” in tmie_zone), "Remove “is”" for a removal. */
export function fixLabel(issue: Pick<ProofIssue, 'word' | 'name'>, fix: string): string {
  if (fix === '') return `Remove “${issue.word}”`;
  if (issue.name && issue.name.includes(issue.word)) return issue.name.replace(issue.word, fix);
  return fix;
}

/** What a hover or menu says about a mistake. */
export function issueMessage(issue: Pick<ProofIssue, 'kind' | 'word' | 'name' | 'message' | 'rule'> & { lang?: string }): string {
  if (issue.kind === 'spelling' && issue.rule === 'SpellCheck') return `“${issue.word}” isn’t in the dictionary.`;
  // Another language, from the Mac's own dictionaries: which one.
  if (issue.kind === 'spelling' && issue.rule === 'MacSpelling') return `“${issue.word}” isn’t in the ${languageName(issue.lang ?? '')} dictionary.`;
  if (issue.kind === 'spelling' && issue.name) return `“${issue.word}” in ${issue.name} isn’t in the dictionary.`;
  return plainMessage(issue.message);
}

export type ProofAction =
  | { kind: 'fix'; fix: string }
  | { kind: 'ignore' }
  | { kind: 'learn'; scope: WordScope }
  | { kind: 'rule' }
  | { kind: 'language' };

/** A menu's entries for a mistake: the fixes first (as TextEdit puts them), then what else can be done. */
export function proofMenu(issue: ProofIssue): ({ label: string; action: ProofAction | null } | 'separator')[] {
  const fixes = issue.fixes.slice(0, 5).map((fix) => ({ label: fixLabel(issue, fix), action: issue.fixable ? ({ kind: 'fix', fix } as const) : null }));
  if (issue.kind === 'spelling') {
    return [
      ...(fixes.length ? fixes : [{ label: 'No Guesses Found', action: null }]),
      'separator',
      { label: 'Ignore Spelling', action: { kind: 'ignore' } },
      { label: 'Add to Book Dictionary', action: { kind: 'learn', scope: 'book' } },
      { label: 'Add to My Dictionary', action: { kind: 'learn', scope: 'user' } },
    ];
  }
  return [
    { label: issueMessage(issue), action: null },
    ...fixes,
    'separator',
    { label: 'Ignore', action: { kind: 'ignore' } },
    { label: `Don’t Check for “${ruleTitle(issue.rule)}”`, action: { kind: 'rule' } },
  ];
}

/** The issue after `offset` (or before, going back), wrapping around; -1 if none. Sorted by start. */
export function nextIssue(issues: Pick<ProofIssue, 'start'>[], offset: number, back = false): number {
  if (!issues.length) return -1;
  if (back) {
    for (let i = issues.length - 1; i >= 0; i--) if (issues[i].start < offset) return i;
    return issues.length - 1;
  }
  const i = issues.findIndex((x) => x.start > offset);
  return i === -1 ? 0 : i;
}

/** A language's name for menus: "French", "British English"; the tag when unknown. */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Languages offered for a passage (Set Language…), as tags. */
export const LANGUAGES = ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-IN', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'ru', 'uk', 'el', 'la', 'ja', 'zh', 'ko'];

/**
 * A passage marked as another language, as Typst writes it (so hyphenation
 * and quotes follow too): `#text(lang: "fr")[…]`, or, over paragraphs, a block
 * with its own set rule.
 */
export function wrapLanguage(text: string, tag: string): string {
  const [lang, region] = tag.split('-');
  const args = region ? `lang: "${lang}", region: "${region.toLowerCase()}"` : `lang: "${lang}"`;
  if (/\n\s*\n/.test(text)) return `#[\n#set text(${args})\n${text}\n]`;
  return `#text(${args})[${text}]`;
}

/** Words for the whole-book view: each unknown word with how often and where, the most frequent first. */
export function groupWords(files: Record<string, ProofIssue[]>): { word: string; count: number; files: string[] }[] {
  const byWord = new Map<string, { word: string; count: number; files: Set<string> }>();
  for (const [path, issues] of Object.entries(files)) {
    for (const i of issues) {
      if (i.kind !== 'spelling') continue;
      const g = byWord.get(i.word) ?? { word: i.word, count: 0, files: new Set<string>() };
      g.count++;
      g.files.add(path);
      byWord.set(i.word, g);
    }
  }
  return [...byWord.values()].map((g) => ({ word: g.word, count: g.count, files: [...g.files].sort() })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
