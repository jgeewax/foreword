import { describe, expect, it } from 'vitest';
import { AGENT_STYLE_MAX_CHARS, AGENT_STYLE_TEMPLATE, AGENT_STYLES, agentStyleInstructions, agentStyleReminder, agentStyleSays, agentStyleWords, isAgentStyle } from './agent-style';
import { REMINDER_START } from './message-context';
import { splitUserText } from '../../app/tasks';
import { messageText } from './message-context';

describe('the styles', () => {
  it('start with Balanced, which adds nothing to Foreword’s own instructions', () => {
    expect(AGENT_STYLES[0].id).toBe('balanced');
    expect(agentStyleInstructions('balanced', null)).toBeNull();
    expect(agentStyleReminder('balanced', null)).toBeNull();
  });

  it('each other one has rules, a reminder and words for Settings', () => {
    for (const s of AGENT_STYLES.slice(1)) {
      expect(s.rules, s.id).toBeTruthy();
      expect(s.reminder, s.id).toBeTruthy();
      expect(s.detail.length, s.id).toBeGreaterThan(20);
    }
  });

  it('knows its own names, and nothing else', () => {
    expect(isAgentStyle('concise')).toBe(true);
    expect(isAgentStyle('Concise')).toBe(false);
    expect(isAgentStyle(undefined)).toBe(false);
  });
});

describe('agentStyleInstructions', () => {
  it('says the style is for the chat, not the book, and that the mode’s formats still apply', () => {
    const text = agentStyleInstructions('concise', null)!;
    expect(text).toContain('# How you talk with the author');
    expect(text).toMatch(/not the book/);
    expect(text).toMatch(/formats the chat mode asks for .* still apply/);
    expect(text).toContain('## Concise (Settings ▸ Assistant)');
    expect(text).toContain('The author wants short replies.');
    expect(text).not.toContain('AGENT_STYLE.md');
  });

  it('adds the book’s file, which wins over the style', () => {
    const text = agentStyleInstructions('candid', '# How the assistant talks with me\n\nCall me Sam.\n')!;
    expect(text).toContain('## Candid');
    expect(text).toContain('## In their own words (AGENT_STYLE.md)');
    expect(text).toContain('Where it differs from the above, it wins.');
    expect(text).toContain('<agent-style>\n# How the assistant talks with me\n\nCall me Sam.\n</agent-style>');
  });

  it('with Balanced, has the file alone', () => {
    const text = agentStyleInstructions('balanced', 'Be brief.')!;
    expect(text).not.toContain('Settings ▸ Assistant)');
    expect(text).not.toContain('it wins');
    expect(text).toContain('<agent-style>\nBe brief.\n</agent-style>');
  });

  it('cuts a very long file and says so', () => {
    const text = agentStyleInstructions('balanced', 'x'.repeat(AGENT_STYLE_MAX_CHARS + 500))!;
    expect(text).toContain('the rest was cut for length');
    expect(text.length).toBeLessThan(AGENT_STYLE_MAX_CHARS + 1500);
  });
});

describe('the file', () => {
  it('as the template makes it says nothing: its suggestions are in a comment', () => {
    expect(agentStyleSays(AGENT_STYLE_TEMPLATE)).toBe(false);
    expect(agentStyleInstructions('balanced', AGENT_STYLE_TEMPLATE)).toBeNull();
    expect(agentStyleInstructions('concise', AGENT_STYLE_TEMPLATE)).not.toContain('AGENT_STYLE.md');
    expect(agentStyleReminder('balanced', AGENT_STYLE_TEMPLATE)).toBeNull();
  });

  it('says what the author writes under the comment, without the comment', () => {
    const file = `${AGENT_STYLE_TEMPLATE}- Keep it short.\n`;
    expect(agentStyleSays(file)).toBe(true);
    expect(agentStyleWords(file)).toBe('# How the assistant talks with me\n\n- Keep it short.');
  });

  it('a comment left open hides the rest, as Markdown would', () => {
    expect(agentStyleWords('Be brief.\n<!-- a note\nmore')).toBe('Be brief.');
  });

  it('missing or empty says nothing', () => {
    expect(agentStyleSays(null)).toBe(false);
    expect(agentStyleSays('  \n')).toBe(false);
    expect(agentStyleSays('# Just a heading\n')).toBe(false);
  });
});

describe('agentStyleReminder', () => {
  it('names the style and what to do in this reply', () => {
    expect(agentStyleReminder('concise', null)).toBe(`${REMINDER_START}how you talk: Concise. Keep this reply short: the answer or what you changed first, with no preamble and no recap.)`);
  });

  it('names the file when it says something', () => {
    expect(agentStyleReminder('concise', 'Call me Sam.')).toContain('Concise, and as AGENT_STYLE.md says.');
    expect(agentStyleReminder('balanced', 'Call me Sam.')).toBe(`${REMINDER_START}how you talk: as AGENT_STYLE.md says.)`);
  });

  it('is taken off the author’s message when the chat shows it again', () => {
    const sent = messageText('Tighten this.', [{ reminder: agentStyleReminder('candid', null)! }]);
    expect(splitUserText(sent).text).toBe('Tighten this.');
  });
});
