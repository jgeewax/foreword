// Auto: Foreword picks the mode for each message the author types, from what
// it asks for (each mode gives back one kind of thing, modes.ts), and the
// message box shows the pick before it goes. Only a request to change the
// text goes in Write (or, for a figure, Figures); a message it can't place
// goes in a mode that can't change the book, so a wrong pick costs a click,
// never an edit. Buttons (the selection bar, a card's Make this change, a
// direction's Write it) name their own mode, so only typed messages need it.
//
// The assistant has every mode's instructions at once (AUTO_INSTRUCTIONS),
// and each message names its mode (autoReminder): a pick changes what the
// assistant may do, never its instructions. In Claude Code they're the system
// prompt, and changing them starts the conversation again without its cache.
import { AGENT_MODES, modeConfig, type AgentMode } from './modes';

/** The assistant's instructions in Auto: what it is, then every mode's own. */
export const AUTO_INSTRUCTIONS = `# Auto: a mode for each message

The author has Foreword pick the chat's mode for each of their messages, from what they ask: Write (the change, made in the book), Ask (an answer, with nothing to change), Discuss (your view, the questions that would settle it, and directions to take), Review (a change for each problem found, which the author makes or skips), Options (versions of a passage to pick from) or Figures (diagrams, charts, illustrations). Each message names its mode, in a note after the author's words: "(Foreword, Auto: this message is in Review mode…)".

Reply to each message as that mode's section below says, whatever mode the messages before it were in: in a section, "this mode" means a message in that mode. Only in Write and Figures can you change files; in the others, any change you try is refused. If the mode picked doesn't fit the message, answer what you can in it and offer the one that fits (Another mode for this?).

${AGENT_MODES.map((m) => modeConfig(m).instructions)
  .filter(Boolean)
  .join('\n\n')}`;

/**
 * With every message in Auto, after the author's words: the mode it's in, then
 * that mode's own reminder of how to reply (`own`, "(Foreword, Review mode: …)"),
 * as one note.
 */
export function autoReminder(mode: AgentMode, own: string | null): string {
  const { label } = modeConfig(mode);
  const head = `(Foreword, Auto: this message is in ${label} mode, whatever mode earlier ones were in.`;
  const prefix = `(Foreword, ${label} mode: `;
  const rest = own?.startsWith(prefix) ? own.slice(prefix.length) : null;
  return rest ? `${head} ${rest[0].toUpperCase()}${rest.slice(1)}` : `${head} Reply as your ${label} mode instructions say.)`;
}

/** The mode for a message, and why, in a few words for the message box ("you asked for a review: …"). */
export type AutoPick = { mode: AgentMode; why: string };

/** What else goes into the pick: a change attached (Ask About This Change), and the mode of the message before it in the chat (null: none yet). */
export type AutoCues = { change?: boolean; last?: AgentMode | null };

const WHY = {
  change: 'a change is attached: an answer about it',
  figure: 'you asked for a figure',
  options: 'you asked for versions to pick from',
  edit: 'you asked for a change: it’s made in the book',
  review: 'you asked for a review: a change for each problem, to make or skip',
  problem: 'you named a problem: a change for each, to make or skip',
  discuss: 'you’re weighing it up: a view, questions and directions',
  question: 'a question: an answer, with nothing changed',
  unsure: 'nothing here asks for a change: an answer',
};
const followUp = (m: AgentMode) => `a follow-up: ${modeConfig(m).label} again`;

// ---- the words it goes by ------------------------------------------------------------------

/** Lower case, plain quotes and spaces; a section number's or an abbreviation's full stop isn't a sentence's end. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\d)\.(?=\d)/g, '$1·')
    .replace(/\b(e\.g|i\.e|etc|vs|cf|fig|eq|ch|sec|p|pp)\./g, (m) => m.replace(/\./g, ''))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * The author's own words: without what they quote (a passage pasted after a
 * colon, words in quotes), whose sentences ("Add the two vectors.") aren't
 * asks of theirs.
 */
function ownWords(t: string): string {
  const pasted = t.search(/:[ \t]*\n/);
  return (pasted > 0 ? t.slice(0, pasted + 1) : t).replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, '"…"').replace(/\s*\n\s*/g, '\n');
}

