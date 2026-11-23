import { describe, expect, it } from 'vitest';
import { AUTO_INSTRUCTIONS, autoReminder, pickMode, type AutoCues } from './auto-mode';
import { AGENT_MODES, modeConfig, type AgentMode } from './modes';
import { optionsReminder } from './options-mode';

/** Phrasings, and the mode each should go in. A wrong pick in use is a line here. */
const CASES: [string, AgentMode, AutoCues?][] = [
  // The ones that started it (2026-11-21).
  ['make this paragraph shorter', 'write'],
  ['give me three options for this paragraph', 'options'],
  ['what is this section trying to say?', 'ask'],
  ['why did this change happen?', 'ask', { change: true }],
  ['I’m not sure this section adds anything', 'discuss'],
  ['review this and suggest what to change', 'review'],

  // Write: a change asked for, however it's put.
  ['Tighten this.', 'write'],
  ['can you tighten this?', 'write'],
  ['Could you make the opening clearer?', 'write'],
  ['please rewrite it in plain English', 'write'],
  ['shorter', 'write'],
  ['a bit warmer', 'write'],
  ['less jargon', 'write'],
  ['in the present tense', 'write'],
  ['Fix the typos in chapter 3', 'write'],
  ['Remove every “clearly” from the book', 'write'],
  ['Merge sections 2.3 and 2.4', 'write'],
  ['Move the example before the proof', 'write'],
  ['Add a footnote citing Strang here', 'write'],
  ['Translate this sentence into French', 'write'],
  ['Change "utilize" to "use" throughout', 'write'],
  ['This needs to be shorter.', 'write'],
  ['The intro should be one sentence.', 'write'],
  ['This is too long, cut it in half', 'write'],
  ['Proofread chapter 3 and fix what you find', 'write'],
  ['Let’s cut section 2.4', 'write'],
  ['ok, let’s go with the second direction', 'write'],
  ['Do it', 'write'],
  ['yes, go ahead', 'write'],
  ['Write the next section, on projections', 'write'],
  ['Make sure the notation is consistent with chapter 2', 'write'],
  ['Why is this so long? Cut it.', 'write'],
  ['Undo that', 'write'],
  ['now make the conclusion match', 'write'],

  // Options: versions to pick from.
  ['three ways to open this chapter', 'options'],
  ['Give me a few alternatives', 'options'],
  ['can you give me 4 versions of this sentence?', 'options'],
  ['suggest some titles for chapter 5', 'options'],
  ['a few ways to say this more simply', 'options'],
  ['more like 2', 'options', { last: 'options' }],
  ['shorter ones', 'options', { last: 'options' }],
  ['another three', 'options', { last: 'options' }],

  // Ask: a question, answered.
  ['What does this proof show?', 'ask'],
  ['Explain the second paragraph', 'ask'],
  ['can you explain this?', 'ask'],
  ['Where do I first define the dot product?', 'ask'],
  ['How many times do I use “clearly”?', 'ask'],
  ['How do I add a footnote in Typst?', 'ask'],
  ['Summarize chapter 2', 'ask'],
  ['Is this paragraph clear?', 'ask'],
  ['Is chapter 3 too long compared to the others?', 'ask'],
  ['Does this paragraph work?', 'ask'],
  ['what do you think this sentence means?', 'ask'],
  ['Why did you change this?', 'ask'],
  ['Who is Ada?', 'ask'],
  ['Show me a chart of chapter lengths', 'ask'],
  ['What are my options for structuring part 2?', 'ask'],
  ['Cut the second paragraph?', 'ask'],
  ['what’s the difference between eigenvalues and change of basis?', 'ask'],
  ['What does this mean:\nAdd the two vectors, then scale the result.', 'ask'],
  ['Tell me what the plot of chapter 4 is', 'ask'],
  ['and what about chapter 4?', 'ask', { last: 'ask' }],
  ['and why did you cut the example?', 'ask', { last: 'write' }],
  ['thanks!', 'ask'],

  // Review: what to fix, suggested.
  ['Review chapter 3 for clarity', 'review'],
  ['Proofread', 'review'],
  ['proofread this, please', 'review'],
  ['Check this paragraph', 'review'],
  ['Can you check chapter 3 for typos?', 'review'],
  ['What would you change here?', 'review'],
  ['what’s wrong with this paragraph?', 'review'],
  ['Any typos?', 'review'],
  ['How can I improve this?', 'review'],
  ['Feedback on the opening, please', 'review'],
  ['could this be tighter?', 'review'],
  ['Go over the conclusion', 'review'],
  ['Check it against my style guide', 'review'],
  ['The ending feels rushed', 'review'],
  ['This drags', 'review'],
  ['this paragraph is too long', 'review'],
  ['I think the ending is a bit abrupt', 'review'],
  ['The second example doesn’t work', 'review'],
  ['what about chapter 4?', 'review', { last: 'review' }],

  // Discuss: a direction weighed.
  ['Should I merge sections 2.3 and 2.4?', 'discuss'],
  ['should this come before the proof?', 'discuss'],
  ['Does this section need the second example?', 'discuss'],
  ['Is this chapter even necessary?', 'discuss'],
  ['What if the book opened with the application instead?', 'discuss'],
  ['Let’s talk about the structure of part 2', 'discuss'],
  ['help me decide between the two openings', 'discuss'],
  ['What do you think of this paragraph?', 'discuss'],
  ['Thoughts?', 'discuss'],
  ['I wonder if chapter 3 should come first', 'discuss'],
  ['I think we should cut 2.4', 'discuss'],
  ['maybe it belongs in an appendix', 'discuss'],
  ['Brainstorm titles for chapter 5', 'discuss'],
  ['Is it worth keeping the history aside?', 'discuss'],
  ['I’m torn between Sam and Ada as narrator', 'discuss'],
  ['but doesn’t the proof need the example?', 'discuss', { last: 'discuss' }],
  ['fair. what about the reader who skips ahead?', 'discuss', { last: 'discuss' }],
  ['The ending feels rushed too', 'discuss', { last: 'discuss' }],

  // Figures: something to draw.
  ['Draw a diagram of the dot product', 'figures'],
  ['add a bar chart of the results', 'figures'],
  ['Make a flowchart of the proof', 'figures'],
  ['turn this list into a table', 'figures'],
  ['A timeline of the main results', 'figures'],
  ['can you plot a graph of f(x) = x^2?', 'figures'],
  ['Make the plot less predictable', 'write'],
  ['Add a scene in the drawing room', 'write'],
  ['Draw the reader in with a question', 'write'],

  // Follow-ups go on in the mode before.
  ['and the next paragraph', 'write', { last: 'write' }],
  ['same for section 2.5', 'write', { last: 'write' }],
  ['try again', 'options', { last: 'options' }],
  ['I meant the other paragraph', 'review', { last: 'review' }],

  // Tried on phrasings written after the rules were (2026-11-21: 29 of 45 at first, then 40 of 42).
  ['is the tone right for a first chapter?', 'ask'],
  ['does the argument in 2.3 hold up?', 'ask'],
  ['how does chapter 4 connect to chapter 2?', 'ask'],
  ['what did I say about orthogonality earlier?', 'ask'],
  ['which chapter is the longest?', 'ask'],
  ['are there any places where I contradict myself?', 'ask'],
  ['find every place I use the passive voice', 'ask'],
  ['where does the reader get lost?', 'ask'],
  ['can you take a look at the intro?', 'review'],
  ['I hate this sentence', 'review'],
  ['this sentence is awful', 'review'],
  ['the transition here is clunky', 'review'],
  ['this reads like a textbook', 'review'],
  ['honestly I think chapter 5 is the weakest', 'review'],
  ['what would make this land harder?', 'review'],
  ['make it sing', 'write'],
  ['punch it up a bit', 'write'],
  ['give it a stronger ending', 'write'],
  ['replace the analogy with something about music', 'write'],
  ['can we lose the second example?', 'write'],
  ['would you mind trimming this?', 'write'],
  ['I need this under 200 words', 'write'],
  ['get this down to one paragraph', 'write'],
  ['now do the same for chapter 4', 'write', { last: 'write' }],
  ['what are three other ways to put this?', 'options'],
  ['write me five opening lines', 'options'],
  ['some other titles?', 'options'],
  ['should the proof go in an appendix?', 'discuss'],
  ['I feel like part 2 is in the wrong order', 'discuss'],
  ['what do you think about splitting chapter 3?', 'discuss'],
  ['is the second example redundant?', 'discuss'],
  ['let me think about whether to keep this', 'discuss'],
  ['hmm, not convinced', 'discuss'],
  ['play devil’s advocate on cutting chapter 2', 'discuss'],
  ['draw the unit circle with the vectors', 'figures'],
  ['add a figure showing the projection', 'figures'],
  ['add a sentence about the graph', 'write'],
  ['what does figure 3 show?', 'ask'],
  ['fix the caption on figure 3', 'write'],
  ['the table on page 12 is confusing', 'review'],
  ['change of basis: explain it simply', 'ask'],
  ['Add two vectors: what happens?', 'ask'],
  ['ok', 'ask'],
  ['great, thanks', 'ask', { last: 'write' }],
  ['perfect', 'review', { last: 'review' }],
  ['tidy up the references section', 'write'],
  ['can you make the dialogue snappier?', 'write'],
  ['simplify the notation in 3.2', 'write'],
  ['bring the example forward', 'write'],
  ['give the chapter a better title', 'write'],
  ['cut anything that repeats chapter 2', 'write'],
  ['I want the opening to be more inviting', 'write'],
  ['use British spelling throughout', 'write'],
  ['expand the proof sketch into a full proof', 'write'],
  ['mention the Gram-Schmidt process here', 'write'],
  ['please fix line 40', 'write'],
  ['spell out the abbreviations', 'write'],
  ['what is a basis?', 'ask'],
  ['when did I introduce matrices?', 'ask'],
  ['why does the proof start with a lemma?', 'ask'],
  ['is this consistent with chapter 2?', 'ask'],
  ['how long is chapter 6?', 'ask'],
  ['what does the reader need to know before this?', 'ask'],
  ['does chapter 7 ever use this result?', 'ask'],
  ['explain what you just did', 'ask'],
  ['who says this line?', 'ask'],
  ['tell me about the structure of the book', 'ask'],
  ['check the maths in this section', 'review'],
  ['is there anything confusing here?', 'review'],
  ['go through chapter 2 for consistency', 'review'],
  ['critique the opening', 'review'],
  ['this paragraph is a bit dense', 'review'],
  ['the explanation feels thin', 'review'],
  ['this section reads like a list', 'review'],
  ['what could be cut?', 'review'],
  ['should we keep the historical note?', 'discuss'],
  ['I’m wondering whether part 3 needs its own intro', 'discuss'],
  ['would it be better to start with an example?', 'discuss'],
  ['is the second proof worth including?', 'discuss'],
  ['what’s your take on the ending?', 'discuss'],
  ['I keep going back and forth on the title', 'discuss'],
  ['four versions of the first line', 'options'],
  ['a couple of alternatives for this heading', 'options'],
  ['give me some options', 'options'],
  ['draw a diagram showing the span of two vectors', 'figures'],
  ['create a table comparing the methods', 'figures'],
  ['a graph of the error against n', 'figures'],

  // A change attached: about it, unless it asks for something done.
  ['Was this needed?', 'ask', { change: true }],
  ['put it back', 'write', { change: true }],
];

