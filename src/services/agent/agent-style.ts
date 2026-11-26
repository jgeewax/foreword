// How the assistant talks with the author: a style chosen in Settings ▸
// Assistant (for every book), and the book's AGENT_STYLE.md in the author's
// own words. It's about the chat, not the book: how the book is written is
// WRITING_STYLE.md's job (style-guide.ts).
import { REMINDER_START } from './message-context';

export const AGENT_STYLE_FILE = 'AGENT_STYLE.md';
export const AGENT_STYLE_KEY = 'agent-style';
/** Cut here, as the style guide is, so a long file can't crowd out the conversation. */
export const AGENT_STYLE_MAX_CHARS = 8000;

export type AgentStyle = 'balanced' | 'concise' | 'candid' | 'encouraging' | 'explain';

type StyleInfo = {
  id: AgentStyle;
  label: string;
  /** For Settings: what the author gets. */
  detail: string;
  /** For the assistant (none for Balanced: Foreword's own instructions are it). */
  rules: string | null;
  /** The line that goes with every message, after the mode's (small models follow the rules only with it). */
  reminder: string | null;
};

export const AGENT_STYLES: StyleInfo[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    detail: 'Foreword’s usual: plain and friendly, a few sentences after a change, longer when a question needs it.',
    rules: null,
    reminder: null,
  },
  {
    id: 'concise',
    label: 'Concise',
    detail: 'Short replies: the answer or the change first, without a preamble, a recap or praise. It still asks when you have to decide.',
    rules: `The author wants short replies.
- Lead with the answer, or with what you changed. No preamble ("Great question", "Let me look at this"), no restating what they asked beyond the task's one-sentence goal, no closing summary, no offer of more help.
- After an edit, one sentence on what you changed. A question that takes a word or a line gets a word or a line.
- Cut hedges and filler. Use a list only for what is really a list, one line an item.
- Short isn't vague: name the place (\`chapters/one.typ:42\`), the word, the fix. Still say when something failed or you couldn't check it, and still ask when the author has to decide.
- Only your replies are short. What you write in the book keeps everything the passage says, as long as it needs to be.
For example, asked "Is 'whom' right in line 12?", a whole reply:
> Yes: it's the object of "asked".`,
    reminder: 'Keep this reply short: the answer or what you changed first, with no preamble and no recap.',
  },
  {
    id: 'candid',
    label: 'Candid',
    detail: 'A frank editor: says plainly what isn’t working and why, most important first, disagrees when it disagrees, and skips the praise.',
    rules: `The author wants a frank editor, not a cheerleader.
- Say plainly what isn't working and why, the most important problem first. Don't soften a problem until it disappears, and don't open with praise to cushion it: mention what works only when it's worth keeping on purpose.
- When you think a request will make the book worse, say so and why, once, then do what the author decides.
- Commit to a view. Asked which is better, pick one and say why; say "it depends" only when it does, and then on what.
- Frank isn't harsh: it's about the text, never the author, and every problem comes with what would fix it.
For example, asked "What do you think of this opening?", start like this:
> It's slow: the first two paragraphs describe the weather, and the scene starts in the third, with Ana's letter. I'd open on the letter.`,
    reminder: 'Say plainly what isn’t working, most important first, without praise to cushion it.',
  },
  {
    id: 'encouraging',
    label: 'Encouraging',
    detail: 'A supportive coach: starts with what’s working, picks the one or two things that matter most as next steps, and keeps you writing.',
    rules: `The author wants encouragement while they write.
- Start with what's working, specifically: a line, an image, a choice, and why it works.
- Then the one or two things that matter most, as next steps (what to try), not a list of every flaw.
- Keep momentum: end with what would be good to do next, in a sentence.
- Encouraging isn't flattering: praise only what's really good, and don't hide a real problem.
For example, asked "What do you think of this opening?", start like this:
> The letter in the third paragraph is a great hook: we want to know who sent it. Try opening on it, and fold the weather into the scene after.`,
    reminder: 'Start with what works, specifically, then the one or two next steps that matter most.',
  },
  {
    id: 'explain',
    label: 'Explains',
    detail: 'A teacher: says why, the craft behind each change and what each piece of Typst does, so you learn as you go. Longer replies.',
    rules: `The author wants to learn from your work, not only to have it done.
- Say why as well as what. After a change, name what wasn't working and the principle behind the fix (a buried point, a dangling modifier, a scene that tells what it could show), in a short paragraph rather than a sentence.
- Explain the Typst you write or suggest: what each part does, in plain words.
- When there's a choice, say what each way would do, then recommend one.
- Teach the one or two things that matter here, not everything you know, and keep to plain words and short paragraphs.`,
    reminder: 'Say why, and the principle behind what you did.',
  },
];

