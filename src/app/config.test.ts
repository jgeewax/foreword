import { describe, expect, it } from 'vitest';
import { PRESETS } from '../services/agent/permissions';
import { parseConfig, serializeConfig } from './config';
import { DEFAULT_SETTINGS } from './settings';

describe('the settings file', () => {
  it('reads what it knows and keeps the rest', () => {
    const c = parseConfig('{ "sendKey": "mod-enter", "allowCommands": ["python3", "rm -rf *", "uv run"], "zoom": 1.25, "myNote": "hi" }');
    expect(c.error).toBeNull();
    expect(c.settings.sendKey).toBe('mod-enter');
    expect(c.settings.allowCommands).toEqual(['python3', 'uv run']);
    expect(c.zoom).toBe(1.25);
    expect(c.settings.permissions).toEqual(PRESETS.ask.permissions);
    const text = serializeConfig(c.raw, { ...c.settings, markAiReads: false, formatOnSave: false }, 1.25);
    expect(JSON.parse(text)).toMatchObject({ sendKey: 'mod-enter', markAiReads: false, formatOnSave: false, zoom: 1.25, myNote: 'hi', allowCommands: ['python3', 'uv run'] });
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('drops settings it no longer has, as History below the files', () => {
    const c = parseConfig('{ "historyPlacement": "below", "myNote": "hi" }');
    expect(c.settings).toEqual(DEFAULT_SETTINGS);
    const written = JSON.parse(serializeConfig(c.raw, c.settings, 1));
    expect(written).not.toHaveProperty('historyPlacement');
    expect(written.myNote).toBe('hi');
  });

  it('keeps where lines wrap and the rulers', () => {
    const c = parseConfig('{ "wordWrap": "column", "wordWrapColumn": 120, "rulers": [80, 120] }');
    expect(c.settings).toMatchObject({ wordWrap: 'column', wordWrapColumn: 120, rulers: [80, 120] });
    expect(JSON.parse(serializeConfig(c.raw, { ...c.settings, rulers: [72] }, 1))).toMatchObject({ wordWrap: 'column', wordWrapColumn: 120, rulers: [72] });
  });

  it('keeps every setting through a write and a read, as at the next launch', () => {
    const settings = { ...DEFAULT_SETTINGS, checkForUpdates: false, skippedUpdate: '0.2.0', wordWrap: 'off' as const, rulers: [80] };
    expect(parseConfig(serializeConfig({}, settings, 1)).settings).toEqual(settings);
  });

  it('keeps the programs chosen for the tools', () => {
    const c = parseConfig('{ "toolPaths": { "tinymist": "~/bin/tinymist", "git": "" } }');
    expect(c.settings.toolPaths).toEqual({ tinymist: '~/bin/tinymist' });
    expect(JSON.parse(serializeConfig(c.raw, { ...c.settings, toolPaths: { git: '/usr/bin/git' } }, 1)).toolPaths).toEqual({ git: '/usr/bin/git' });
  });

  it('says where a mistake is, and never accepts a non-object', () => {
    expect(parseConfig('{\n  "sendKey": "enter",\n  "zoom": 1,,\n}').error).toMatch(/isn.t valid JSON/);
    expect(parseConfig('[1]').error).toMatch(/JSON object/);
    expect(parseConfig('{}').settings).toEqual(DEFAULT_SETTINGS);
  });
});
