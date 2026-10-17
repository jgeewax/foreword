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
    const text = serializeConfig(c.raw, { ...c.settings, markAiReads: false }, 1.25);
    expect(JSON.parse(text)).toMatchObject({ sendKey: 'mod-enter', markAiReads: false, zoom: 1.25, myNote: 'hi', allowCommands: ['python3', 'uv run'] });
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('says where a mistake is, and never accepts a non-object', () => {
    expect(parseConfig('{\n  "sendKey": "enter",\n  "zoom": 1,,\n}').error).toMatch(/isn.t valid JSON/);
    expect(parseConfig('[1]').error).toMatch(/JSON object/);
    expect(parseConfig('{}').settings).toEqual(DEFAULT_SETTINGS);
  });
});
