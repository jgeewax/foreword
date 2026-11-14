import { describe, expect, it } from 'vitest';
import { actionLine, actionText, askPrompt, EDIT_INSTEAD_PROMPT, EXPLAIN_PROMPT, failingExamplesPrompt, fixErrorPrompt, mergePrompt, messageLine, moreLikePrompt, OPTIONS_AGAIN_PROMPT, optionsPrompt, revisePrompt, STARTERS, stockAction, stockTitle } from './stock-prompts';
import { addressPrompt, makeComment } from './review';
import { todoPrompt } from './todos';
import { modeChoiceMessage, modeConfig } from '../services/agent/modes';
import { answersMessage } from '../services/agent/questions';
import { STYLE_DRAFT_MESSAGE, STYLE_INTERVIEW_MESSAGE, STYLE_REDRAFT_MESSAGE, styleReviseMessage } from '../services/agent/style-guide';
import type { FormField } from '../services/agent/types';
import { formatSelectionContext, type SourceSelection } from '../editor/selection';

describe('what a button asked for, read back from its message', () => {
  it('Write it and Go ahead: back to Write, to make what was agreed', () => {
    expect(stockAction(modeConfig('discuss').carryOut!.prompt)).toMatchObject({ verb: 'Write it', note: 'what we agreed', tone: 'change' });
    expect(stockAction(modeConfig('ask').carryOut!.prompt)).toMatchObject({ verb: 'Go ahead', tone: 'change' });
  });

  it('an error, an explanation, a TODO: what it was about', () => {
    expect(stockAction(fixErrorPrompt('unknown variable: vect'))).toMatchObject({ verb: 'Fix this error', rows: [{ text: 'unknown variable: vect' }] });
    expect(stockAction(EXPLAIN_PROMPT)).toMatchObject({ verb: 'Explain this passage', tone: 'look' });
    const todo = { path: 'chapters/ch1.typ', line: 12, text: 'check this date with the archive', kind: 'line-comment' as const };
    expect(stockAction(todoPrompt(todo))).toMatchObject({ verb: 'Work on this TODO', rows: [{ text: 'check this date with the archive' }] });
  });

  it('review comments: each comment, as the author wrote it', () => {
    const c = makeComment('c3', 'chapters/ch1.typ', '= Vectors\n\nA vector has size and direction.\n', 3, 1, 'Tighten this.');
    expect(stockAction(addressPrompt([{ comment: c, line: 3 }]))).toMatchObject({ verb: 'Fix this review comment', rows: [{ text: 'Tighten this.' }] });
    const two = addressPrompt([
      { comment: c, line: 3 },
      { comment: { ...c, id: 'c4', text: 'Cut it.\n\nOr say it once.' }, line: null },
    ]);
    expect(stockAction(two)).toMatchObject({ verb: 'Fix 2 review comments', rows: [{ text: 'Tighten this.' }, { text: 'Cut it.\n\nOr say it once.' }] });
  });

  it('Revise and Options from the selection bar: what the author asked for', () => {
    expect(stockAction(revisePrompt('Tighten it: fewer words, the same meaning'))).toMatchObject({ verb: 'Revise this passage', rows: [{ text: 'Tighten it: fewer words, the same meaning' }], tone: 'change' });
    expect(stockAction(revisePrompt('  Keep his voice.\n'))?.rows).toEqual([{ text: 'Keep his voice.' }]);
    // As it was sent until 0.9.1.
    const old = "Revise the selected passage: Rewrite it\n\nChange only that passage, in place. Keep what I didn't ask to change: labels, citations, math and markup. Then say in a sentence what you changed.";
    expect(stockAction(old)).toMatchObject({ verb: 'Revise this passage', rows: [{ text: 'Rewrite it' }] });
    expect(revisePrompt('x')).not.toContain("Keep what I didn't ask to change");
    expect(revisePrompt('x')).toContain('a proofread fixes mistakes and nothing else, while a rewrite can reorder, join, split or cut its sentences');
    expect(stockAction(optionsPrompt('More vivid'))).toMatchObject({ verb: 'Three options for this passage', rows: [{ text: 'More vivid' }], mode: 'options' });
    expect(stockAction(optionsPrompt('More vivid', 1))).toMatchObject({ verb: 'One option for this passage', rows: [{ text: 'More vivid' }], mode: 'options' });
    expect(stockAction(optionsPrompt('Shorter', 4))).toMatchObject({ verb: 'Four options for this passage', rows: [{ text: 'Shorter' }], mode: 'options' });
    expect(stockTitle(`${optionsPrompt('Shorter', 2)} Selected in the editor: ch1.typ`)).toBe('Two options for this passage: “Shorter”');
    expect(stockAction(OPTIONS_AGAIN_PROMPT)).toMatchObject({ verb: 'New options for this passage', note: 'as I’ve changed it', mode: 'options' });
    // As it was sent before the count could be chosen.
    expect(stockAction(OPTIONS_AGAIN_PROMPT.replace('Write new', 'Write three new'))).toMatchObject({ verb: 'New options for this passage', mode: 'options' });
    expect(stockAction(moreLikePrompt({ n: 2, label: 'Warmer', text: 'She smiled.\nThen left.' }))).toMatchObject({ verb: 'Three more like Option 2', rows: [{ text: 'Warmer' }], mode: 'options' });
    expect(stockAction(moreLikePrompt({ n: 1, label: '', text: '  The title\nand more' }, 1))).toMatchObject({ verb: 'One more like Option 1', rows: [{ text: 'The title' }], mode: 'options' });
    expect(messageLine(moreLikePrompt({ n: 3, label: 'Plain', text: 'A.' }, 5))).toBe('Five more like Option 3: “Plain”');
    // An option with Typst's own raw block in it: the fence round it is longer.
    const raw = moreLikePrompt({ n: 2, label: '', text: 'Run:\n```rust\nfn main() {}\n```' });
    expect(raw).toContain('\n````typst\nRun:\n```rust\nfn main() {}\n```\n````');
    expect(stockAction(raw)).toMatchObject({ verb: 'Three more like Option 2', rows: [{ text: 'Run:' }] });
    expect(stockAction(askPrompt('Why is everything after it bold?'))).toMatchObject({ verb: 'Ask about this passage', rows: [{ text: 'Why is everything after it bold?' }], tone: 'look', mode: 'ask' });
    expect(stockAction('Revise the selected passage: shorter')).toBeNull();
  });

  it('a passage changed two ways at once, mine or the assistant’s', () => {
    expect(stockAction(mergePrompt('chapters/ch2.typ', 'Their line.\nAnd another.', false))).toMatchObject({ verb: 'Combine both versions' });
    expect(stockAction(mergePrompt('chapters/ch2.typ', '', true))).toMatchObject({ verb: 'Combine both versions' });
  });

  it('a pick of the assistant’s two ways on, in its mode', () => {
    const s = { mode: 'discuss' as const, from: 'write' as const, there: 'Weigh Sam against Ada with you.', here: 'Go with Sam.' };
    expect(stockAction(modeChoiceMessage(s, true))).toMatchObject({ verb: 'Go on in Discuss', mode: 'discuss', rows: [{ text: 'Weigh Sam against Ada with you.' }] });
    expect(stockAction(modeChoiceMessage(s, false))).toMatchObject({ verb: 'Stay in Write', mode: 'write', rows: [{ text: 'Go with Sam.' }] });
  });

  it('answers to a reply’s questions: each question, then the answer', () => {
    const fields: FormField[] = [
      { key: 'q0', type: 'string', description: 'Which tone?', options: [{ value: 'Warm', label: 'Warm' }] },
      { key: 'q1', type: 'boolean', description: 'Add exercises?' },
    ];
    expect(stockAction(answersMessage(fields, { q0: 'Warm', q1: false }))).toMatchObject({
      verb: 'Answered the questions',
      rows: [
        { label: 'Which tone?', text: 'Warm' },
        { label: 'Add exercises?', text: 'No' },
      ],
    });
    expect(stockAction(answersMessage(fields.slice(1), { q1: 'Only for chapter 2' }))?.verb).toBe('Answered the question');
  });

  it('failing code examples, the style guide, editing instead, the starters', () => {
    const lines = ['- `area` printed 12, expected 13 (chapters/ch1.typ:40)', '- `vol` failed: NameError (chapters/ch2.typ:7)'];
    expect(stockAction(failingExamplesPrompt(lines))).toMatchObject({ verb: 'Fix the failing code examples', rows: [{ text: lines[0].slice(2) }, { text: lines[1].slice(2) }] });
    expect(stockAction(STYLE_DRAFT_MESSAGE)?.verb).toBe('Draft my style guide');
    expect(stockAction(STYLE_REDRAFT_MESSAGE)?.verb).toBe('Redraft my style guide');
    expect(stockAction(STYLE_INTERVIEW_MESSAGE)?.verb).toBe('Interview me');
    expect(stockAction(styleReviseMessage('Less formal.'))).toMatchObject({ verb: 'Revise my style guide', rows: [{ text: 'Less formal.' }] });
    expect(stockAction(styleReviseMessage('Less formal.\nNo semicolons.'))?.rows).toEqual([{ text: 'Less formal.\nNo semicolons.' }]);
    expect(stockAction(EDIT_INSTEAD_PROMPT)?.verb).toBe('Edit the file instead');
    expect(stockAction(STARTERS[1].prompt)).toMatchObject({ verb: 'Proofread the open chapter', tone: 'done' });
  });

  it('the author’s own words stay theirs', () => {
    // A starter sent as written, and messages that only start like one.
    expect(stockAction('How do I add a footnote?')).toBeNull();
    expect(stockAction(`${EXPLAIN_PROMPT} Then shorten it.`)).toBeNull();
    expect(stockAction('Work on this TODO in ch1.typ, please')).toBeNull();
    expect(stockAction('Write it')).toBeNull();
    expect(messageLine('Make chapter 2 shorter.')).toBe('Make chapter 2 shorter.');
  });
});

