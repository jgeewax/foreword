import { describe, expect, it } from 'vitest';
import { bibliographyKeyPlaces, scanRefs } from './broken-refs';
import { badLabelName, cleanLabelName, nameAt, namePlaces, placesOf, renameAt } from './label-refs';

const named = (text: string) => namePlaces(text).map((p) => [p.kind, text.slice(p.start, p.end)]);

describe('where a label is named', () => {
  it('finds the label, its references and its uses in code, each as the name alone', () => {
    const text = '= Intro <intro>\nSee @intro. And #ref(<intro>, form: "page").\n#show <intro>: set text(red)\n#let l = label("intro")';
    expect(named(text)).toEqual([
      ['label', 'intro'],
      ['ref', 'intro'],
      ['ref', 'intro'],
      ['use', 'intro'],
      ['use', 'intro'],
    ]);
  });

  it('finds the labels a query or a where names', () => {
    expect(named('#context query(<fig-1>)\n#context query(heading.where(label: <sec>))')).toEqual([
      ['use', 'fig-1'],
      ['use', 'sec'],
    ]);
  });

  it('takes a label("…") only when it is the whole name', () => {
    expect(scanRefs('#label("sec-" + n) #label(upper("x")) #label("ok")').uses.map((u) => u.name)).toEqual(['ok']);
  });

  it('leaves out comments, raw text, maths, strings and email addresses', () => {
    expect(named('// @intro\n`@intro` $@intro$ #let s = "@intro" jj@intro.org')).toEqual([]);
  });

  it('keeps a sentence’s full stop out of a reference', () => {
    const text = 'As in @fig-1.';
    const [p] = placesOf(text, 'fig-1');
    expect(text.slice(p.start, p.end)).toBe('fig-1');
  });

  it('finds the one under the cursor, from its @ or < to the end of its name', () => {
    const text = 'See @intro now, <tag>';
    expect(nameAt(text, 3)).toBeNull();
    expect(nameAt(text, 4)?.name).toBe('intro');
    expect(nameAt(text, 10)?.name).toBe('intro');
    expect(nameAt(text, 11)).toBeNull();
    expect(nameAt(text, 16)).toMatchObject({ name: 'tag', kind: 'label' });
    expect(nameAt(text, 20)).toMatchObject({ name: 'tag', kind: 'label' });
    expect(nameAt(text, 21)).toBeNull();
  });

  it('is quick about a text that doesn’t name it', () => {
    expect(placesOf('Nothing here.', 'intro')).toEqual([]);
    expect(placesOf('<introduction> and @intro-2', 'intro')).toEqual([]);
  });
});

describe('renaming a label', () => {
  it('changes the name in every place, and only there', () => {
    const text = '= Intro <intro>\nSee @intro. #ref(<intro>) and @introduction.\n#show <intro>: set text(red)\n// @intro stays';
    expect(renameAt(text, placesOf(text, 'intro'), 'opening')).toBe(
      '= Intro <opening>\nSee @opening. #ref(<opening>) and @introduction.\n#show <opening>: set text(red)\n// @intro stays',
    );
  });

  it('takes the name as the author types it', () => {
    expect(cleanLabelName('  @fig-2 ')).toBe('fig-2');
    expect(cleanLabelName('<fig-2>')).toBe('fig-2');
    expect(cleanLabelName('fig:growth')).toBe('fig:growth');
  });

  it('says why a name can’t be a label’s', () => {
    expect(badLabelName('fig-2')).toBeNull();
    expect(badLabelName('sec:intro.1')).toBeNull();
    expect(badLabelName('été')).toBeNull();
    expect(badLabelName('')).toMatch(/needs a name/);
    expect(badLabelName('my fig')).toMatch(/my-fig/);
    expect(badLabelName('fig#1')).toMatch(/letters, digits/);
    expect(badLabelName('fig.')).toMatch(/end with “\.”/);
  });
});

describe('a citation’s entry', () => {
  it('is found in BibTeX', () => {
    const bib = '@book{knuth1968,\n  title = {TAOCP}}\n@Article( lamport:94 , title={LaTeX})';
    const [p] = bibliographyKeyPlaces('refs.bib', bib, 'lamport:94');
    expect(bib.slice(p.start, p.end)).toBe('lamport:94');
    expect(bibliographyKeyPlaces('refs.bib', bib, 'knuth')).toEqual([]);
  });

  it('is found in Hayagriva', () => {
    const yml = 'knuth:\n  type: Book\n"quoted key":\n  type: Article\n';
    const [p] = bibliographyKeyPlaces('works.yml', yml, 'quoted key');
    expect(yml.slice(p.start, p.end)).toBe('quoted key');
    expect(bibliographyKeyPlaces('works.yml', yml, 'knuth')).toEqual([{ start: 0, end: 5 }]);
  });
});
