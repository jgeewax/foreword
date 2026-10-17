import { describe, expect, it } from 'vitest';
import { absoluteFontPaths, outputPathPattern, parseProjectSettings, serializeProjectSettings, validateProjectSettings } from './project-settings';

describe('parseProjectSettings', () => {
  it('reads known keys and keeps the raw object', () => {
    const p = parseProjectSettings('{"entryPoint":"book.typ","outputDir":"dist","fontPaths":["fonts", 3],"theme":"x"}');
    expect(p.settings).toEqual({ entryPoint: 'book.typ', outputDir: 'dist', fontPaths: ['fonts'] });
    expect(p.raw.theme).toBe('x');
    expect(p.error).toBeNull();
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
  it('merges over existing keys, preserves unknown ones, and drops empty values', () => {
    const text = serializeProjectSettings({ entryPoint: 'main.typ', custom: true, outputDir: 'old' }, { outputDir: '', fontPaths: [] });
    expect(JSON.parse(text)).toEqual({ entryPoint: 'main.typ', custom: true });
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('export and font paths', () => {
  it('builds the Tinymist output pattern', () => {
    expect(outputPathPattern({})).toBe('$root/$dir/$name');
    expect(outputPathPattern({ outputDir: './dist/' })).toBe('$root/dist/$name');
  });
  it('makes font folders absolute', () => {
    expect(absoluteFontPaths({ fontPaths: ['fonts', './more', '/Library/Fonts', ''] }, '/b')).toEqual(['/b/fonts', '/b/more', '/Library/Fonts']);
  });
});
