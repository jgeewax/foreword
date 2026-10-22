// Tinymist's TextMate scopes as Monaco tokens, with *strong* and _emph_. VS Code
// styles those from Tinymist's semantic tokens, so its grammar leaves them out;
// here the grammar has them, and since a Monaco token has one name, a token
// inside them carries them on the end of it (`markup.heading.emph`), with theme
// rules to match.
import type * as monaco from 'monaco-editor';

/** The theme rule that styles a scope (its longest matching prefix), if any. */
function ruleFor(scope: string, themePrefixes: readonly string[]): string | undefined {
  let rule: string | undefined;
  for (const p of themePrefixes) if ((scope === p || scope.startsWith(p + '.')) && p.length > (rule?.length ?? -1)) rule = p;
  return rule;
}

/** Most specific scope that the theme styles; Monaco tokens carry a single scope. */
export function pickScope(scopes: readonly string[], themePrefixes: readonly string[]): string {
  for (let i = scopes.length - 1; i > 0; i--) if (ruleFor(scopes[i], themePrefixes)) return scopes[i];
  return scopes[scopes.length - 1] ?? '';
}

const MODIFIERS = [
  ['markup.bold.', 'strong'],
  ['markup.italic.', 'emph'],
] as const;

/** Monaco's token for a scope stack: pickScope's, or inside *strong* or _emph_ the rule styling it then `.strong`, `.emph` or both. */
export function tokenFor(scopes: readonly string[], themePrefixes: readonly string[]): string {
  const modifiers = MODIFIERS.filter(([scope]) => scopes.some((s) => s.startsWith(scope))).map(([, m]) => m);
  if (!modifiers.length) return pickScope(scopes, themePrefixes);
  let rule: string | undefined;
  for (let i = scopes.length - 1; i > 0 && !rule; i--) rule = ruleFor(scopes[i], themePrefixes);
  return [rule, ...modifiers].filter(Boolean).join('.');
}

const STYLES = [
  ['strong', 'bold'],
  ['emph', 'italic'],
  ['strong.emph', 'bold italic'],
] as const;

/** The theme's rules, then each again, and plain text, inside *strong*, _emph_ and both: the tokens tokenFor names. */
export function themeWithEmphasis(rules: monaco.editor.ITokenThemeRule[]): monaco.editor.ITokenThemeRule[] {
  return [
    ...rules,
    ...[{ token: '' }, ...rules].flatMap((rule) =>
      STYLES.map(([modifiers, style]) => ({
        ...rule,
        token: rule.token ? `${rule.token}.${modifiers}` : modifiers,
        fontStyle: [...new Set(`${rule.fontStyle ?? ''} ${style}`.split(' ').filter(Boolean))].join(' '),
      })),
    ),
  ];
}

/**
 * Tinymist's grammar with *strong* and _emph_ in markup, ending where Typst
 * ends them: at the closing marker, a blank line (they go on over a line's
 * end), or the `]` of a content block they're in. Brackets inside them pair
 * up, as in Typst: `_a [b] c_` is one.
 */
export function grammarWithEmphasis(source: string): string {
  const grammar = JSON.parse(source);
  const repo = grammar.repository;
  for (const name of ['markupBold', 'markupItalic']) {
    const rule = repo[name];
    // Its end: the closing marker | the line's end | before a `]`.
    const [marker, rest] = rule.end.split('|\\n|');
    const brackets = `${name}Brackets`;
    rule.end = `${marker}|^(?=\\s*$)|${rest}`;
    rule.patterns = [{ include: `#${brackets}` }, ...rule.patterns];
    repo[brackets] = {
      begin: '\\[',
      end: `\\]|(?=${marker})|^(?=\\s*$)`,
      beginCaptures: { 0: { name: 'markup.content.brace.typst' } },
      endCaptures: { 0: { name: 'markup.content.brace.typst' } },
      patterns: [{ include: `#${brackets}` }, { include: '#markup' }],
    };
    repo.markup.patterns.push({ include: `#${name}` });
  }
  return JSON.stringify(grammar);
}
