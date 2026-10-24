import { describe, expect, it } from 'vitest';
import { absoluteFontPaths, exportFolderOf, outputPathPattern, parseProjectSettings, serializeProjectSettings, typstRootOf, validateProjectSettings } from './project-settings';

describe('parseProjectSettings', () => {
  it('reads known keys and keeps the raw object', () => {
    const p = parseProjectSettings('{"entryPoint":"book.typ","outputDir":"dist","fontPaths":["fonts", 3],"theme":"x"}');
    expect(p.settings).toEqual({ entryPoint: 'book.typ', outputDir: 'dist', fontPaths: ['fonts'] });
    expect(p.raw.theme).toBe('x');
    expect(p.error).toBeNull();
  });

  it('reads the book’s language and grammar rules', () => {
    expect(parseProjectSettings('{"language":"en-GB","proofRules":{"AnA":false}}').settings).toEqual({ language: 'en-GB', proofRules: { AnA: false } });
    expect(parseProjectSettings('{"language":"British"}').settings).toEqual({});
  });

  it('reads the book’s colour: a hex colour, or none', () => {
    expect(parseProjectSettings('{"color":"#00AD9F"}').settings.color).toBe('#00ad9f');
    expect(parseProjectSettings('{"color":"none"}').settings.color).toBe('none');
    expect(parseProjectSettings('{"color":"teal"}').settings.color).toBeUndefined();
  });

  it('treats a missing or empty file as defaults, and reports bad JSON instead of guessing', () => {
    expect(parseProjectSettings(null)).toEqual({ settings: {}, raw: {}, error: null });
    expect(parseProjectSettings('  ')).toEqual({ settings: {}, raw: {}, error: null });
    expect(parseProjectSettings('{"entryPoint": ').error).toMatch(/not valid JSON/);
    expect(parseProjectSettings('[1]').error).toMatch(/JSON object/);
  });
});

describe('validateProjectSettings', () => {
  const files = ['main.typ', 'chapters/ch1.typ'];
  it('accepts valid settings', () => {
    expect(validateProjectSettings({ entryPoint: 'main.typ', outputDir: 'dist/pdf', fontPaths: ['fonts', '/Library/Fonts'] }, files)).toEqual([]);
  });
  it('rejects a missing entry point, an output folder outside the project, and empty font folders', () => {
    expect(validateProjectSettings({ entryPoint: 'nope.typ' }, files)).toHaveLength(1);
    expect(validateProjectSettings({ outputDir: '../out' }, files)).toHaveLength(1);
    expect(validateProjectSettings({ outputDir: '/tmp' }, files)).toHaveLength(1);
    expect(validateProjectSettings({ fontPaths: [' '] }, files)).toHaveLength(1);
  });
});

describe('serializeProjectSettings', () => {
  it('drops a rule list emptied out', () => {
    expect(JSON.parse(serializeProjectSettings({ proofRules: { AnA: false }, outputDir: 'x' }, { proofRules: {} }))).toEqual({ outputDir: 'x' });
  });

  it('merges over existing keys, preserves unknown ones, and drops empty values', () => {
    const text = serializeProjectSettings({ entryPoint: 'main.typ', custom: true, outputDir: 'old' }, { outputDir: '', fontPaths: [] });
    expect(JSON.parse(text)).toEqual({ entryPoint: 'main.typ', custom: true });
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('export and font paths', () => {
  it('builds the Tinymist output pattern', () => {
    expect(outputPathPattern({}, '/b')).toBe('$root/$dir/$name');
    expect(outputPathPattern({ outputDir: './dist/' }, '/b')).toBe('/b/dist/$name');
  });
  it('says which folder an export goes to: the export folder, else the file’s own', () => {
    expect(exportFolderOf({}, 'main.typ')).toBe('');
    expect(exportFolderOf({}, 'src/main.typ')).toBe('src');
    expect(exportFolderOf({ outputDir: './export/' }, 'src/main.typ')).toBe('export');
    expect(exportFolderOf({ outputDir: '  ' }, 'cover/cover.typ')).toBe('cover');
  });
  it('makes font folders absolute', () => {
    expect(absoluteFontPaths({ fontPaths: ['fonts', './more', '/Library/Fonts', ''] }, '/b')).toEqual(['/b/fonts', '/b/more', '/Library/Fonts']);
  });
});

describe('the Typst root', () => {
  it('is the setting, else the main file’s folder, as typst compile does', () => {
    expect(typstRootOf({}, 'main.typ')).toBe('');
    expect(typstRootOf({}, 'src/main.typ')).toBe('src');
    expect(typstRootOf({ root: './src/' }, 'src/book/main.typ')).toBe('src');
    expect(typstRootOf({ root: '.' }, 'src/main.typ')).toBe('');
    expect(validateProjectSettings({ root: '../x' }, [])).toEqual(['The book’s root folder must be inside the project (a relative path without "..").']);
    expect(validateProjectSettings({ root: 'src', entryPoint: 'main.typ' }, ['main.typ'])).toEqual(['The main file must be inside the root folder (src).']);
  });
});
