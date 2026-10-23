import { describe, expect, it } from 'vitest';
import { chatSoFar, readModeSetups, setupLine } from './mode-setups';
import type { ChatItem } from './studio';
import { splitUserText, TASK_MARKER } from './tasks';
import { EARLIER_CHIP, EARLIER_INTRO, messageText } from '../services/agent/message-context';

describe('what each mode runs on', () => {
  it('keeps what it knows of what was kept', () => {
    const raw = {
      ask: { assistant: 'claude', model: { providerID: 'claude', id: 'opus' }, effort: 'medium', modelName: 'Opus 5.5', effortName: 'Medium' },
      figures: { assistant: 'codex', model: null, effort: null },
      write: { assistant: 'nobody' },
      plan: { assistant: 'claude', model: null, effort: null },
      options: { assistant: 'opencode', model: { id: 3 }, effort: 4, modelName: 'X' },
    };
    expect(readModeSetups(raw)).toEqual({
      ask: { assistant: 'claude', model: { providerID: 'claude', id: 'opus' }, effort: 'medium', modelName: 'Opus 5.5', effortName: 'Medium' },
      figures: { assistant: 'codex', model: null, effort: null },
      options: { assistant: 'opencode', model: null, effort: null },
    });
    expect(readModeSetups(null)).toEqual({});
    expect(readModeSetups('nonsense')).toEqual({});
  });

  it('reads as the assistant, then its model and effort', () => {
    expect(setupLine({ assistant: 'claude', model: { providerID: 'claude', id: 'opus' }, effort: 'medium', modelName: 'Opus 5.5', effortName: 'Medium' })).toBe('Claude Code · Opus 5.5 · Medium');
    expect(setupLine({ assistant: 'codex', model: { providerID: 'codex', id: 'gpt-6' }, effort: 'default' })).toBe('Codex · gpt-6');
    expect(setupLine({ assistant: 'opencode', model: null, effort: null })).toBe('OpenCode');
  });
});

describe('the chat so far, for another assistant', () => {
  const by = (assistant: 'claude' | 'opencode') => ({ assistant, model: null, effort: null });
  const items: ChatItem[] = [
    { kind: 'user', id: 'u1', text: 'Tighten the opening.', attachments: ['chapters/one.typ:3–5'], by: by('claude') },
    { kind: 'thinking', id: 't1', text: 'Hmm.', done: true, started: 0 },
    { kind: 'tool', id: 'x1', name: 'read', summary: '', status: 'done', detail: '', input: { filePath: '/book/chapters/one.typ' } },
    { kind: 'tool', id: 'x2', name: 'edit', summary: '', status: 'done', detail: '', input: { filePath: '/book/chapters/one.typ' } },
    { kind: 'assistant', id: 'a1', text: `Cut the first paragraph to two sentences.\n\n${TASK_MARKER}`, done: true },
    { kind: 'notice', id: 'n1', tone: 'info', text: 'Figures mode: diagrams…' },
    { kind: 'user', id: 'u2', text: 'Now draw the harbour as a diagram.', attachments: [], by: by('opencode') },
    { kind: 'assistant', id: 'a2', text: 'Drew it.\n\n```mode\nmode: write\nthere: Put it in the chapter.\nhere: Keep drawing.\n```', done: true },
  ];

  it('is what was said and done, by whom', () => {
    const text = chatSoFar(items, null, '/book')!;
    expect(text.startsWith(EARLIER_INTRO)).toBe(true);
    expect(text).toContain('Author: Tighten the opening.\n(With: chapters/one.typ:3–5)');
    expect(text).toMatch(/Claude Code: Cut the first paragraph to two sentences\.\n\[Read .*chapters\/one\.typ.*; Edited .*chapters\/one\.typ.*\]/);
    expect(text).toContain('OpenCode: Drew it.');
    // No thinking, notices, task marker or mode offer.
    expect(text).not.toMatch(/Hmm\.|Figures mode|TASK COMPLETE|```mode/);
  });

  it('starts after what the assistant has seen', () => {
    const text = chatSoFar(items, 'n1')!;
    expect(text).not.toContain('Tighten');
    expect(text).toContain('Author: Now draw the harbour as a diagram.');
    expect(chatSoFar(items, 'a2')).toBeNull();
    // An item that's gone (compacted away): all of it.
    expect(chatSoFar(items, 'gone')).toContain('Tighten');
  });

  it('keeps the latest turns when the chat is long', () => {
    const long: ChatItem[] = Array.from({ length: 30 }, (_, i): ChatItem[] => [
      { kind: 'user', id: `u${i}`, text: `Question ${i}`, attachments: [], by: by('claude') },
      { kind: 'assistant', id: `a${i}`, text: `Answer ${i}: ${'x'.repeat(3000)}`, done: true },
    ]).flat();
    const text = chatSoFar(long, null)!;
    expect(text.length).toBeLessThan(42_000);
    expect(text).toContain('(Earlier turns left out.)');
    expect(text).toContain('Question 29');
    expect(text).not.toContain('Question 0\n');
  });

  it('goes after the message, and comes out again when the conversation is replayed', () => {
    const earlier = chatSoFar(items, null)!;
    const sent = messageText('Make it bigger.', [{ earlier }]);
    expect(sent.startsWith('Make it bigger.\n\n')).toBe(true);
    expect(splitUserText(sent)).toEqual({ text: 'Make it bigger.', attachments: [EARLIER_CHIP] });
  });
});