/** Its sentences, and requests joined on ("tighten it, then check the math"), each with its own end ("?"). */
function partsOf(t: string): string[] {
  const sentences = t.match(/[^.!?;:\n]+[.!?;:]*/g) ?? [];
  return sentences
    .flatMap((s) => s.split(/,\s*(?=(?:and then|then|so|now|please|just|can you|could you|would you)\s)|\s+(?=and then\s)/))
    .map((s) => s.trim().replace(/^(?:and then|then|so|now)\s+/, ''))
    .filter(Boolean);
}

/** Words that open a message without saying what it asks: "ok so", "thanks!", "first,". */
const FILLER = /^(?:ok(?:ay)?|alright|all right|right|so|well|hmm+|um+|uh+|hey|hi|thanks|thank you|great|good|nice|cool|perfect|fine|sure|yes|yeah|yep|yup|no|nope|now|and|but|also|actually|honestly|oh|ah|wait|(?:first|next|then|finally|lastly)(?=,))\b[\s,.!:;-]*/;

/** Words that make a request polite, before what it asks for: "please", "can you", "let's", "help me". */
const POLITE = /^(?:please|pls|kindly|can you|could you|would you(?! mind)|will you|can we|could we|let'?s|let us|we should|you should|i want you to|i'd like you to|i would like you to|i need you to|go ahead and|just|help me|try to|try and)\b[\s,]*/;

type Part = { said: string; text: string; polite: boolean };