describe('Auto’s pick for a message', () => {
  it.each(CASES)('“%s” goes in %s', (text, mode, cues) => {
    expect(pickMode(text, cues).mode).toBe(mode);
  });

  it('nothing but files: as the message before, else an answer', () => {
    expect(pickMode('', { last: 'review' }).mode).toBe('review');
    expect(pickMode('  ').mode).toBe('ask');
  });

  it('what it can’t place goes in a mode that can’t change the book', () => {
    expect(pickMode('Chapter 3').mode).toBe('ask');
    expect(pickMode('Chapter 3', { last: 'write' }).mode).toBe('ask');
    expect(pickMode('Chapter 3', { last: 'review' }).mode).toBe('review');
  });

  it('says why, for the message box', () => {
    expect(pickMode('Proofread').why).toBe('you asked for a review: a change for each problem, to make or skip');
    expect(pickMode('and the next one', { last: 'write' }).why).toBe('a follow-up: Write again');
  });
});

describe('what the assistant is told in Auto', () => {
  it('every mode’s instructions at once, and how a message names its mode', () => {
    for (const m of AGENT_MODES) expect(AUTO_INSTRUCTIONS).toContain(modeConfig(m).instructions!);
    expect(AUTO_INSTRUCTIONS.startsWith('# Auto: a mode for each message')).toBe(true);
  });

  it('each message’s mode, as one note with its own reminder', () => {
    expect(autoReminder('review', modeConfig('review').reminder)).toMatch(
      /^\(Foreword, Auto: this message is in Review mode, whatever mode earlier ones were in\. Reply as your Review mode instructions say\. Start with/,
    );
    expect(autoReminder('options', optionsReminder(3))).toBe(
      '(Foreword, Auto: this message is in Options mode, whatever mode earlier ones were in. Start with the ```replaces block that says what they replace (`at:` the file and line, `find:` the passage exactly as it is in the file), then write exactly three options, Option 1 to Option 3, in the format your Options mode instructions give.)',
    );
    expect(autoReminder('figures', null)).toBe('(Foreword, Auto: this message is in Figures mode, whatever mode earlier ones were in. Reply as your Figures mode instructions say.)');
  });
});