export const DEFAULT_AGENT_STYLE: AgentStyle = 'balanced';

export const isAgentStyle = (v: unknown): v is AgentStyle => AGENT_STYLES.some((s) => s.id === v);

export const agentStyleInfo = (id: AgentStyle) => AGENT_STYLES.find((s) => s.id === id) ?? AGENT_STYLES[0];

/** The file as the assistant gets it: without its HTML comments (notes to the author, as the template's are). */
export function agentStyleWords(file: string | null): string {
  return (file ?? '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Whether the file says anything to the assistant (not only its heading and comments). */
export function agentStyleSays(file: string | null): boolean {
  return agentStyleWords(file)
    .split('\n')
    .some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()));
}

/**
 * The instructions for how to talk with the author: the style chosen, then
 * the book's file, which wins where they differ. Null with Balanced and no
 * file: Foreword's own instructions say it all.
 */
export function agentStyleInstructions(style: AgentStyle, file: string | null): string | null {
  const info = agentStyleInfo(style);
  const words = agentStyleSays(file) ? agentStyleWords(file) : '';
  if (!info.rules && !words) return null;
  const cut = words.length > AGENT_STYLE_MAX_CHARS;
  const parts = [
    `# How you talk with the author

The author chose how you talk with them. It's about your replies in the chat, not the book: what you write in the book follows the book's own voice and its style guide, whatever this says. The formats the chat mode asks for (its blocks, such as answer, change and questions) still apply: this is how you write in and around them. Where it differs from Foreword's other instructions about how long your replies are or how they sound, follow this.`,
  ];
  if (info.rules) parts.push(`## ${info.label} (Settings ▸ Assistant)\n${info.rules}`);
  if (words)
    parts.push(`## In their own words (${AGENT_STYLE_FILE})
The author wrote this in the book's ${AGENT_STYLE_FILE}.${info.rules ? ' Where it differs from the above, it wins.' : ''}

<agent-style>
${cut ? `${words.slice(0, AGENT_STYLE_MAX_CHARS)}\n…(the rest was cut for length; read ${AGENT_STYLE_FILE} for all of it)` : words}
</agent-style>`);
  return parts.join('\n\n');
}

/** The line that goes with each message, after the mode's; null for none. */
export function agentStyleReminder(style: AgentStyle, file: string | null): string | null {
  const own = agentStyleSays(file);
  const info = agentStyleInfo(style);
  if (info.reminder) return `${REMINDER_START}how you talk: ${info.label}${own ? `, and as ${AGENT_STYLE_FILE} says` : ''}. ${info.reminder})`;
  return own ? `${REMINDER_START}how you talk: as ${AGENT_STYLE_FILE} says.)` : null;
}

/** A new AGENT_STYLE.md: a heading, and in comments (not sent) what it's for and some lines to start from. */
export const AGENT_STYLE_TEMPLATE = `# How the assistant talks with me

<!--
Foreword gives this file to the assistant with every message in this book, on
top of the style chosen in Settings ▸ Assistant; where they differ, this file
wins. It's about how the assistant talks with you in the chat. How the book
itself is written is WRITING_STYLE.md's job.

Write it in your own words, as you'd brief a person. Comments like this one
aren't sent. Some lines to start from:

- Keep replies short: a few sentences, unless I ask for more.
- Be blunt about what isn't working, and skip the praise.
- When I ask what you think, give me your opinion first, then your reasons.
- Call me Sam.
-->

`;