/** A part without its filler (`said`), and without its politeness too (`text`). */
function opening(part: string): Part {
  let said = part;
  for (let i = 0; i < 4 && FILLER.test(said); i++) said = said.replace(FILLER, '');
  let text = said;
  let polite = false;
  for (let i = 0; i < 3 && POLITE.test(text); i++) {
    text = text.replace(POLITE, '');
    polite = true;
  }
  return { said, text, polite };
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** What a sentence is about: "this", "the opening", "chapter 3", "section 2.4". */
const SUBJECT = "(?:(?:the|this|that|these|those|my|our|your) [\\w\\s'·-]{1,40}?|it|this|that|these|those|(?:chapter|section|part|paragraph|sentence) [\\w·]+(?: [\\w·]+)?)";

/** Verbs that ask for a change to the text. */
const EDIT_VERBS = [
  'make(?! sense\\b)',
  're-?write',
  're-?do',
  're-?phrase',
  're-?word',
  're-?work',
  'shorten',
  'lengthen',
  'tighten',
  'trim',
  'cut',
  'delete',
  'remove',
  'drop',
  'lose',
  'add',
  'insert',
  'include',
  'put',
  'move',
  'swap',
  'replace',
  'change(?! of\\b)',
  'fix',
  'correct',
  'simplify',
  'clarify',
  'expand',
  'extend',
  'elaborate on',
  'flesh out',
  'condense',
  'compress',
  'merge',
  'combine',
  'join',
  'split',
  'break up',
  'reorder',
  're-?arrange',
  're-?structure',
  're-?organi[sz]e',
  're-?name',
  're-?title',
  'translate',
  'turn',
  'convert',
  'write',
  'draft',
  'finish',
  'complete',
  'continue (?:the|this|that|writing|with|from)',
  'polish',
  'edit',
  'revise',
  'update',
  'improve',
  'smooth',
  'punch up',
  'tone down',
  'soften',
  'strengthen',
  'sharpen',
  'bold',
  'itali[cs]i[sz]e',
  'emphasi[sz]e',
  're-?format',
  'format(?! of\\b)',
  're-?number',
  'number(?! of\\b)',
  'use(?! of\\b)',
  'apply',
  'undo',
  'revert',
  'restore',
  'implement',
  'do (?:it|that|this|the|so|them|those|both|all|each|one|number|option)',
  'go (?:with|ahead|for it)',
  'mention',
  'cite',
  'spell out',
  'capitali[sz]e',
  'lower-?case',
  'unify',
  'standardi[sz]e',
  'make sure',
  'ensure',
  'get rid of',
  'take out',
  'pull out',
  'bring back',
  'flip',
  'reverse',
  'adapt',
  'adjust',
  'tweak',
  'fill in',
  'beef up',
  'streamline',
  'declutter',
  'untangle',
  'tidy',
  'clean up',
  'sort',
  'alphabeti[sz]e',
  'indent',
  'align',
  'resolve',
  'address',
  'accept',
  'keep (?:it|this|the|that|them) (?:under|below|short|brief|to)',
  'start (?:a|the|with|over)',
  'begin (?:a|the|with)',
  'end (?:it|the|with|on)',
  'open (?:it|with)',
  'close (?:it|with|on)',
  'introduce',
  'link',
  'reference',
  'label',
  'caption',
  'wrap',
  'quote',
  'draw (?:the reader|readers|them) in',
].join('|');

/** A request for a change to the text, at its start. */
const EDIT = new RegExp(`^(?:${EDIT_VERBS})\\b`);

/** A comparative on its own, as a request ("shorter", "a bit warmer", "in plain English"). */
const BARE =
  /^(?:(?:much|a lot|way|a bit|a little|slightly|even|bit)\s+)?(?:shorter|longer|tighter|clearer|simpler|punchier|warmer|cooler|crisper|sharper|smoother|friendlier|funnier|darker|lighter|stronger|softer|plainer|briefer|snappier|livelier|calmer|more\s+\w+|less\s+\w+|fewer\s+\w+|in (?:plain|simple|simpler) (?:english|words|language|terms)|without (?:the\s+)?\w+|as (?:a list|bullets|bullet points|prose|one sentence|two sentences)|in (?:one|two|three) sentences?|in (?:the )?(?:present|past|future) tense|in (?:the )?(?:first|second|third) person)\b[^?]*$/;

/** What the text should be, said of it: "this needs to be shorter", "the intro should be one sentence". */
const NEEDS = new RegExp(
  `^${SUBJECT}\\s+(?:needs to be|has to be|should be|must be|ought to be|needs|should|must)\\s+(?:(?:a lot|much|way|a bit|a little|slightly|even)\\s+)?(?:shorter|longer|tighter|clearer|simpler|punchier|warmer|crisper|sharper|smoother|friendlier|plainer|stronger|softer|cut|trimmed|removed|deleted|moved|merged|split|rewritten|shortened|tightened|expanded|in\\s|one\\s|a\\s|an\\s|more\\s|less\\s|\\w+er\\b)`,
);

/** "Proofread chapter 3 and fix what you find": a review whose finds are to be made. */
const AND_EDIT = new RegExp(`\\band (?:then )?(?:${EDIT_VERBS})\\b`);

/** "This is too long, cut it": a change asked for after a comma, at the end. */
const COMMA_EDIT = new RegExp(`,\\s*(?:${EDIT_VERBS})\\b[^,?]*$`);

/**
 * An instruction that starts with a verb, about the text ("punch it up", "get
 * this down to a page", "give it a stronger ending"): a request, unless the
 * verb asks for an answer or a look ("explain this", "check the proof").
 */
const NOT_EDIT_VERB =
  '(?:explain|summari[sz]e|describe|show|list|find|count|compare|outline|tell|check|review|read|look|see|consider|imagine|note|remember|think|leave|ignore|skip|try|help|let|ask|answer|search|locate|identify|trace|walk|guess|assume|suppose|picture|recall|forget|reconsider|discuss|weigh|evaluate|assess|critique|grade|rate|rank|judge|analy[sz]e|interpret|define|study|scan|verify|confirm|test|watch|keep in mind|mind|is|are|was|were|be|been|do|does|did|has|have|had|can|could|would|will|shall|should|may|might|must|not|no|so|then|now|maybe|perhaps|why|what|how|where|when|who|which|whose|there|here|i|we|you|he|she|they|it|this|that|these|those|the|a|an|my|our|your|their|his|her|its|one|some|any|all|each|every|chapter|section|part|paragraph|sentence|page|line|figure|table|equation|book|reader|readers|thanks|thank|great|good|nice|cool|perfect|fine|ok|okay|yes|no|hmm)';
const VERB_FIRST = new RegExp(`^(?!${NOT_EDIT_VERB}\\b)[a-z]+ (?:it|this|that|these|those|them|the|my|our|every|all|each|its|some)\\b`);

/** What the author wants of the text: "I need this under 200 words", "I want it gone". */
const WANT = new RegExp(
  `^(?:i need|i want|i'd like|i would like|we need|i'd prefer|i prefer)\\s+${SUBJECT}\\s+(?:to be\\s+|to read\\s+|to sound\\s+)?(?:under|below|shorter|longer|tighter|clearer|simpler|gone|removed|cut|down|in|as|more|less|one|a|an|\\w+er\\b)`,
);

/** "Would you mind trimming this?": a request, its verb as a gerund. */
const GERUND = /^(?:would you mind|do you mind|could you try|how about) (\w+)ing\b/;
const gerundEdit = (s: string) => {
  const stem = GERUND.exec(s)?.[1];
  return !!stem && [stem, `${stem}e`, stem.replace(/(\w)\1$/, '$1')].some((v) => EDIT.test(v));
};

/** A figure, as what's to be made. */
const FIGURE_NOUN = '(?:diagram|flow ?chart|chart|graph|plot(?= of\\b)|figure|illustration|drawing|timeline|infographic|table(?! of contents))s?';
const FIGURE_MAKE = new RegExp(
  `^(?:draw|make|add|create|plot|chart|graph|design|build|render|insert|put|turn|convert|redraw|redo|generate|produce|include|give me|i need|i want|i'd like|we need)\\s+(?:(?:me|us|it|this|that)\\s+)?(?:(?:a|an|the|some|another|one|more|two|three|new|simple|small|little|quick|nice|this|that|these)\\s+)*(?:[\\w-]+\\s+){0,2}${FIGURE_NOUN}\\b`,
);
const FIGURE_INTO = new RegExp(`^(?:turn|convert|make|redo)\\s+.{0,40}?\\binto (?:a|an)\\s+(?:[\\w-]+\\s+)?${FIGURE_NOUN}\\b`);
const FIGURE_START = new RegExp(`^(?:an?|another|one more)\\s+(?:[\\w-]+\\s+){0,3}${FIGURE_NOUN}\\b`);
const DRAW = /^draw\b(?! (?:on|from|out|attention|a conclusion|conclusions|the reader|them|him|her|readers))/;

/** Versions to pick from: "three versions", "a few ways to say it", "give me options". */
const NUM = '(?:\\d+|two|three|four|five|six|seven|eight|nine|ten)';
const VERSIONS = '(?:versions|options|alternatives|variations|variants|takes|rewrites|drafts|openings|opening lines|first lines|titles|headings|headlines|endings|closing lines|phrasings|wordings|captions|taglines)';
const OPTIONS = [
  new RegExp(`\\b(?:${NUM}|a few|a couple(?: of)?|several|some|more|another)\\s+(?:(?:more|other|different|alternative|new|possible|short|shorter|longer|better)\\s+)*${VERSIONS}\\b`),
  new RegExp(`\\b${NUM}\\s+(?:(?:more|other|different|alternative|new)\\s+)*ways\\b`),
  /\b(?:a few|a couple(?: of)?|some|several|other|different)\s+ways\s+(?:to|of)\s+(?:say|put|phrase|word|write|open|start|begin|end|close|title|express)/,
  /\b(?:give|show|offer|suggest|write)\s+(?:me\s+|us\s+)?(?:some\s+|a few\s+)?(?:options|alternatives|versions|variations|variants)\b/,
  /\balternatives?\s+(?:to|for)\b/,
  /^(?:options|versions|alternatives|variations)\b/,
  /\bmore like (?:option |#|number )?\d\b/,
];
/** "What are my options for the structure?" is a question of direction, not versions of a passage. */
const OPTIONS_NOT = /\bwhat (?:are|were|'re) (?:the|my|our|some|your) (?:options|alternatives)\b/;

/** Asks for a review, at the start: "proofread", "check chapter 3", "go over the opening". */
const REVIEW_START =
  /^(?:review|re-?read|proof-?read|proof read|copy-?edit|copy edit|line-?edit|line edit|critique|check|double-?check|fact-?check|sanity-?check|look (?:over|through)|(?:take|have) a (?:quick |close |good )?look(?: at| over)?|go (?:over|through)|read (?:over|through)|audit|vet|assess|evaluate|grade|mark up|inspect|examine|give me (?:feedback|notes|a review|your notes|a critique)|any (?:typos|mistakes|errors|problems|issues|notes|feedback|suggestions))\b/;

/** Asks for what to fix, anywhere: "what would you change?", "feedback on", "any typos". */
const REVIEW_ANY = [
  /\b(?:what(?:'s| is| are)|anything|something)\s+(?:wrong|off|weak|broken|missing|confusing|unclear|awkward|clunky)\s+(?:with|in|about|here)\b/,
  /\bwhat would you (?:change|fix|cut|improve|tighten|trim|rewrite|do differently|drop|lose)\b/,
  new RegExp(`\\bwhat would make ${SUBJECT} (?:better|stronger|clearer|land|work|sing|flow|\\w+er)\\b`),
  /\bwhat (?:should|could|can|do|would) (?:i|we) (?:change|fix|cut|improve|tighten|trim|drop|lose)\b/,
  /\bwhat to (?:change|fix|cut|improve|tighten|trim|drop|lose)\b/,
  /\bwhat (?:could|should|can|might) be (?:cut|changed|improved|fixed|trimmed|dropped|tightened|better)\b/,
  /\b(?:ways|how) to (?:improve|tighten|strengthen|fix|sharpen|clean up|polish)\b/,
  /\bhow (?:can|could|would|should|do|might) (?:i|we|you|it|this) (?:improve|tighten|fix|strengthen|sharpen|clean up|polish|be improved|be better|be tightened)\b/,
  /\b(?:feedback|a critique|suggestions|edits) (?:on|for|about)\b/,
  /\b(?:spot|catch|find|flag|list) (?:any |the |all (?:the )?)?(?:typos|mistakes|errors|problems|issues|inconsistencies|repetitions|clich[ée]s|weak spots|passive voice)\b/,
  /\bany (?:typos|mistakes|errors|problems|issues|inconsistencies)\b/,
  new RegExp(`^(?:could|can) ${SUBJECT} be (?:\\w+er|better|improved|tightened|cut|trimmed|condensed|simplified|clearer|more \\w+|less \\w+)\\b`),
  /\bagainst (?:my|the) style guide\b/,
  /\bfor (?:clarity|typos|grammar|flow|consistency|style|tone|accuracy|concision|pacing)\b/,
];

/** Doubt, or a direction being weighed, at the start: "I'm not sure…", "should we…", "what if…". */
const DISCUSS_START = new RegExp(
  `^(?:i'?m not sure|i am not sure|not sure|i'?m unsure|unsure|i'?m not convinced|not convinced|i wonder|i'?m wondering|wondering|i'?m thinking|i was thinking|i'?ve been thinking|thinking (?:about|of)|i think|i feel|i don'?t think|i don'?t know (?:if|whether|about)|i doubt|i'?m torn|torn|i'?m worried|worried|i'?m on the fence|i can'?t decide|i'?m undecided|i'?m (?:leaning|tempted)|help me (?:decide|think|figure|weigh|work out|choose)|let'?s (?:talk|think|discuss|brainstorm|figure|weigh|consider|explore)|talk (?:me )?(?:through|about)|think (?:through|about)|brainstorm|discuss|should (?:i|we|this|it|the|these|those|that|there|chapter|section|part)|shall (?:i|we)|would it (?:be better|make sense|help|work)|is it (?:worth|better|wise|a good idea|necessary|needed)|(?:is|are) ${SUBJECT} (?:(?:even|really|actually|still|truly) )?(?:worth|necessary|needed|essential|redundant)|does ${SUBJECT} (?:(?:even|really|actually|still|truly) )?(?:need|belong|earn|add|deserve|matter|pull its weight|fit|serve)|do (?:i|we) (?:need|want|really)|what if|how about (?:we|i|cutting|moving|merging|splitting|adding|dropping|starting|ending|making|keeping|losing|using|having|changing|turning)|what do you think(?:\\?|$| of| about)|what'?s your (?:take|view|opinion|sense)|your (?:take|view|opinion|thoughts)|thoughts\\b|how do you feel about|pros and cons|which (?:is|would be|works|reads) better|which (?:order|structure|approach|option|way)|is there a better (?:way|structure|order|approach|place|home)|what'?s the best (?:way|order|structure|approach|place)|where should|how should (?:i|we)|why not|am i (?:right|wrong|crazy)|is it just me|maybe|perhaps|let me (?:think|mull|consider|weigh|sleep on)|(?:play )?devil'?s advocate|argue (?:against|for|with me)|push back)(?![\\w'])`,
);
const DISCUSS_ANY =
  /\b(?:adds? (?:anything|much|nothing|enough)|earns? its (?:place|keep)|pulls? its weight|worth (?:keeping|it|the space)|on the fence|torn between|not sure (?:if|whether|about|that|it)|not convinced|do we (?:even )?need|or should (?:i|we)|or not\?|or would it be better|whether (?:to|i should|we should|or not|it's worth)|back and forth|make up my mind)\b/;

/** An opinion's opening, before the problem it names: "I think", "to me". */
const OPINION = /^(?:(?:i think|i feel(?: like)?|i find|to me|honestly|frankly|imo|it seems to me|i reckon|i suspect)\b(?: that)?[\s,]*)+/;

/** A problem the author names: "the ending feels rushed", "this drags". */
const PROBLEM_ADJ =
  '(?:long|wordy|verbose|slow|flat|clunky|choppy|awkward|confusing|unclear|dense|repetitive|repetitious|boring|dull|weak|vague|abrupt|rushed|stiff|dry|heavy|off|wrong|messy|muddy|muddled|bloated|thin|jargony|technical|formal|informal|cold|loose|baggy|overwritten|underwritten|clumsy|clich[ée]d|preachy|patronizing|condescending|hard to (?:follow|read|parse)|difficult to (?:follow|read)|out of place|redundant|unnecessary|too much|a mess|a slog|a drag|awful|terrible|bad|horrible|meh|lame|cringe|cringey|cringy|weird|odd|clumsy|ugly|lifeless|limp|bland|generic|overlong|forced|stilted|wooden|jarring|disjointed|(?:the )?(?:weakest|worst|slowest|dullest|least \\w+)|not (?:great|good|working|right|clear))';
const PROBLEM = [
  new RegExp(
    `^${SUBJECT}\\s+(?:is|are|was|feels|feel|seems|seem|reads|read|sounds|sound|looks|look|gets|get)\\s+(?:(?:too|a bit|a little|kind of|sort of|quite|really|very|so|pretty|rather|somewhat|way too|far too|overly|still)\\s+)*${PROBLEM_ADJ}\\b`,
  ),
  new RegExp(`^${SUBJECT}\\s+(?:reads|sounds|feels|looks) like\\b`),
  /^(?:i (?:hate|dislike|don'?t like|can'?t stand|'m not happy with|am not happy with|'m not a fan of|am not a fan of|'m unhappy with))\b/,
  /\b(?:drags|doesn'?t (?:flow|work|land|read well|make sense)|isn'?t (?:working|clear|landing)|is not (?:working|clear)|does not (?:flow|work)|falls flat|loses me|lost me|confuses me|trips me up|reads badly|needs (?:work|help|fixing|tightening|a rewrite|an edit)|could be (?:better|tighter|clearer|shorter))\b/,
];

/** A question, at its start. */
const QUESTION_START =
  /^(?:what|what's|why|how|how's|where|where's|when|who|who's|whom|whose|which|is|isn't|are|aren't|was|wasn't|were|am|does|doesn't|do|don't|did|didn't|has|hasn't|have|haven't|had|can|can't|could|couldn't|would|wouldn't|will|won't|shall|may|might|explain|tell me|summari[sz]e|describe|list|show me|find|count|compare|outline|walk me through|remind me|help me understand|give me (?:a|an|the) (?:summary|overview|list|count|outline|explanation))\b/;

/** Going on with the last message: "and the next one", "what about chapter 4?", "try again", "I meant the other one". */
const FOLLOW_UP =
  /^(?:and|also|now|then|next|plus|same|again|another|more|one more|what about|how about|do the same|the same|same (?:for|with|again)|keep going|go on|carry on|continue|proceed|try again|once more|i meant|i mean|not that|no,? (?:the|i meant)|the other|instead|rather)\b[\s,]*/;
/** What opens a follow-up before it: "ok, and the next one". */
const LEAD = /^(?:(?:ok(?:ay)?|alright|all right|right|so|well|hmm+|great|good|nice|cool|perfect|fine|sure|thanks|thank you|yes|yeah|yep|yup)\b[\s,.!:;-]*)+/;
const WH = /^(?:what|why|how|where|when|who|which|is|are|does|do|did|can|could)\b/;

// ---- the pick ------------------------------------------------------------------------------

/**
 * The mode for a message the author typed, by what it asks for: a figure, then
 * versions, then a change to the text (Write), a review, a direction weighed
 * (Discuss), a problem named (Review), a follow-up to the message before, and
 * a question (Ask). What's left goes on in a mode that can't change the book.
 */
export function pickMode(text: string, { change = false, last = null }: AutoCues = {}): AutoPick {
  const t = ownWords(norm(text));
  const pick = (mode: AgentMode, why: string): AutoPick => ({ mode, why });
  if (!t.trim()) return last ? pick(last, followUp(last)) : pick('ask', WHY.question);
  const parts = partsOf(t).map(opening);
  const whole = opening(t.replace(/\n+/g, ' '));
  // "Add two vectors: what happens?" asks what happens.
  const asking = t.trimEnd().endsWith('?');
  const request = (p: Part) => p.polite || !(p.text.endsWith('?') || (asking && p.text.endsWith(':')));
  const edit =
    parts.some((p) => (EDIT.test(p.text) || (VERB_FIRST.test(p.text) && !REVIEW_START.test(p.text))) && request(p)) ||
    parts.some((p) => (WANT.test(p.said) && !p.said.endsWith('?')) || gerundEdit(p.said)) ||
    parts.some((p) => NEEDS.test(p.said) && !p.said.endsWith('?')) ||
    parts.some((p) => REVIEW_START.test(p.text) && AND_EDIT.test(p.text)) ||
    COMMA_EDIT.test(t) ||
    (last !== 'options' && words(whole.said) <= 8 && BARE.test(whole.said));
  if (change) return edit ? pick('write', WHY.edit) : pick('ask', WHY.change);
  if (parts.some((p) => FIGURE_MAKE.test(p.text) || FIGURE_INTO.test(p.text) || FIGURE_START.test(p.text) || DRAW.test(p.text))) return pick('figures', WHY.figure);
  // "Help me decide between the two openings" weighs versions; it doesn't ask for more.
  if (!OPTIONS_NOT.test(t) && parts.some((p) => !DISCUSS_START.test(p.said) && OPTIONS.some((re) => re.test(p.text)))) return pick('options', WHY.options);
  if (edit) return pick('write', WHY.edit);
  if (parts.some((p) => REVIEW_START.test(p.text)) || REVIEW_ANY.some((re) => re.test(t))) return pick('review', WHY.review);
  const problem = (p: Part) => PROBLEM.some((re) => re.test(p.said.replace(OPINION, '')));
  // "I think the ending is rushed" names a problem; in a discussion it's part of it.
  if (last !== 'discuss' && parts.some((p) => OPINION.test(p.said) && problem(p))) return pick('review', WHY.problem);
  if (parts.some((p) => DISCUSS_START.test(p.said)) || DISCUSS_ANY.test(t)) return pick('discuss', WHY.discuss);
  // A discussion goes on as one, its questions too, until it asks for something else.
  if (last === 'discuss') return pick('discuss', followUp('discuss'));
  if (parts.some(problem)) return pick('review', WHY.problem);
  const lead = t.replace(/\n+/g, ' ').replace(LEAD, '');
  const after = lead.replace(FOLLOW_UP, '');
  if (last && ((FOLLOW_UP.test(lead) && !WH.test(after)) || (last === 'options' && words(whole.said) <= 8 && BARE.test(whole.said)))) return pick(last, followUp(last));
  if (t.trimEnd().endsWith('?') || parts.some((p) => QUESTION_START.test(p.said))) return pick('ask', WHY.question);
  return last && modeConfig(last).readOnly ? pick(last, followUp(last)) : pick('ask', WHY.unsure);
}