describe('an action in words', () => {
  it('a line for History and a folded turn, and text to copy', () => {
    expect(messageLine(modeConfig('discuss').carryOut!.prompt)).toBe('Write it');
    expect(messageLine(fixErrorPrompt('unknown variable: vect'))).toBe('Fix this error: “unknown variable: vect”');
    const a = stockAction(fixErrorPrompt('x'.repeat(100)))!;
    expect(actionLine(a)).toBe(`Fix this error: “${'x'.repeat(59)}…”`);
    expect(actionText(stockAction(EXPLAIN_PROMPT)!)).toBe('Explain this passage (in plain words)');
  });

  it('a task named after a stock message gets its action’s words', () => {
    const where = { relativePath: 'chapters/ch1.typ', start: { line: 3, column: 1 }, end: { line: 3, column: 20 }, selectedText: 'A vector' } as SourceSelection;
    // Codex: the whole first message, its selection after it.
    expect(stockTitle(`${EXPLAIN_PROMPT}\n\n${formatSelectionContext(where, false)}`)).toBe('Explain this passage');
    // Claude Code: on one line, cut at 256 characters.
    const review = addressPrompt([{ comment: makeComment('c1', 'chapters/ch1.typ', '= Vectors\n', 1, 1, 'Tighten this.'), line: 1 }]);
    expect(stockTitle(`${review.replace(/\s+/g, ' ').slice(0, 255)}…`)).toBe('Fix this review comment');
    expect(stockTitle(fixErrorPrompt('unknown variable: vect'))).toBe('Fix this error: “unknown variable: vect”');
    // A mode's reminder after the author's words isn't part of the title.
    expect(stockTitle(`${revisePrompt('Make it clearer').replace(/\s+/g, ' ')} ${modeConfig('write').reminder}`)).toBe('Revise this passage: “Make it clearer”');
    expect(stockTitle(`Is the opening too slow? ${modeConfig('write').reminder}`)).toBe('Is the opening too slow?');
    expect(stockTitle(`${revisePrompt('Make it clearer').replace(/\s+/g, ' ')} Selected in the editor: chapters/ch1.typ`)).toBe('Revise this passage: “Make it clearer”');
    expect(stockTitle(`${revisePrompt('x'.repeat(300)).replace(/\s+/g, ' ').slice(0, 255)}…`)).toBe('Revise this passage');
    expect(stockTitle(`${askPrompt('Is it clear?')} Selected in the editor: chapters/ch1.typ`)).toBe('Ask about this passage: “Is it clear?”');
    expect(stockTitle('Tighten the opening of chapter 2')).toBe('Tighten the opening of chapter 2');
  });
});
