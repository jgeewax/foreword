// App controller: owns the workspace, documents, Typst service, preview
// webview and agent adapter, and exposes UI state through a Store.
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { documentDir } from '@tauri-apps/api/path';
import { ask, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { isPicture, tildePath } from '../lib/paths';
import type { SourceRef } from '../lib/source-links';
import { commandId, type TabCommand } from '../lib/tab-keys';
import { Documents, type MergeQuestion } from '../editor/documents';
import { definitions, toMonacoRange, uriToRelative, type LspDiagnostic } from '../editor/lsp-convert';
import { monaco } from '../editor/monaco';
import { definitionPreview, filePreview } from '../editor/definition-preview';
import { jumpCandidates, jumpScrollTop } from '../editor/preview-sync';
import { rippleAt } from '../editor/ripple';
import { followLine, splitLines } from '../lib/diff';
import type { SourceJump } from '../services/typst';
import { captureSelection, selectionLabel, type SourceSelection } from '../editor/selection';
import { Channel, errorMessage, ipc, isCmdError, type Bounds, type DownloadProgress, type LaunchOptions, type ToolsStatus, type UpdateState, type Version, type WorkspaceInfo } from '../lib/ipc';
import { clock, PerfTracker } from '../lib/perf';
import { Emitter, Store } from '../lib/store';
import type { SnippetBook } from '../lib/typst-render';
import {
  absoluteFontPaths,
  outputPathPattern,
  typstRootOf,
  parseProjectSettings,
  PROJECT_FILE,
  serializeProjectSettings,
  validateProjectSettings,
  type ProjectSettings,
} from './project-settings';
import { ASSISTANT_NAMES, ASSISTANTS, assistantsFor, loadSettings, saveSettings, type AppSettings, type AssistantId, type PreviewScope, type ToolName } from './settings';
import { handleMcp, STUDIO_TOOLS, type ModelChoice, type StudioHost } from './studio-tools';
import { STUDIO_TOOL_ACTION, studioToolName } from '../services/agent/studio-tool';
import { nextZoom, type ZoomAction } from '../lib/zoom';
import { aiEdit, editMarks, readLabel, readOf, type AiEdit, type AiRead } from './ai-marks';
import { parseConfig, serializeConfig } from './config';
import { chapterNumber, describeTool, firstHeading, mainIncludes, NO_NAMES, toolActivity, unnumberedHeading, type BookNames } from './tool-labels';
import { chapterOf, chapterPreviewPath, chapterPreviewText } from './chapter-preview';
import { scanIncludes } from './includes';
import { fileUses, snippetPrelude, type FileUses } from './snippet-book';
import { nextActivity, waitedFor } from './activity';
import { initialGit, SourceControl, type GitState } from './source-control';
import { History, initialHistory, type HistoryState } from './history';
import { fileTabs, GIT_TAB, GUIDE_TAB, HISTORY_FILE_TAB, HISTORY_TAB, isViewTab } from './view-tabs';
import { bookFolderName, PAPER_TEMPLATES, paperExtras, paperSetupMessage, TEMPLATES, templateFiles, typstLength } from '../templates';
import { SAMPLES, SAMPLES_FOLDER } from '../samples';
import { makefile } from '../templates/makefile';
import { edgeToEdgeWithoutBleed, lengthPt, parseCoverSpec, PRINT_WRAPPER, printChecks, printWrapper, type Check, type PdfInfo, type PrintFacts } from '../print';
import { shouldStartTour, TOUR_SEEN_KEY, TOUR_STEPS } from './tour';
import { replaceText, searchPattern, searchText, SEARCHABLE, type FileMatches, type SearchMatch, type SearchOptions } from './book-search';
import { fileContents, type FileContents } from './contents';
import { peacockColor } from './book-color';
import { COVER_DESIGN, COVER_DIR, COVER_PREVIEW, COVER_PRINT, COVER_SPEC, COVER_STYLES, coverFiles, namesFromMain, trimFromMain, updateSpec, type CoverInfo } from '../cover';
import { snippetInsertion } from '../help/guide';
import { CodeRunner, initialCode, type CodeState } from '../code/runner';
import { OUTPUTS_FILE } from '../code/cells';
import { message } from '@tauri-apps/plugin-dialog';
import { copyText, showContextMenu } from '../lib/context-menu';
import { chapterImports, chapterText, includePath, nextChapterPath, withInclude } from './chapters';
import { quotedAt, referencesTo, removeIncludes, resolveRef, updateReferences } from './references';
import { findInSource, findPartial } from '../editor/find-text';
import { parseTodos, todoPrompt, withoutTodo, type Todo } from './todos';
import { asksTaskDone, AUTHOR_EDIT_CHIP, contextTokens, itemsFromContext, readsFromContext, TASK_INSTRUCTIONS, TASK_INSTRUCTIONS_KEY, type TaskRecord, type TaskSummary } from './tasks';
import { chatSoFar, readModeSetups, setupLine, type ModeSetup, type ModeSetups } from './mode-setups';
import { EARLIER_CHIP } from '../services/agent/message-context';
import { addressPrompt, locate, makeComment, nextCommentId, parseReport, parseReview, passageChange, REVIEW_FILE, serializeReview, undoChange, type ReviewComment } from './review';
import { minimalEdit } from '../editor/text-edit';
import { OpenCodeAdapter } from '../services/agent/opencode';
import { AcpAdapter, CLAUDE_ASKS, GOOGLE_SIGN_IN, isSignedOut } from '../services/agent/acp';
import { buildInstructions, INSTRUCTIONS_KEY } from '../services/agent/instructions';
import { MODE_INSTRUCTIONS_KEY, modeChoiceMessage, modeConfig, modeOffer, type AgentMode, type ModeSuggestion } from '../services/agent/modes';
import { parseOptions } from '../services/agent/options-mode';
import { STYLE_TEMPLATES } from '../style-guides';
import { bookId, chapterFile, chapterHead, CONTAINER_XML, didntCarryOver, EPUB_CSS, epubSource, extractImages, fixedFor, fixedPage, linkParts, mathHeavy, navPage, packageOpf, splitBook, toXhtml, uniqueSvgIds, xhtmlPage, type EpubFile, type EpubKind, type ManifestItem } from '../epub';
import { STYLE_DRAFT_KEY, STYLE_DRAFT_MESSAGE, STYLE_GUIDE_FILE, STYLE_INSTRUCTIONS_KEY, STYLE_INTERVIEW_MESSAGE, STYLE_REDRAFT_MESSAGE, STYLE_REVISE_PLACEHOLDER, styleDraftBrief, styleInstructions, styleInterviewBrief, styleReviseBrief, styleReviseMessage, type AuthorRevision, type GuideChange } from '../services/agent/style-guide';
import { matchesQuery, pushRecent } from '../services/agent/model-search';
import { chooseModel, effortFor, effortKey, PREFERRED_PROVIDERS } from '../services/agent/models';
import { describePermissions, onlyLooks, PRESETS, sessionRules, type PermissionRule } from '../services/agent/permissions';
import { commandPermissionRules, ruleKey, rulesUsed, type CommandRule, type RuleEffect, type RuleScope } from '../services/agent/command-rules';
import { decide } from '../services/agent/acp-events';
import { claudeRules, codexRules, type OwnRule } from '../services/agent/assistant-rules';
import { parseSlash, PERMISSION_WORDS, SLASH_COMMANDS } from './slash';
import { BAR_MODE, barMessage, type BarKind } from './selection-bar';
import { fixErrorPrompt, mergePrompt, messageLine, stockTitle } from './stock-prompts';
import type { AgentAdapter, AgentEvent, Delivery, EffortOption, FilePatch, FormAnswer, FormField, FormRequest, MessageContext, ModelInfo, ModelRef, PermissionDecision } from '../services/agent/types';
import { answersMessage, splitQuestions } from '../services/agent/questions';
import { authorEditLabel, authorEdits, type AuthorEdit } from '../services/agent/author-edits';
import { TypstService } from '../services/typst';

export type ToastAction = { label: string; run: () => void };

/** What the author allowed for one task (a conversation): commands, as rules, and other requests. Kept while the app runs. */
export type TaskRules = { alwaysAllow: string[]; actions: PermissionRule[] };

/** When a rule was made and how often it let a command run (kept in the app, not in the settings files). */
export type RuleStat = { created: number; uses: number; last: number };

/** What an "always" answer kept: command rules where they apply, or a task's allowance; `removed` once taken back. */
export type Remembered = { scope: RuleScope; label: string; patterns: string[]; actions: PermissionRule[]; removed?: boolean };

const RULE_STATS_KEY = 'studio.ruleStats';
function loadRuleStats(): Record<string, RuleStat> {
  try {
    const raw = JSON.parse(localStorage.getItem(RULE_STATS_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** A conversation that isn't shown: what it's doing, and whether it needs the author. */
export type BackgroundTask = {
  running: boolean;
  /** Waiting on the author: a permission card or a question. */
  attention: 'permission' | 'question' | null;
  /** Finished, with a reply the author hasn't seen. */
  unread: boolean;
  /** What it's doing now ("Reading “The Storm” (chapter 2)"), or how it ended. */
  label: string;
  since: number;
  failed?: string;
};

/** A message sent while the assistant works: `id` is OpenCode's inbox id once it has one. */
export type QueuedMessage = { id: string; text: string; attachments: string[]; delivery: Delivery; sending: boolean };

/**
 * A running turn's progress: sending, waiting for the model (it has said
 * nothing yet), thinking (its reasoning streams), using a tool, writing, or
 * waiting to retry a busy model.
 */
export type Activity = {
  phase: 'sending' | 'waiting' | 'thinking' | 'tool' | 'writing' | 'retrying' | 'asking';
  /** When the turn started (ms). */
  since: number;
  /** When this phase started (ms), for its own time: waiting and thinking are timed apart. */
  phaseSince?: number;
  /** For a tool: what it's doing ("Reading chapters/ch1.typ"). */
  label?: string;
  /** For a retry: when (ms since 1970), which attempt, and why. */
  retryAt?: number;
  attempt?: number;
  reason?: string;
};

export type ChatItem =
  | {
      kind: 'user';
      id: string;
      text: string;
      attachments: string[];
      /** When it was sent, and when the turn it started ended (ms). */
      at?: number;
      ended?: number;
      /** Who answered: the assistant, its model's name and the effort, as they were. */
      by?: TurnBy;
      /** The History version of what the turn changed (null: it changed nothing). */
      version?: string | null;
    }
  | { kind: 'assistant'; id: string; text: string; done: boolean; options?: OptionsState; taskCheck?: 'ask' | 'dismissed'; modeSuggestion?: ModeSuggestion }
  /**
   * The assistant asks (choices, several choices, yes or no, or its own words)
   * and waits: the question panel takes the composer's place until it's
   * answered or skipped. `expired`: the assistant stopped waiting.
   */
  | {
      kind: 'question';
      id: string;
      title: string;
      fields: FormField[];
      state: 'pending' | 'sending' | 'answered' | 'dismissed' | 'expired';
      answer?: FormAnswer;
      /** The question tool call that asked (its chat row is then left out: the card is the record). */
      callId?: string;
      /** Asked in a reply (a ```questions block): the answers go back as the author's next message. */
      via?: 'message';
    }
  /** The model's reasoning, as it streams (shown faintly, then folded to "Thought for 4 s"). */
  | {
      kind: 'thinking';
      id: string;
      text: string;
      done: boolean;
      /** When its first words came (ms); `ended`, when its last did. */
      started: number;
      ended?: number;
      /** How long the model said nothing before it (ms): waiting, not thinking. */
      waited?: number;
    }
  | {
      kind: 'tool';
      id: string;
      name: string;
      summary: string;
      status: 'running' | 'done' | 'failed';
      detail: string;
      /** A read: the lines it read (1-based, inclusive). */
      read?: { path: string; from: number; to: number };
      /** The tool's input (for describing it in words) and a note on its result ("3 matches"). */
      input?: unknown;
      note?: string;
      /** When it started and finished (ms). */
      started?: number;
      ended?: number;
    }
  | {
      kind: 'permission';
      id: string;
      action: string;
      resources: string[];
      patches: FilePatch[];
      state: 'pending' | 'sending' | 'once' | 'always' | 'reject';
      /** Asked by Foreword itself (its settings tools, for an assistant that asks no one): answered here, not by the assistant. */
      local?: boolean;
      /** For "always": what the app kept (command-rules.ts). */
      remembered?: Remembered;
      /** Answered by a rule the author made, or a setting they changed, while it waited. */
      byRule?: boolean;
    }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error'; action?: { label: string; prompt?: string; resume?: boolean } };

export type QuestionItem = Extract<ChatItem, { kind: 'question' }>;

/** Who answered a turn, for its reply's byline. */
export type TurnBy = { assistant: AssistantId; model: string | null; effort: string | null };

/**
 * The question waiting for the author in the shown conversation (the question
 * panel, in the composer's place): the first one asked. A reply's questions
 * wait once its turn is over.
 */
export function pendingQuestion(a: { items: ChatItem[]; running: boolean }): QuestionItem | null {
  const q = a.items.find((it): it is QuestionItem => it.kind === 'question' && (it.state === 'pending' || it.state === 'sending') && (it.via !== 'message' || !a.running));
  return q ?? null;
}

export type Attachment = { id: string; label: string; selection: SourceSelection };

/** Identifies a selection for "leave it out" (same place and same text). */
const selectionKey = (s: SourceSelection) => `${selectionLabel(s)}|${s.start.column}:${s.end.column}|${s.selectedText.length}`;

/** Settings' pages: Foreword's own (every book), then this book's (saved with it). */
/** The Search view's state. */
export type SearchState = {
  query: string;
  replace: string;
  options: SearchOptions;
  /** What it found, file by file in reading order (null: no search). */
  results: FileMatches[] | null;
  total: number;
  /** It stopped at SEARCH_LIMIT matches. */
  capped: boolean;
  searching: boolean;
  /** A pattern that doesn't parse. */
  error: string | null;
};

const initialSearch: SearchState = { query: '', replace: '', options: { matchCase: false, wholeWord: false, regex: false }, results: null, total: 0, capped: false, searching: false, error: null };

/** The most matches Search lists. */
const SEARCH_LIMIT = 2000;

/** Whether the tour has run here before (finished or skipped). */
function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** VS Code's settings for the book's folder, where Peacock keeps its colour. */
const VSCODE_SETTINGS = '.vscode/settings.json';

export type SettingsPage = 'general' | 'editor' | 'assistant' | 'permissions' | 'tools' | 'book' | 'book-assistant' | 'book-color';
export type NewBookTab = 'book' | 'paper' | 'sample';

/** How the style guide is being written: from the chapters, again from them, from the author's answers, or changed as they ask. */
export type StyleDraftKind = 'draft' | 'redraft' | 'interview' | 'revise';

/** What Export EPUB made: where, which kind and why, and what the reflowing kind left behind. */
export type EpubResult = { path: string; kind: EpubKind; why: string; lost: string[]; chapters: number };

export type PromptRequest = { title: string; label: string; value: string; placeholder?: string; okLabel: string; help?: string; multiline?: boolean };

/** Where a picked option goes: the passage as it stands in the buffer (1-based positions). */
export type OptionTarget = { path: string; start: { line: number; column: number }; end: { line: number; column: number }; text: string };
/**
 * An Options-mode reply: where a picked option goes (null: nothing to replace,
 * copy only), the passage as originally selected, and the option in use.
 */
export type OptionsState = { target: OptionTarget | null; original: OptionTarget | null; applied: number | null };

export type Stat = { p50: number | null; p95: number | null; n: number };

export type StudioState = {
  launch: LaunchOptions | null;
  tools: ToolsStatus | null;
  workspace: WorkspaceInfo | null;
  opening: string | null;
  openError: string | null;
  /** The open tabs, in order: files' paths, and tabs that aren't files (see view-tabs.ts). */
  tabs: string[];
  /** The file the editor holds: in front, unless `viewTab` is. */
  active: string | null;
  /** The tab in front when it isn't a file (Typst basics); null: `active`'s. */
  viewTab: string | null;
  dirty: Record<string, boolean>;
  conflicts: Record<string, string>;
  /** Passages a merge with the file on disk asks about, per file (documents.ts). */
  questions: Record<string, MergeQuestion[]>;
  cursor: { line: number; column: number } | null;
  problems: { errors: number; warnings: number };
  compile: { status: 'idle' | 'compiling' | 'ok' | 'error'; pages?: number; words?: number };
  preview: { status: 'off' | 'starting' | 'ready' | 'error'; url?: string; error?: string };
  agent: {
    status: 'off' | 'starting' | 'ready' | 'error';
    error?: string;
    /** It didn't start because it isn't signed in (Settings ▸ Assistant signs in). */
    signedOut?: boolean;
    /** Starting with its own sign-in (Antigravity's, with Google): waiting for the author, in the browser. */
    signingIn?: boolean;
    connection: 'open' | 'lost' | 'unknown';
    models: ModelInfo[];
    model: ModelRef | null;
    recentModels: ModelRef[];
    /** The model's levels of effort (none: it has no such setting), and the one in use (or for the next conversation). */
    efforts: EffortOption[];
    effort: string | null;
    sessionId: string | null;
    title: string | null;
    running: boolean;
    items: ChatItem[];
    attachments: Attachment[];
    /** The current selection (editor, or mapped from the preview): sent with each message unless dismissed. */
    selection: { attachment: Attachment; from: 'editor' | 'preview' } | null;
    /** A selection the author dismissed for now (key: label + text; until it changes). */
    selectionDismissed: string | null;
    /** Write (default), Ask, Discuss (think it through first), Options (three versions to pick from) or Figures. */
    mode: AgentMode;
    /** The assistant, model and effort each mode was last used with (mode-setups.ts; kept on this Mac). */
    modeSetups: ModeSetups;
    /** This book's conversations (tasks), newest first. */
    tasks: TaskSummary[];
    /** Input tokens of the latest call: how full the context window is. */
    contextTokens: number | null;
    compacting: boolean;
    /** What the running turn is doing right now (the chat's live progress line). */
    activity: Activity | null;
    /** Messages sent during a turn, waiting for it (queue) or for its next step (steer). */
    queued: QueuedMessage[];
    /** Other conversations still at work, or waiting on the author, while another is shown. */
    background: Record<string, BackgroundTask>;
    /** The last turn was stopped or failed: it can be resumed (with the model chosen now). */
    stopped: boolean;
  };
  perf: { input: Stat; preview: Stat };
  toast: { text: string; tone: 'info' | 'error'; actions?: ToastAction[] } | null;
  /** What the author allowed for each task (by conversation), and how the command rules have been used. */
  taskRules: Record<string, TaskRules>;
  ruleStats: Record<string, RuleStat>;
  /** UI zoom factor (1 = 100%). */
  zoom: number;
  settings: AppSettings;
  settingsOpen: boolean;
  /** The tour's step, while it's on (see app/tour.ts). */
  tour: number | null;
  /** Foreword's update (the same in every window), and whether its dialog is open. */
  update: UpdateState | null;
  updateDialog: boolean;
  /** About Foreword (the app menu's first item). */
  aboutOpen: boolean;
  /** The Settings page to open at (null: the one last shown). */
  settingsPage: SettingsPage | null;
  newBookOpen: boolean;
  /** The New Book dialog's tab: books from a template, papers, or the samples. */
  newBookTab: NewBookTab;
  /** "Typst basics" is in front: its tab (or a dialog on the welcome screen). */
  guideOpen: boolean;
  /** Recently opened books, newest first. */
  recent: string[];
  /** A one-line text question (our own dialog: WKWebView has no window.prompt). */
  prompt: PromptRequest | null;
  /** `.foreword.json` of the open workspace. */
  project: { settings: ProjectSettings; raw: Record<string, unknown>; hash: string | null; error: string | null };
  /** The colour VS Code's Peacock gives the book (`peacock.color` in its .vscode/settings.json), if any. */
  peacockColor: string | null;
  exporting: boolean;
  /**
   * WRITING_STYLE.md: whether it exists, and whether the user dismissed the
   * setup prompt. `drafting`: the conversation drafting it from the chapters
   * ('' while it starts), until the guide is written.
   */
  styleGuide: { exists: boolean; chars: number; dismissed: boolean; drafting: string | null; draftKind: StyleDraftKind };
  history: HistoryState;
  /** The author's own Git repository, if the book is in one. */
  git: GitState;
  /** Runnable code examples in the book. */
  code: CodeState;
  /** TODOs left in the book's files. */
  todos: Todo[];
  /**
   * Review comments (beside the text, in .foreword/review.json), and the one
   * being written in the editor (a passage of the open file).
   */
  review: { comments: ReviewComment[]; draft: { path: string; start: number; end: number } | null; busy: string[] };
  /** What the preview shows: the book, or its cover (cover/preview.typ, with guides). */
  previewTarget: 'book' | 'cover';
  /**
   * The chapter the preview shows, when it shows only one (previewScope
   * "chapter": chapter-preview.ts); null when it shows the whole book.
   */
  previewChapter: string | null;
  /** The book's page count, last seen while previewing the book (for the cover's spine). */
  bookPages: number | null;
  coverDialogOpen: boolean;
  /** Writing Style Guide Templates: pick one to start WRITING_STYLE.md from. */
  styleTemplatesOpen: boolean;
  /** Export EPUB: which kind, then the result. */
  epubOpen: boolean;
  /** The book's names for its files (chapters, headings): how the chat describes tool calls. */
  names: BookNames;
  /** The book's imports, which the chat's formulas and Typst blocks are set with (null: none, or no book). */
  snippetBook: SnippetBook | null;
  /** ⌘P: go to a file by name; ⇧⌘P: run a command. What it was opened for (false: closed). */
  quickOpen: false | 'files' | 'commands';
  /** The settings file: where it is, and why it can't be used (if so). */
  configFile: { path: string; error: string | null } | null;
  /** An assistant's connector downloading (Antigravity's, from Google), or why it didn't. */
  assistantDownload: ({ kind: AssistantId; error?: string } & Partial<DownloadProgress>) | null;
  /** Bumped when the assistant's marks change (the editor repaints them). */
  aiMarks: number;
  /** Print with Mixam: the print files and the checks on them. */
  print: {
    open: boolean;
    status: 'idle' | 'working' | 'done';
    checks: Check[];
    files: { interior?: string; cover?: string };
    facts?: PrintFacts;
  };
  /** Left pane: the file tree, the book's history, its code examples, or its TODOs. */
  sidebar: 'files' | 'contents' | 'search' | 'history' | 'code' | 'todos' | 'review' | 'git';
  /** Each Typst file's headings and about how many words it has (the Contents view). */
  contents: Record<string, FileContents>;
  /** The Search view: what's searched for, how, and what it found. */
  search: SearchState;
};

const initialState: StudioState = {
  launch: null,
  tools: null,
  workspace: null,
  opening: null,
  openError: null,
  tabs: [],
  active: null,
  viewTab: null,
  dirty: {},
  conflicts: {},
  questions: {},
  cursor: null,
  problems: { errors: 0, warnings: 0 },
  compile: { status: 'idle' },
  preview: { status: 'off' },
  agent: {
    status: 'off',
    connection: 'unknown',
    models: [],
    model: null,
    recentModels: readJson<ModelRef[]>('studio.recentModels') ?? [],
    efforts: [],
    effort: null,
    sessionId: null,
    title: null,
    running: false,
    items: [],
    attachments: [],
    selection: null,
    selectionDismissed: null,
    mode: 'write',
    modeSetups: readModeSetups(readJson('studio.modeSetups')),
    tasks: [],
    contextTokens: null,
    compacting: false,
    activity: null,
    queued: [],
    background: {},
    stopped: false,
  },
  perf: { input: { p50: null, p95: null, n: 0 }, preview: { p50: null, p95: null, n: 0 } },
  toast: null,
  taskRules: {},
  ruleStats: loadRuleStats(),
  zoom: 1,
  settings: loadSettings(),
  settingsOpen: false,
  tour: null,
  search: initialSearch,
  contents: {},
  update: null,
  updateDialog: false,
  aboutOpen: false,
  settingsPage: null,
  newBookOpen: false,
  newBookTab: 'book',
  guideOpen: false,
  prompt: null,
  recent: readJson<string[]>('studio.recentWorkspaces') ?? [],
  project: { settings: {}, raw: {}, hash: null, error: null },
  peacockColor: null,
  exporting: false,
  styleGuide: { exists: false, chars: 0, dismissed: false, drafting: null, draftKind: 'draft' },
  history: initialHistory,
  git: initialGit,
  code: initialCode,
  todos: [],
  review: { comments: [], draft: null, busy: [] },
  previewTarget: 'book',
  previewChapter: null,
  bookPages: null,
  coverDialogOpen: false,
  styleTemplatesOpen: false,
  epubOpen: false,
  print: { open: false, status: 'idle', checks: [], files: {} },
  aiMarks: 0,
  names: NO_NAMES,
  snippetBook: null,
  configFile: null,
  assistantDownload: null,
  quickOpen: false,
  sidebar: 'files',
};

const LAST_WORKSPACE = 'studio.lastWorkspace';
const MODEL_KEY = 'studio.model';
/** The effort chosen for each model (effortKey → level). */
const EFFORTS_KEY = 'studio.efforts';
/** What each mode runs on (mode-setups.ts), for every window: each reads it when it needs it. */
const MODE_SETUPS_KEY = 'studio.modeSetups';
/** How long ⇧Tab may rest on a mode before its assistant, model and effort come in (ms). */
const SETUP_DELAY = 350;
const ZOOM_KEY = 'studio.zoom';
const RECENT_KEY = 'studio.recentWorkspaces';
export const NEW_BOOK_PARENT = 'studio.newBookParent';
/** The window's book across Reload Window (sessionStorage: this window's page only). */
const RELOAD_KEY = 'studio.reloadWorkspace';
/** Per book: where its PDF was last exported (the Save dialog starts there). */
const EXPORT_TARGETS_KEY = 'studio.exportTargets';

/** How many of the assistant's latest versions of a file are marked in the editor. */
const AI_EDIT_VERSIONS = 12;

/** A picture or PDF named in the text (⌘-click): an empty model stands in for it, since Monaco only links to one. */
const VIEWER_SCHEME = 'foreword-viewer';

export const AUTHOR_KEY = 'studio.author';
const tabsKey = (root: string) => `studio.tabs:${root}`;
/** Per book: where the preview was, in the book, its cover, and each chapter shown alone ("chapter:<path>"). */
const previewPlaceKey = (root: string) => `studio.previewPlace:${root}`;
/** A place in the preview: the page at its top (from 0), and how far down that page (0 to 1). */
type PreviewPlace = { page: number; offset: number };
/** Per book: the chapter the preview last showed alone. */
const previewChapterKey = (root: string) => `studio.previewChapter:${root}`;
let seq = 0;
const uid = (p: string) => `${p}${++seq}`;

/** Wait until OpenCode reports the session idle (e.g. after compaction), up to a minute. */
async function waitIdle(agent: AgentAdapter, sessionId: string) {
  for (let i = 0; i < 120 && (await agent.isRunning(sessionId).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 500));
}

function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
/** A sessionStorage value, removed as it's read (null: none). */
function takeSession(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return v;
  } catch {
    return null;
  }
}

/** Whether two settings' command rules differ. */
const rulesDiffer = (a: { alwaysAllow?: string[]; neverAllow?: string[] }, b: { alwaysAllow?: string[]; neverAllow?: string[] }) =>
  (a.alwaysAllow ?? []).join('\n') !== (b.alwaysAllow ?? []).join('\n') || (a.neverAllow ?? []).join('\n') !== (b.neverAllow ?? []).join('\n');

/** What "allow for this task" lets in, for a request that isn't a command: its edits, that site, that folder or file. */
export function taskAllowance(action: string, resources: string[]): PermissionRule[] {
  const allow = (resource: string): PermissionRule => ({ action, resource, effect: 'allow' });
  switch (action) {
    case 'edit':
      // Every change to the book's files, except .env files, which ask each time.
      return [allow('*'), { action, resource: '*.env', effect: 'ask' }, { action, resource: '*.env.*', effect: 'ask' }];
    case 'websearch':
      return [allow('*')];
    case 'webfetch':
      return resources.flatMap((r) => {
        try {
          const { origin } = new URL(r);
          return [allow(origin), allow(`${origin}/*`)];
        } catch {
          return [allow(r)];
        }
      });
    default:
      return resources.map(allow);
  }
}

/** That allowance in words, for the chat and the toast. */
export function taskAllowanceWords(action: string, resources: string[]): string {
  switch (action) {
    case 'edit':
      return 'changes to the book’s files';
    case 'websearch':
      return 'web searches';
    case 'webfetch': {
      const hosts = [...new Set(resources.map((r) => (/^https?:\/\/([^/]+)/.exec(r)?.[1] ?? r)))];
      return `pages on ${hosts.join(', ')}`;
    }
    case 'external_directory':
      return `files in ${resources.join(', ')}`;
    case 'shell':
      return 'this command';
    default:
      return resources.length ? resources.join(', ') : 'this';
  }
}

export class Studio {
  readonly store = new Store<StudioState>(initialState);
  readonly events = new Emitter<{
    'focus-composer': [];
    /** ⇧⌘F: the Search view's box, with this text in it if any (the editor's selection). */
    'focus-search': [text: string | null];
    'focus-editor': [];
    'fill-composer': [text: string];
    /** The selection bar's card, open on Revise, Options or Ask (the context menu, the command). */
    'selection-card': [kind: BarKind];
    'find-in-settings': [];
    'show-agent-pane': [];
    /** The assistant pane's list of the book's tasks, opened (View ▸ Assistant Tasks). */
    'show-tasks': [];
    'show-explorer': [];
    'toggle-pane': [pane: 'explorer' | 'preview' | 'agent'];
    /** ⌘P or ⇧⌘P, pressed again while the box is open: it starts over in that mode. */
    'quick-open': [mode: 'files' | 'commands'];
  }>();
  readonly perf = new PerfTracker();
  readonly typst = new TypstService();
  docs: Documents | null = null;
  agent: AgentAdapter | null = null;
  editor: monaco.editor.IStandaloneCodeEditor | null = null;
  readonly git = new SourceControl({
    get: () => this.state.git,
    set: (patch) => {
      this.store.set((s) => ({ git: { ...s.git, ...patch } }));
      if ('view' in patch) this.followChanges(GIT_TAB, patch.view, patch.view?.files === null);
    },
    report: (text, tone) => this.toast(text, tone),
  });
  private gitTimer: number | undefined;

  /** Source Control's status, soon after files change (saves, the assistant, another app). */
  private scheduleGitRefresh(delay = 800) {
    clearTimeout(this.gitTimer);
    this.gitTimer = window.setTimeout(() => void this.git.refresh(), delay);
  }

  readonly history = new History({
    get: () => this.state.history,
    set: (patch) => {
      this.store.set((s) => ({ history: { ...s.history, ...patch } }));
      if ('changes' in patch) this.followChanges(HISTORY_TAB, patch.changes, patch.changes?.files === null);
      if ('diff' in patch) this.followChanges(HISTORY_FILE_TAB, patch.diff, true);
    },
    docs: () => this.docs,
    agentRunning: () => this.state.agent.running,
    report: (text, tone) => this.toast(text, tone),
  });
  /**
   * The message box's text, kept here so it survives the composer remounting
   * (collapsing the pane, opening a book) and can be filled before it mounts.
   */
  composerDraft = '';
  readonly code = new CodeRunner({
    get: () => this.state.code,
    set: (patch) => this.store.set((s) => ({ code: { ...s.code, ...patch } })),
    root: () => this.state.workspace?.root ?? null,
    files: () => this.state.workspace?.files ?? [],
    docs: () => this.docs,
    editFile: async (path, transform) => {
      if (!(this.state.workspace?.files ?? []).includes(path) && !this.docs?.get(path)) {
        await ipc.fsWrite(path, transform(''), await ipc.fsHash(path));
        return true;
      }
      return this.editFile(path, transform);
    },
    confirm: (m, t, ok) => this.confirmAction(m, t, ok),
    toast: (text, tone) => this.toast(text, tone),
    notice: (text, tone, action) => this.pushItem({ kind: 'notice', id: uid('n'), tone, text, action }),
    refreshFiles: () => this.refreshFiles(),
  });
  private codeScanTimer: number | undefined;
  /** The message of the agent turn in progress (names its history version). */
  private turnMessage = '';

  private viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private previewBounds: Bounds | null = null;
  /** The last click in the preview: its height there (the preview's px) and when, for the jump it makes. */
  private previewClick: { y: number; at: number } | null = null;
  private previewVisible = true;
  private previewOpened = false;
  private pendingDisk = new Set<string>();
  private diskTimer: number | undefined;
  private unsubscribeAgent: (() => void) | null = null;
  /** Which program the running assistant is (Settings ▸ Assistant). */
  private agentKind: AssistantId | null = null;
  /** A new OpenCode was chosen while the assistant worked: start it once the turn is over. */
  private restartAgentWhenIdle = false;
  /** Errors already shown for the current turn (OpenCode reports a failure more than once). */
  private turnErrors = new Set<string>();
  /** Tool calls in flight: name and input, for when their result arrives. */
  private toolCalls = new Map<string, { name: string; input?: unknown }>();
  private styleGuideText: string | null = null;
  /** Options mode: the passage the current turn's options replace. */
  private optionsTurn: { target: OptionTarget | null } | null = null;
  private syncTimer: number | undefined;
  /** Cursor moves caused by a preview click must not bounce back to the preview. */
  private suppressSyncUntil = 0;
  private syncRun = 0;
  /** Zoom used to convert CSS pixels to window points for the preview webview. */
  zoomFactor = 1;
  /**
   * Where the page's viewport starts inside the window, in points. The main
   * webview spans the window; WebKit insets the page below an opaque title bar
   * (32 pt on macOS 26) but not below ours, which is transparent (lib.rs). The
   * preview webview is placed in window coordinates, so it must add this inset.
   */
  viewportInset = { top: 0, left: 0 };
  /** The title bar's height and the room its window buttons need, in points. */
  private titleBar = { height: 32, buttons: 0 };
  private insetTimer: number | undefined;
  private lastZoom = { action: '', at: 0 };
  private jumpWaiters = new Set<() => void>();

  constructor() {
    // Whenever a dialog opens or closes (any of them), the preview hides or shows.
    let dialog = false;
    this.store.subscribe(() => {
      if (this.dialogOpen() !== dialog) {
        dialog = !dialog;
        this.syncPreviewVisibility();
      }
    });
    // Auto save follows its setting (Settings, the settings file, the assistant's tools).
    let autoSave = -1;
    this.store.subscribe(() => {
      if (this.state.settings.autoSaveMinutes === autoSave) return;
      autoSave = this.state.settings.autoSaveMinutes;
      window.clearInterval(this.autoSaveTimer);
      if (autoSave > 0) this.autoSaveTimer = window.setInterval(() => void this.autoSave(), autoSave * 60_000);
    });
    // A preview of one chapter follows the editor into another chapter.
    let active: string | null = null;
    this.store.subscribe(() => {
      if (this.state.active === active) return;
      active = this.state.active;
      this.scheduleChapterPreview(0);
    });
    this.typst.on('diagnostics', (uri, list) => this.onDiagnostics(uri, list));
    this.typst.on('compile', (s) => {
      const status = s.status === 'compiling' ? 'compiling' : s.status === 'compileSuccess' ? 'ok' : 'error';
      this.store.set((st) => ({
        compile: {
          status,
          pages: s.pageCount || st.compile.pages,
          words: s.wordsCount?.words ?? st.compile.words,
        },
        ...(st.previewTarget === 'book' && !st.previewChapter && s.pageCount ? { bookPages: s.pageCount } : {}),
      }));
    });
    this.typst.on('scrollSource', (jump) => {
      // While mapping a preview selection, jumps are caught, not shown.
      if (this.jumpCatcher) return this.jumpCatcher(jump);
      void this.revealSource(jump);
    });
    this.typst.on('closed', () => {
      if (this.store.get().workspace) {
        this.store.set({ preview: { status: 'error', error: 'Tinymist stopped. Editing still works; restart the preview to continue.' } });
        this.syncPreviewVisibility();
      }
    });
    void getCurrentWebview().listen<string>('menu', (e) => void this.menuCommand(e.payload));
    // The update is the app's: any window's check, download or install shows in all of them.
    void listen<UpdateState>('update', (e) => this.store.set({ update: e.payload }));
    void getCurrentWebview().listen<{ tag?: string; x?: number; y?: number; selection?: string; page?: number; offset?: number }>('preview:report', (e) => {
      if (e.payload?.tag === 'loaded') this.configurePreview({ place: true });
      if (e.payload?.tag === 'place') this.rememberPreviewPlace(e.payload);
      if (e.payload?.tag === 'jump') for (const w of [...this.jumpWaiters]) w();
      if (e.payload?.tag === 'click') this.previewClick = { y: e.payload.y ?? 0, at: performance.now() };
      if (e.payload?.tag === 'contextmenu') void this.previewContextMenu(e.payload.x ?? 0, e.payload.y ?? 0, e.payload.selection ?? '');
      if (e.payload?.tag === 'selection') void this.previewSelection(e.payload as { text: string; end?: boolean });
    });
    void getCurrentWebview().listen<number[]>('perf:preview-paint', (e) => {
      this.perf.previewPainted(e.payload);
      this.publishPerf();
      if (this.store.get().preview.status === 'starting') this.store.set((s) => ({ preview: { ...s.preview, status: 'ready' } }));
    });
  }

  get state() {
    return this.store.get();
  }

  /** What each item of the menu bar does (src-tauri/src/menu.rs lists the ids). */
  readonly menuCommands: Record<string, () => unknown> = {
    settings: () => this.openSettings(),
    about: () => this.openAbout(),
    'check-updates': () => this.checkForUpdates({ dialog: true }),
    // File
    'new-book': () => this.openNewBook(),
    'new-chapter': () => this.newChapter(),
    'new-file': () => this.newFile(),
    'open-book': () => this.chooseWorkspace(),
    'go-to-file': () => this.openQuickOpen(),
    save: () => this.save(),
    'save-all': () => this.saveAll(),
    'close-tab': () => this.tabCommand('close'),
    'reopen-tab': () => this.tabCommand('reopen'),
    // Edit
    find: () => (this.state.settingsOpen ? this.events.emit('find-in-settings') : this.editorAction('actions.find')),
    'find-in-book': () => this.showSearch(),
    replace: () => this.editorAction('editor.action.startFindReplaceAction'),
    'format-document': () => this.formatDocument(),
    'add-comment': () => this.addComment(),
    // View
    'command-palette': () => this.openCommandPalette(),
    'toggle-sidebar': () => this.events.emit('toggle-pane', 'explorer'),
    'toggle-preview': () => this.events.emit('toggle-pane', 'preview'),
    'toggle-assistant': () => this.events.emit('toggle-pane', 'agent'),
    'show-files': () => this.revealSidebar('files'),
    'show-contents': () => this.revealSidebar('contents'),
    'show-review': () => this.showReview(),
    'show-history': () => this.revealSidebar('history'),
    'show-tasks': () => this.showTasks(),
    'show-git': () => this.revealSidebar('git'),
    'show-in-preview': () => this.syncPreviewToCursor(),
    'zoom-in': () => this.zoom('in', 'menu'),
    'zoom-out': () => this.zoom('out', 'menu'),
    'zoom-reset': () => this.zoom('reset', 'menu'),
    // Book
    'export-pdf': () => this.exportPdf(),
    'export-epub': () => this.openEpubDialog(),
    'open-pdf': () => this.openExportedPdf(),
    'print-mixam': () => this.openPrint(),
    'design-cover': () => this.openCoverDialog(),
    'style-guide': () => this.openStyleGuide(),
    'name-version': () => this.nameVersion(),
    'setup-code': () => this.openCodeExamples(),
    'add-makefile': () => (this.state.workspace?.files.includes('Makefile') ? this.openFile('Makefile') : this.addMakefile()),
    'book-settings': () => this.openSettings('book'),
    // Assistant
    'new-task': () => this.newTask(),
    'task-done': () => this.finishTask(),
    'ask-selection': () => this.attachSelection(),
    'fix-comments': () => this.runSlash('/fix'),
    stop: () => this.cancel(),
    permissions: () => this.openSettings('permissions'),
    // Window, Help
    'prev-tab': () => this.tabCommand('prev'),
    'next-tab': () => this.tabCommand('next'),
    'typst-guide': () => this.openGuide(),
    'take-tour': () => this.startTour(),
  };

  /** Commands that need a book open do nothing without one (the menu bar can't grey them out). */
  private static readonly WITHOUT_A_BOOK = new Set(['settings', 'command-palette', 'new-book', 'open-book', 'zoom-in', 'zoom-out', 'zoom-reset', 'typst-guide', 'toggle-sidebar', 'toggle-preview', 'toggle-assistant']);

  async menuCommand(id: string) {
    if (!this.state.workspace && !Studio.WITHOUT_A_BOOK.has(id)) return;
    try {
      await this.menuCommands[id]?.();
    } catch (e) {
      this.toast(errorMessage(e), 'error');
    }
  }

  /** A sidebar view, showing the sidebar if it was hidden. */
  revealSidebar(view: StudioState['sidebar']) {
    this.events.emit('show-explorer');
    this.showSidebar(view);
  }

  /** Run one of the editor's own actions (Find, Replace) from the menu bar or the command palette. */
  editorAction(id: string) {
    const editor = this.editor;
    if (!editor) return;
    editor.focus();
    void editor.getAction(id)?.run();
  }

  /** The writing style guide, created from the template if there isn't one. */
  async openStyleGuide() {
    if (this.state.styleGuide.exists) await this.openFile(STYLE_GUIDE_FILE);
    else this.openStyleTemplates();
  }

  /** Name the current version (as History's "Name this version…" does). */
  async nameVersion() {
    if (this.state.history.status !== 'ready') return;
    const name = await this.prompt({ title: 'Name this version', label: 'Name', placeholder: 'e.g. Draft 2 sent to editor', okLabel: 'Save' });
    if (!name?.trim()) return;
    await this.history.saveNamed(name.trim());
    this.revealSidebar('history');
  }

  /** Runnable code examples: set them up if needed, and show the Code view. */
  async openCodeExamples() {
    if (!this.state.code.setUp) await this.code.setUp();
    this.revealSidebar('code');
  }

  // ---- startup / workspace ----------------------------------------------------

  async init() {
    const launch = await ipc.launchOptions();
    this.store.set({ launch });
    const zoom = readJson<number>(ZOOM_KEY);
    if (zoom && zoom !== 1) await this.setZoom(zoom, { persist: false }).catch(() => {});
    // The settings file wins over this machine's cached copy; edits made elsewhere apply on return.
    await this.loadConfig();
    // Another window changed what a mode runs on: the mode menu says so here too.
    window.addEventListener('storage', (e) => {
      if (e.key === MODE_SETUPS_KEY) this.setAgent({ modeSetups: readModeSetups(readJson(MODE_SETUPS_KEY)) });
    });
    window.addEventListener('focus', () => {
      void this.loadConfig();
      // Commits made in a terminal or another app while this window was in the background.
      if (this.state.workspace) this.scheduleGitRefresh(0);
      // Pages can come back blank; redraw them (also on the preview's own return, see preview.rs).
      if (this.previewOpened) void ipc.previewEval("window.dispatchEvent(new Event('resize'))").catch(() => {});
    });
    await this.refreshViewportInset();
    // The inset changes with the title bar (e.g. full screen hides it).
    window.addEventListener('resize', () => {
      clearTimeout(this.insetTimer);
      this.insetTimer = window.setTimeout(() => void this.refreshViewportInset(), 100);
    });
    ipc.toolsStatus().then((tools) => this.store.set({ tools }));
    void ipc.updateState().then((update) => {
      this.store.set({ update });
      // At start, once (the first window), a few seconds in: a new version offered, unless it was skipped.
      if (getCurrentWebview().label === 'main' && !launch.selftestOut && !launch.fresh && update.installable && this.state.settings.checkForUpdates && update.status === 'idle') {
        window.setTimeout(() => void this.checkForUpdates({ dialog: false }), 4000);
      }
    });
    // A new window starts on the welcome screen, not the last book (open in the first window).
    // After Reload Window, the window's own book ('' for none).
    const reloaded = takeSession(RELOAD_KEY);
    const initial = reloaded !== null ? reloaded || null : (launch.workspace ?? (launch.fresh ? null : localStorage.getItem(LAST_WORKSPACE)));
    if (initial) await this.openWorkspace(initial);
  }

  async chooseWorkspace() {
    const picked = await openDialog({ directory: true, multiple: false, title: 'Open Typst project folder' });
    if (typeof picked === 'string') await this.openWorkspace(picked);
  }

  async openWorkspace(path: string) {
    // Each book opens in one window; asking first keeps this window's book if it's elsewhere.
    if (await ipc.workspaceElsewhere(path).catch(() => false)) {
      this.toast(`${path.slice(path.lastIndexOf('/') + 1)} is open in another window.`);
      return;
    }
    await this.closeWorkspace();
    this.store.set({ opening: path, openError: null });
    const changes = new Channel<string[]>();
    changes.onmessage = (paths) => this.onDiskChange(paths);
    let info: WorkspaceInfo;
    try {
      info = await ipc.workspaceOpen(path, changes);
    } catch (e) {
      this.store.set({ opening: null, openError: `Couldn't open ${path}: ${errorMessage(e)}` });
      return;
    }
    // Self-tests run against scratch folders: keep them out of the author's recent books.
    if (!this.state.launch?.selftestOut) {
      localStorage.setItem(LAST_WORKSPACE, info.root);
      const recent = [info.root, ...this.state.recent.filter((r) => r !== info.root)].slice(0, 8);
      writeJson(RECENT_KEY, recent);
      this.store.set({ recent });
    }
    this.docs = new Documents(info.root, this.typst, {
      onEdit: (p) => {
        this.perf.edit(() => this.publishPerf());
        // What Search found follows the text as it changes.
        if (this.state.search.query) this.scheduleSearch(500);
        if (p.endsWith('.typ')) {
          clearTimeout(this.codeScanTimer);
          this.codeScanTimer = window.setTimeout(() => {
            const doc = this.docs?.get(p);
            if (!doc) return;
            this.code.updateFile(p, doc.model.getValue());
            this.updateTodos(p, doc.model.getValue());
            this.store.set((s) => ({ contents: { ...s.contents, [p]: fileContents(doc.model.getValue()) } }));
          }, 400);
        }
        // A chapter shown alone is the main file with the others left out: it follows the main file's changes.
        if (p === this.state.workspace?.entry) this.scheduleChapterPreview();
      },
      onDirtyChange: (p, dirty) => {
        this.store.set((s) => ({ dirty: { ...s.dirty, [p]: dirty } }));
        // Saved: headings (and, for the main file, the chapter order) may have changed.
        if (!dirty && p.endsWith('.typ')) void this.refreshNames([p]);
        // Its headings and labels count for a chapter shown alone (its number, references to it).
        if (!dirty && p.endsWith('.typ')) this.scheduleChapterPreview();
      },
      onConflict: (p, message) =>
        this.store.set((s) => {
          const conflicts = { ...s.conflicts };
          if (message) conflicts[p] = message;
          else delete conflicts[p];
          return { conflicts };
        }),
      onQuestions: (p, questions) =>
        this.store.set((s) => {
          const all = { ...s.questions };
          if (questions.length) all[p] = questions;
          else delete all[p];
          return { questions: all };
        }),
      agentAtWork: () => (this.assistantBusy ? ASSISTANT_NAMES[this.state.settings.assistant] : null),
    });
    this.store.set({ workspace: info, opening: null, tabs: [], active: null, viewTab: null, guideOpen: false });

    await this.loadProjectSettings();
    void this.loadPeacockColor();
    await this.loadStyleGuide();
    this.aiEdits.clear();
    this.aiReads = [];
    void this.refreshNames();
    void this.history.start(this.historyExcludes()).then(() => this.refreshAiEdits());
    void this.git.refresh();
    void this.code.scan();
    void this.scanTodos();
    void this.loadReview();
    void this.startTypst();
    // The mode's own assistant, if it has one (mode-setups.ts).
    this.forgetThread();
    const own = this.setupFor(this.state.agent.mode)?.assistant;
    if (own && own !== this.state.settings.assistant) this.updateSettings({ assistant: own }, { restart: false });
    void this.startAgent();

    const saved = readJson<{ tabs: string[]; active: string | null }>(tabsKey(info.root));
    const tabs = (saved?.tabs ?? []).filter((t) => info.files.includes(t));
    const fallback = info.entry ? [info.entry] : info.files.filter((f) => f.endsWith('.typ')).slice(0, 1);
    for (const t of tabs.length ? tabs : fallback) await this.openFile(t, { activate: false });
    const active = saved?.active && this.state.tabs.includes(saved.active) ? saved.active : this.state.tabs[0];
    if (active) await this.openFile(active);
    // Someone new (this is the only book they've opened): the tour, once the window has settled.
    if (!this.state.launch?.selftestOut && shouldStartTour(tourSeen(), this.state.recent.length)) setTimeout(() => this.state.workspace?.root === info.root && this.startTour(), 1500);
  }

  // ---- search (the Search view, ⇧⌘F) ------------------------------------------------------

  private searchTimer = 0;
  private searchRun = 0;

  /** ⇧⌘F: the Search view, its box focused, with the editor's selection in it (one line of it). */
  showSearch() {
    this.revealSidebar('search');
    const selection = this.editor?.hasTextFocus() ? this.editor.getModel()?.getValueInRange(this.editor.getSelection()!) : '';
    this.events.emit('focus-search', selection && !selection.includes('\n') ? selection : null);
  }

  /** What to search for, and how: the book is searched again a moment after typing, at once for an option. */
  setSearch(patch: Partial<Pick<SearchState, 'query' | 'replace' | 'options'>>) {
    this.store.set((s) => ({ search: { ...s.search, ...patch } }));
    if ('query' in patch || 'options' in patch) this.scheduleSearch('query' in patch ? 200 : 0);
  }

  private scheduleSearch(delay: number) {
    clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => void this.runSearch(), delay);
  }

  /** The book's text files in reading order: the main file, its chapters as it includes them, then the rest by name. */
  private searchFiles(): string[] {
    const ws = this.state.workspace;
    if (!ws) return [];
    const skip = this.historyExcludes();
    const files = ws.files.filter((f) => SEARCHABLE.test(f) && !f.startsWith('.foreword/') && f !== PROJECT_FILE && !skip.some((x) => `/${f}`.startsWith(x)));
    const first = [ws.entry, ...this.state.names.chapters].filter((f): f is string => !!f && files.includes(f));
    return [...new Set([...first, ...files.filter((f) => !first.includes(f)).sort()])];
  }

  /** Search the book's text (open files as they are in the editor), up to SEARCH_LIMIT matches. */
  async runSearch() {
    const run = ++this.searchRun;
    const { query, options } = this.state.search;
    const re = searchPattern(query, options);
    const done = (patch: Partial<SearchState>) => run === this.searchRun && this.store.set((s) => ({ search: { ...s.search, searching: false, ...patch } }));
    if (!re) return done({ results: null, error: null, total: 0, capped: false });
    if ('error' in re) return done({ results: null, error: re.error, total: 0, capped: false });
    this.store.set((s) => ({ search: { ...s.search, searching: true, error: null } }));
    const results: FileMatches[] = [];
    let total = 0;
    for (const path of this.searchFiles()) {
      const text = await this.currentText(path);
      if (run !== this.searchRun) return;
      const matches = text == null ? [] : searchText(text, re, SEARCH_LIMIT - total);
      if (matches.length) results.push({ path, matches });
      total += matches.length;
      if (total >= SEARCH_LIMIT) break;
    }
    done({ results, total, capped: total >= SEARCH_LIMIT });
  }

  /** A match: its file in front, the match selected. */
  async revealMatch(path: string, match: SearchMatch) {
    await this.openFile(path);
    const editor = this.editor;
    if (!editor) return;
    const range = new monaco.Range(match.line, match.column, match.line, match.column + match.length);
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
    editor.focus();
  }

  /**
   * Replace every match in the book, after asking. History keeps a version of
   * the book from just before; open files can be undone in the editor too.
   */
  async replaceAll() {
    const { query, replace, options, results, total } = this.state.search;
    const re = searchPattern(query, options);
    if (!re || 'error' in re || !results?.length) return;
    const files = results.length;
    const what = `${total} match${total === 1 ? '' : 'es'} in ${files} file${files === 1 ? '' : 's'}`;
    const ok = await this.confirmAction(`Replace ${what} with “${replace}”?\n\nHistory keeps the book as it is now, so you can go back.`, 'Replace All', 'Replace All');
    if (!ok) return;
    await this.history.checkpoint().catch(() => null);
    let count = 0;
    for (const { path } of results) {
      try {
        await this.editFile(path, (text) => {
          const r = replaceText(text, re, replace, options);
          count += r.count;
          return r.text;
        });
      } catch (e) {
        this.toast(`Couldn't replace in ${path}: ${errorMessage(e)}`, 'error');
      }
    }
    this.toast(`Replaced ${count} match${count === 1 ? '' : 'es'} in ${files} file${files === 1 ? '' : 's'}.`);
    await this.runSearch();
  }

  // ---- the tour -----------------------------------------------------------------------

  /** The tour from its first step (Help ▸ Take the Tour, and a new author's first book). */
  startTour() {
    if (!this.state.workspace) return;
    this.store.set({ tour: 0, quickOpen: false, settingsOpen: false, guideOpen: false });
  }

  /** The next step (1) or the one before (−1); past the last, the tour ends. */
  tourStep(direction: 1 | -1) {
    const at = this.state.tour;
    if (at === null) return;
    const next = at + direction;
    if (next >= TOUR_STEPS.length) return this.endTour();
    this.store.set({ tour: Math.max(0, next) });
  }

  /** The tour is over (finished or skipped): it won't start by itself again. */
  endTour() {
    this.store.set({ tour: null });
    try {
      localStorage.setItem(TOUR_SEEN_KEY, '1');
    } catch {
      // Then it may offer itself again next time: harmless.
    }
  }

  /** Put text in the message box (without sending). */
  fillComposer(text: string) {
    this.composerDraft = text;
    this.events.emit('fill-composer', text);
  }

  // ---- small dialogs ------------------------------------------------------------------

  private promptResolve: ((value: string | null) => void) | null = null;

  /** Ask for a line of text (a few, with `multiline`). Resolves null if cancelled. */
  prompt(request: Omit<PromptRequest, 'value'> & { value?: string }): Promise<string | null> {
    this.promptResolve?.(null);
    this.store.set({ prompt: { value: '', ...request } });
    this.syncPreviewVisibility();
    return new Promise((resolve) => (this.promptResolve = resolve));
  }

  answerPrompt(value: string | null) {
    const resolve = this.promptResolve;
    this.promptResolve = null;
    this.store.set({ prompt: null });
    this.syncPreviewVisibility();
    resolve?.(value);
  }

  // ---- files: new, rename, duplicate, trash ---------------------------------------------

  /** The folder new files go in by default: the active file's folder. */
  private defaultFolder() {
    const a = this.state.active;
    return a?.includes('/') ? a.slice(0, a.lastIndexOf('/')) : '';
  }

  private static validName(name: string): string | null {
    const n = name.trim().replace(/^\/+|\/+$/g, '');
    if (!n || n.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.'))) return null;
    return n;
  }

  /** Apply a text transform to a file: in its buffer if open (saved unless it had unsaved edits), else on disk. */
  private async editFile(path: string, transform: (text: string) => string): Promise<boolean> {
    const doc = this.docs?.get(path);
    if (doc && this.docs) {
      const before = doc.model.getValue();
      const after = transform(before);
      if (after === before) return false;
      const wasDirty = this.docs.isDirty(doc);
      const edit = minimalEdit(before, after);
      if (edit) {
        const start = doc.model.getPositionAt(edit.start);
        const end = doc.model.getPositionAt(edit.end);
        // Its own step in the editor's undo, not part of what the author last typed.
        doc.model.pushStackElement();
        doc.model.pushEditOperations([], [{ range: monaco.Range.fromPositions(start, end), text: edit.text }], () => null);
        doc.model.pushStackElement();
      }
      if (!wasDirty) await this.docs.save(path);
      return true;
    }
    const { text, hash } = await ipc.fsRead(path);
    const after = transform(text);
    if (after === text) return false;
    await ipc.fsWrite(path, after, hash);
    return true;
  }

  /**
   * editFile through an open document, so Tinymist has the new text at once (a
   * disk write only reaches it through its file watcher, a moment later: too
   * late for an export straight after).
   */
  private async editForExport(path: string, transform: (text: string) => string): Promise<boolean> {
    await this.docs?.open(path);
    return this.editFile(path, transform);
  }

  private typFiles() {
    return (this.state.workspace?.files ?? []).filter((f) => f.endsWith('.typ'));
  }

  async newFile(folder = this.defaultFolder()) {
    const answer = await this.prompt({
      title: 'New file',
      label: 'Name',
      value: folder ? `${folder}/` : '',
      placeholder: 'e.g. notes.typ or chapters/epilogue.typ',
      okLabel: 'Create',
      help: `In the book’s folder, ${tildePath(this.state.workspace?.root ?? '')}. Folders in the name are created as needed.`,
    });
    const path = answer && Studio.validName(answer);
    if (answer && !path) return this.toast(`“${answer}” isn't a usable file name`, 'error');
    if (!path) return;
    try {
      if (path.includes('/')) await ipc.fsMkdir(path.slice(0, path.lastIndexOf('/'))).catch(() => {});
      await ipc.fsWrite(path, '', null);
      await this.refreshFiles();
      await this.openFile(path);
    } catch (e) {
      this.toast(`Couldn't create ${path}: ${errorMessage(e)}`, 'error');
    }
  }

  async newFolder(folder = this.defaultFolder()) {
    const answer = await this.prompt({
      title: 'New folder',
      label: 'Name',
      value: folder ? `${folder}/` : '',
      placeholder: 'e.g. figures',
      okLabel: 'Create',
      help: `In the book’s folder, ${tildePath(this.state.workspace?.root ?? '')}.`,
    });
    const path = answer && Studio.validName(answer);
    if (answer && !path) return this.toast(`“${answer}” isn't a usable folder name`, 'error');
    if (!path) return;
    try {
      await ipc.fsMkdir(path);
      await this.refreshFiles();
      this.toast(`Created ${path}/ (it shows in the file list once it has a file in it)`);
    } catch (e) {
      this.toast(`Couldn't create ${path}: ${errorMessage(e)}`, 'error');
    }
  }

  /** Open tabs inside `path` (a file or a folder). */
  private tabsUnder(path: string) {
    return this.state.tabs.filter((t) => t === path || t.startsWith(`${path}/`));
  }

  /**
   * Rename a file or folder (in place), then point every reference in the
   * book's .typ files at the new name, and move open tabs along. Refuses while
   * an affected file has unsaved edits.
   */
  async renamePath(path: string) {
    const ws = this.state.workspace;
    if (!ws) return;
    const name = path.split('/').pop()!;
    const dir = path.slice(0, path.length - name.length).replace(/\/$/, '');
    const answer = await this.prompt({ title: `Rename ${name}`, label: 'New name', value: name, okLabel: 'Rename', help: 'References to it in the book (#include, images…) are updated too.' });
    if (!answer || answer.trim() === name) return;
    const newName = answer.trim();
    if (newName.includes('/') || !Studio.validName(newName)) return this.toast(`“${newName}” isn't a usable name`, 'error');
    const to = dir ? `${dir}/${newName}` : newName;
    const open = this.tabsUnder(path);
    const dirty = open.filter((t) => this.state.dirty[t]);
    if (dirty.length) return this.toast(`Save or close ${dirty.join(', ')} first: it has unsaved changes.`, 'error');
    const active = this.state.active;
    for (const t of open) await this.closeTab(t);
    try {
      await ipc.fsRename(path, to);
    } catch (e) {
      for (const t of open) await this.openFile(t, { activate: false }).catch(() => {});
      return this.toast(`Couldn't rename: ${errorMessage(e)}`, 'error');
    }
    // References: every .typ file, at its new location if it moved too.
    let updated = 0;
    const files: string[] = [];
    const moved = (f: string) => (f === path || f.startsWith(`${path}/`) ? to + f.slice(path.length) : f);
    for (const was of this.typFiles()) {
      const now = moved(was);
      try {
        let count = 0;
        const changed = await this.editFile(now, (text) => {
          const r = updateReferences(text, now, path, to, was, this.typstRoot());
          count = r.count;
          return r.text;
        });
        if (changed) {
          updated += count;
          files.push(now);
        }
      } catch (e) {
        this.toast(`Renamed, but couldn't update references in ${now}: ${errorMessage(e)}`, 'error');
      }
    }
    // The file list must know the new name before the main file can point at it.
    await this.refreshFiles();
    if (ws.entry && (ws.entry === path || ws.entry.startsWith(`${path}/`))) await this.setEntryPoint(moved(ws.entry));
    for (const t of open) await this.openFile(moved(t), { activate: false }).catch(() => {});
    if (active && open.includes(active)) await this.openFile(moved(active)).catch(() => {});
    this.toast(`Renamed to ${newName}${updated ? `; updated ${updated} reference${updated > 1 ? 's' : ''} in ${files.join(', ')}` : ''}`);
  }

  async duplicate(path: string) {
    const name = path.split('/').pop()!;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [path.slice(0, path.length - name.length + dot), name.slice(dot)] : [path, ''];
    const files = new Set(this.state.workspace?.files ?? []);
    let copy = `${stem} copy${ext}`;
    for (let i = 2; files.has(copy); i++) copy = `${stem} copy ${i}${ext}`;
    try {
      if (this.state.dirty[path]) await this.save(path, { format: false });
      await ipc.fsCopy(path, copy);
      await this.refreshFiles();
      await this.openFile(copy);
    } catch (e) {
      this.toast(`Couldn't duplicate ${path}: ${errorMessage(e)}`, 'error');
    }
  }

  /**
   * Move a file or folder to the Trash, after confirming. Whole-line
   * #include lines for it are removed too (otherwise the book stops
   * compiling); other references are named in the confirmation.
   */
  async trashPath(path: string) {
    const ws = this.state.workspace;
    if (!ws) return;
    const refs: { file: string; include: boolean }[] = [];
    for (const f of this.typFiles()) {
      if (f === path || f.startsWith(`${path}/`)) continue;
      const doc = this.docs?.get(f);
      const text = doc ? doc.model.getValue() : await ipc.fsRead(f).then((r) => r.text, () => '');
      for (const ref of referencesTo(text, f, path, this.typstRoot())) refs.push({ file: f, include: ref.wholeInclude });
    }
    const includeFiles = [...new Set(refs.filter((r) => r.include).map((r) => r.file))];
    const otherFiles = [...new Set(refs.filter((r) => !r.include).map((r) => r.file))];
    const dirty = this.tabsUnder(path).filter((t) => this.state.dirty[t]);
    const lines = [
      `Move “${path}” to the Trash? You can put it back from the Trash in Finder, and History keeps a copy.`,
      includeFiles.length ? `Its #include line in ${includeFiles.join(', ')} will be removed too.` : '',
      otherFiles.length ? `${otherFiles.join(', ')} also refer${otherFiles.length === 1 ? 's' : ''} to it, and won't compile until you change that.` : '',
      dirty.length ? `Unsaved changes in ${dirty.join(', ')} will be lost.` : '',
    ].filter(Boolean);
    if (!(await this.confirmAction(lines.join('\n\n'), 'Move to Trash', 'Move to Trash'))) return;
    for (const t of this.tabsUnder(path)) {
      this.store.set((st) => ({ dirty: { ...st.dirty, [t]: false } }));
      await this.closeTab(t);
    }
    try {
      await ipc.fsTrash(path);
    } catch (e) {
      return this.toast(`Couldn't move it to the Trash: ${errorMessage(e)}`, 'error');
    }
    let removed = 0;
    for (const f of includeFiles) {
      await this.editFile(f, (text) => {
        const r = removeIncludes(text, f, path, this.typstRoot());
        removed += r.count;
        return r.text;
      }).catch((e) => this.toast(`Couldn't update ${f}: ${errorMessage(e)}`, 'error'));
    }
    await this.refreshFiles();
    this.toast(`Moved ${path} to the Trash${removed ? ` and removed its #include from ${includeFiles.join(', ')}` : ''}`);
  }

  /** A yes/no question (native dialog; the self-test overrides it). */
  confirmAction: (message: string, title: string, okLabel: string) => Promise<boolean> = (message, title, okLabel) =>
    ask(message, { title, kind: 'warning', okLabel, cancelLabel: 'Cancel' });

  // ---- chapters -----------------------------------------------------------------------

  /** File → New Chapter: ask for a title, then add the chapter. */
  async newChapter() {
    const ws = this.state.workspace;
    if (!ws) return;
    const title = await this.prompt({
      title: 'New chapter',
      label: 'Chapter title',
      placeholder: 'e.g. The Island',
      okLabel: 'Add chapter',
      help: ws.entry
        ? `Creates a numbered file in the chapters folder and adds it to ${ws.entry} after the last chapter.`
        : 'Creates a numbered file in the chapters folder.',
    });
    if (title?.trim()) await this.addChapter(title.trim());
  }

  /**
   * Create chapters/NN-title.typ (numbered after the last one, with the same
   * #import lines) and add its #include to the main file, then open it. The
   * main file is changed in its buffer (undoable) and saved unless it already
   * had unsaved edits.
   */
  async addChapter(title: string): Promise<string | null> {
    const ws = this.state.workspace;
    if (!ws || !this.docs) return null;
    // Chapters live next to the main file, in "chapters".
    const folder = `${ws.entry?.includes('/') ? ws.entry.slice(0, ws.entry.lastIndexOf('/') + 1) : ''}chapters`;
    const path = nextChapterPath(ws.files, title, folder);
    const sample = ws.files.filter((f) => f.startsWith(`${folder}/`) && f.endsWith('.typ')).sort()[0];
    const imports = sample ? chapterImports((await ipc.fsRead(sample).catch(() => ({ text: '' }))).text) : [];
    try {
      await ipc.fsWrite(path, chapterText(title, imports), null);
    } catch (e) {
      this.toast(`Couldn't create ${path}: ${errorMessage(e)}`, 'error');
      return null;
    }
    if (ws.entry) {
      try {
        const doc = await this.docs.open(ws.entry);
        const wasDirty = this.docs.isDirty(doc);
        const before = doc.model.getValue();
        const edit = minimalEdit(before, withInclude(before, includePath(ws.entry, path)));
        if (edit) {
          const start = doc.model.getPositionAt(edit.start);
          const end = doc.model.getPositionAt(edit.end);
          doc.model.pushEditOperations([], [{ range: monaco.Range.fromPositions(start, end), text: edit.text }], () => null);
        }
        if (!wasDirty) await this.docs.save(ws.entry);
      } catch (e) {
        this.toast(`Created ${path}, but couldn't add it to ${ws.entry}: ${errorMessage(e)}`, 'error');
      }
    }
    await this.refreshFiles();
    await this.openFile(path);
    const model = this.editor?.getModel();
    if (model) {
      const last = model.getLineCount();
      this.editor!.setPosition({ lineNumber: last, column: model.getLineMaxColumn(last) });
      this.editor!.focus();
    }
    this.toast(ws.entry ? `Added ${path} to ${ws.entry}` : `Created ${path}`);
    return path;
  }

  // ---- help for writers new to Typst ------------------------------------------------

  /** "Typst basics" in its own tab, beside the files (a dialog on the welcome screen). */
  openGuide() {
    if (this.state.workspace) this.openViewTab(GUIDE_TAB);
    else this.store.set({ guideOpen: true });
  }

  closeGuide() {
    if (this.state.tabs.includes(GUIDE_TAB)) this.closeViewTab(GUIDE_TAB);
    this.store.set({ guideOpen: false });
  }

  /** Put a guide example at the cursor (block examples get their own paragraph), in front. Undoable. */
  insertSnippet(code: string) {
    if (this.state.viewTab && this.state.active) this.activate(this.state.active);
    const editor = this.editor;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection || !this.state.active) {
      this.toast('Open a chapter first, then put the cursor where the example should go.');
      return;
    }
    const line = model.getLineContent(selection.startLineNumber);
    const before = line.slice(0, selection.startColumn - 1);
    const after = model.getLineContent(selection.endLineNumber).slice(selection.endColumn - 1);
    editor.pushUndoStop();
    editor.executeEdits('typst-guide', [{ range: selection, text: snippetInsertion(code, before, after), forceMoveMarkers: true }]);
    editor.pushUndoStop();
    editor.focus();
  }

  /** Errors across the book, in file and line order. */
  private errorList() {
    return [...this.diagnostics.entries()]
      .flatMap(([path, list]) => list.filter((d) => d.severity === 1).map((d) => ({ path, d })))
      .sort((a, b) => a.path.localeCompare(b.path) || a.d.range.start.line - b.d.range.start.line);
  }

  /** Select the next error after the cursor (wrapping around), opening its file. */
  async nextProblem() {
    const errors = this.errorList();
    if (!errors.length) return null;
    const cursor = this.state.cursor;
    const active = this.state.active;
    const next =
      errors.find(({ path, d }) => {
        if (!active || !cursor) return true;
        const c = path.localeCompare(active);
        return c > 0 || (c === 0 && d.range.start.line + 1 > cursor.line);
      }) ?? errors[0];
    await this.openFile(next.path);
    const { start, end } = next.d.range;
    const range = new monaco.Range(start.line + 1, start.character + 1, end.line + 1, end.character + 1);
    this.editor?.setSelection(range);
    this.editor?.revealRangeInCenterIfOutsideViewport(range);
    this.editor?.focus();
    return next;
  }

  /** Ask the assistant to explain and fix the next error, with its line attached. */
  async fixProblem(problem?: { path: string; d: LspDiagnostic }) {
    problem ??= (await this.nextProblem()) ?? undefined;
    if (!problem || !this.editor) return;
    if (this.state.active !== problem.path || this.state.viewTab) await this.openFile(problem.path);
    const model = this.editor.getModel()!;
    const { start, end } = problem.d.range;
    this.editor.setSelection(new monaco.Range(start.line + 1, 1, end.line + 1, model.getLineMaxColumn(end.line + 1)));
    this.setAgent({ attachments: [] });
    await this.attachSelection({ focus: false });
    this.events.emit('show-agent-pane');
    await this.send(fixErrorPrompt(problem.d.message));
  }

  /** The Typst error under a position in the active file (1-based), if any. */
  errorAt(line: number, column: number) {
    const path = this.state.active;
    const d = path
      ? (this.diagnostics.get(path) ?? []).find((x) => {
          if (x.severity !== 1) return false;
          const { start, end } = x.range;
          const after = line - 1 > start.line || (line - 1 === start.line && column - 1 >= start.character);
          const before = line - 1 < end.line || (line - 1 === end.line && column - 1 <= end.character);
          return after && before;
        })
      : undefined;
    return path && d ? { path, d } : null;
  }

  // ---- selection actions (the selection bar, context menus) ---------------------------

  /**
   * A request from the selection bar's card, in its mode: Revise changes the
   * passage in place (that changes the book, so it's done in Write mode),
   * Options writes three versions to pick from, Ask answers the author's
   * question about it and changes nothing.
   */
  sendFromBar(kind: BarKind, instruction: string, signal?: AbortSignal): Promise<boolean> {
    return this.sendAboutSelection(BAR_MODE[kind], barMessage(kind, instruction), signal);
  }

  /**
   * A message about the selection alone, in `mode`. The selection goes with
   * it, and the editor lets go of it (the cursor at its end), so the mark on
   * the passage shows while the assistant works. A reply running in another
   * mode is let finish first, so it keeps what its mode allowed (an Ask reply
   * never gets to edit); `signal` calls it off meanwhile.
   */
  private async sendAboutSelection(mode: AgentMode, message: string, signal?: AbortSignal): Promise<boolean> {
    this.setAgent({ attachments: [] });
    await this.attachSelection({ focus: false });
    const end = this.editor?.getSelection()?.getEndPosition();
    if (end) this.editor!.setSelection(monaco.Range.fromPositions(end));
    this.events.emit('show-agent-pane');
    if (this.state.agent.mode !== mode) {
      await this.untilIdle();
      if (signal?.aborted) return false;
      await this.setMode(mode);
      if (this.state.agent.mode !== mode) return false;
    }
    return !signal?.aborted && this.send(message);
  }

  /** Once no reply is running in the conversation shown. */
  private untilIdle(): Promise<void> {
    if (!this.state.agent.running) return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.store.subscribe(() => {
        if (this.state.agent.running) return;
        off();
        resolve();
      });
    });
  }

  /** "Add to chat" (the selection bar's ⌘I): the selection goes with the chat, in the mode it's in, which shows with the cursor in its message box. */
  async askAboutSelection() {
    this.events.emit('show-agent-pane');
    await this.attachSelection();
  }

  /** The card's "Continue in chat": in its tab's mode (Ask's for a question), what the author typed goes after what's in the message box. */
  async continueInChat(kind: BarKind, draft: string) {
    await this.setMode(BAR_MODE[kind]);
    this.events.emit('show-agent-pane');
    await this.attachSelection({ focus: false });
    const typed = draft.trim();
    if (!typed) return this.events.emit('focus-composer');
    const before = this.composerDraft.trimEnd();
    this.fillComposer(before ? `${before}\n\n${typed}` : typed);
  }

  /** The first Typst error in a range of the active file (1-based), if any: the selection bar offers to fix it. */
  errorIn(range: monaco.IRange) {
    const path = this.state.active;
    const d = path
      ? (this.diagnostics.get(path) ?? []).find((x) => {
          if (x.severity !== 1) return false;
          const { start, end } = x.range;
          const startsBefore = start.line + 1 < range.endLineNumber || (start.line + 1 === range.endLineNumber && start.character + 1 <= range.endColumn);
          const endsAfter = end.line + 1 > range.startLineNumber || (end.line + 1 === range.startLineNumber && end.character + 1 >= range.startColumn);
          return startsBefore && endsAfter;
        })
      : undefined;
    return path && d ? { path, d } : null;
  }

  async closeTabs(paths: string[]) {
    for (const p of paths) await this.closeTab(p);
  }

  /** Make a .typ file the book's main file (saved in .foreword.json). */
  async setEntryPoint(path: string) {
    const errors = await this.updateProjectSettings({ entryPoint: path });
    if (errors.length) this.toast(errors.join(' '), 'error');
    else this.toast(`${path} is now the main file`);
  }

  /**
   * The Typst root, relative to the folder opened ('' for the folder itself):
   * where paths starting with "/" begin. `root` in .foreword.json, else the
   * main file's folder, as `typst compile` does.
   */
  typstRoot(): string {
    return typstRootOf(this.state.project.settings, this.state.workspace?.entry ?? null);
  }

  absolutePath(path: string) {
    return `${this.state.workspace?.root ?? ''}/${path}`.replace(/\/$/, '');
  }

  async reveal(path: string) {
    try {
      await ipc.revealInFinder(path);
    } catch (e) {
      this.toast(`Couldn't show it in Finder: ${errorMessage(e)}`, 'error');
    }
  }

  copy(text: string, what = 'Copied') {
    copyText(text).then(
      () => this.toast(what),
      (e) => this.toast(`Couldn't copy: ${errorMessage(e)}`, 'error'),
    );
  }

  private jumpCatcher: ((jump: SourceJump) => void) | null = null;

  /** Click a marked text run in the preview and catch where Tinymist says it comes from. */
  private async sourceOf(which: 'start' | 'end'): Promise<SourceJump | null> {
    const jump = new Promise<SourceJump | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 1500);
      this.jumpCatcher = (j) => {
        clearTimeout(timer);
        resolve(j);
      };
    });
    await ipc.previewEval(
      `(() => { const el = document.querySelector('[data-studio-sel="${which}"]'); if (el) { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 1, clientY: r.top + r.height / 2 })); } })()`,
    );
    const result = await jump;
    this.jumpCatcher = null;
    return result;
  }

  /**
   * Text selected in the preview: find it in the source (where the preview's
   * click-to-source mapping points, then the exact text nearby) and select it
   * in the editor, so it goes with the next chat message.
   */
  private async previewSelection(report: { text: string; end?: boolean }) {
    if (!report.text.trim() || this.jumpCatcher) return;
    const start = await this.sourceOf('start');
    const end = report.end ? await this.sourceOf('end') : null;
    const root = this.state.workspace?.root;
    if (!start?.start || !root || !start.filepath.startsWith(root + '/')) return;
    const path = start.filepath.slice(root.length + 1);
    this.suppressSyncUntil = performance.now() + 800;
    await this.openFile(path);
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model || this.state.active !== path) return;
    const a = model.getOffsetAt({ lineNumber: start.start[0] + 1, column: start.start[1] + 1 });
    const sameFile = end?.start && end.filepath === start.filepath;
    const b = sameFile ? model.getOffsetAt({ lineNumber: end!.end![0] + 1, column: end!.end![1] + 1 }) : a;
    // Look for the text around where the preview says it starts.
    const from = model.getOffsetAt({ lineNumber: Math.max(1, start.start[0] - 2), column: 1 });
    const toLine = Math.min(model.getLineCount(), (sameFile ? end!.start![0] : start.start[0]) + 4);
    const to = model.getOffsetAt({ lineNumber: toLine, column: model.getLineMaxColumn(toLine) });
    const windowText = model.getValue().slice(from, to);
    const found = findInSource(windowText, report.text, a - from) ?? findPartial(windowText, report.text, a - from);
    const [s0, s1] = found ? [from + found[0], from + found[1]] : [Math.min(a, b), Math.max(a, b, model.getOffsetAt({ lineNumber: start.start[0] + 1, column: model.getLineMaxColumn(start.start[0] + 1) }))];
    const range = monaco.Range.fromPositions(model.getPositionAt(s0), model.getPositionAt(s1));
    this.selectionFrom = 'preview';
    // The author's own selection, so the selection bar comes for it as for one made in the editor.
    editor.setSelection(range, 'preview');
    editor.revealRangeInCenterIfOutsideViewport(range);
    this.onEditorSelection();
  }

  /** Right-click in the preview (reported by the preview webview). */
  private async previewContextMenu(x: number, y: number, selection: string) {
    // Tinymist handles clicks on its text elements; the topmost element at the point
    // can be a canvas layer, so find the text under (or nearest to) the point.
    const click = () =>
      ipc.previewEval(`(() => {
        const x = ${x}, y = ${y};
        let best = null, bestD = Infinity;
        for (const t of document.querySelectorAll('.typst-text')) {
          const r = t.getBoundingClientRect();
          const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
          const d = dx * dx + dy * dy;
          if (d < bestD) { best = t; bestD = d; }
        }
        if (best) best.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      })()`);
    await showContextMenu([
      !!selection.trim() && { label: 'Copy', action: () => this.copy(selection) },
      'separator',
      { label: 'Show the Text Here', action: () => void click() },
      ...(this.state.previewTarget === 'cover'
        ? [
            { label: 'Show the Book', action: () => void this.setPreviewTarget('book') },
            { label: 'Update Cover from Book', action: () => void this.updateCoverFromBook() },
            { label: 'Export Cover', action: () => void this.exportCover(), enabled: !this.state.exporting },
          ]
        : [
            { label: 'Export PDF…', accelerator: 'CmdOrCtrl+Shift+E', action: () => void this.exportPdf(), enabled: !this.state.exporting },
            this.chapterPreview
              ? { label: 'Show the Whole Book', action: () => void this.showInPreview('book') }
              : { label: 'Show Only This Chapter', action: () => void this.showInPreview('chapter'), enabled: this.state.names.chapters.length > 1 },
          ]),
      'separator',
      { label: 'Restart Preview', action: () => void this.restartTypst() },
    ]);
  }

  // ---- new book from a template ------------------------------------------------------

  openNewBook(tab: NewBookTab = 'book') {
    this.store.set({ newBookOpen: true, newBookTab: tab });
    this.syncPreviewVisibility();
  }

  /**
   * Open a sample book: its copy in ~/Documents/Foreword Samples, made
   * the first time (later, the same copy opens with the author's changes).
   * Throws (for the dialog) if that fails. `parent` is for self-tests.
   */
  async openSample(id: string, parent?: string) {
    const sample = SAMPLES.find((s) => s.id === id);
    if (!sample) throw new Error(`Unknown sample ${id}`);
    parent ??= `${(await documentDir()).replace(/\/$/, '')}/${SAMPLES_FOLDER}`;
    const root = await ipc.sampleCreate(id, parent, sample.name);
    this.closeNewBook();
    await this.openWorkspace(root);
    await this.openFile(sample.firstFile).catch(() => {});
    this.toast(`Opened “${sample.name}”, your copy in ${tildePath(parent)}`);
  }

  closeNewBook() {
    this.store.set({ newBookOpen: false });
    this.syncPreviewVisibility();
  }

  /** Create `parent/<title>` from a template and open it. Throws (for the dialog) if that fails. */
  async createBook(templateId: string, info: { title: string; author: string; size?: { width: string; height: string } }, parent: string) {
    const paper = PAPER_TEMPLATES.find((t) => t.id === templateId);
    if (paper) return this.createPaper(paper, info, parent);
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error(`Unknown template ${templateId}`);
    const files = templateFiles(template, { ...info, year: String(new Date().getFullYear()) });
    const root = await ipc.projectCreate(parent, bookFolderName(info.title), files);
    // Remembered for next time, except by self-tests (they share the author's storage).
    if (!this.state.launch?.selftestOut) {
      localStorage.setItem(NEW_BOOK_PARENT, parent);
      if (info.author.trim()) localStorage.setItem(AUTHOR_KEY, info.author.trim());
    }
    this.closeNewBook();
    await this.openWorkspace(root);
    await this.openFile(template.firstFile).catch(() => {});
    this.toast(`Created “${root.split('/').pop()}” from the ${template.name} template`);
  }

  /**
   * A paper from an official template package (downloaded from Typst
   * Universe). Its title and authors live in the template's own markup, so the
   * assistant is offered the job of filling them in (the message waits in
   * the composer).
   */
  private async createPaper(paper: (typeof PAPER_TEMPLATES)[number], info: { title: string; author: string }, parent: string) {
    const created = await ipc.projectCreateFromPackage(parent, bookFolderName(info.title), paper.package, paperExtras(info));
    if (!this.state.launch?.selftestOut) {
      localStorage.setItem(NEW_BOOK_PARENT, parent);
      if (info.author.trim()) localStorage.setItem(AUTHOR_KEY, info.author.trim());
    }
    this.closeNewBook();
    await this.openWorkspace(created.root);
    await this.openFile(created.entry).catch(() => {});
    const fonts = paper.fonts ?? [];
    if (fonts.length) {
      this.pushItem({
        kind: 'notice',
        id: uid('n'),
        tone: 'info',
        text: `The ${paper.name} template looks best with ${fonts.map((f) => f.name).join(' and ')} (free). Without them Typst uses similar fonts and shows a warning. To install: brew install --cask ${fonts.map((f) => f.cask).join(' ')}`,
      });
    }
    this.events.emit('show-agent-pane');
    this.fillComposer(paperSetupMessage(info));
    this.toast(`Created “${created.root.split('/').pop()}” from the ${paper.name} template (${paper.package.name} ${paper.package.version})`);
  }

  // ---- TODOs in the book -----------------------------------------------------------

  private todoFiles = new Map<string, Todo[]>();

  private static todoSource = (f: string) => f.endsWith('.typ') || f.endsWith('.md');

  /** Read every .typ and .md file (open buffers as they are) for TODOs. */
  async scanTodos() {
    const docs = this.docs;
    const next = new Map<string, Todo[]>();
    for (const path of (this.state.workspace?.files ?? []).filter(Studio.todoSource)) {
      const doc = docs?.get(path);
      const text = doc ? doc.model.getValue() : await ipc.fsRead(path).then((r) => r.text, () => '');
      const found = parseTodos(text, path);
      if (found.length) next.set(path, found);
    }
    this.todoFiles = next;
    this.store.set({ todos: [...next.values()].flat() });
  }

  private updateTodos(path: string, text: string) {
    if (!Studio.todoSource(path)) return;
    const found = parseTodos(text, path);
    if (!found.length && !this.todoFiles.has(path)) return;
    if (found.length) this.todoFiles.set(path, found);
    else this.todoFiles.delete(path);
    this.store.set({ todos: [...this.todoFiles.values()].flat() });
  }

  /** "Done": remove the TODO comment (undoable in the editor, and kept in History). */
  async todoDone(todo: Todo) {
    let removed = false;
    try {
      await this.editFile(todo.path, (text) => {
        const lines = text.split('\n');
        const line = lines[todo.line - 1];
        const next = line === undefined ? null : withoutTodo(line, todo);
        if (next === null) return text;
        removed = true;
        if (next === '') lines.splice(todo.line - 1, 1);
        else lines[todo.line - 1] = next;
        return lines.join('\n');
      });
    } catch (e) {
      return this.toast(`Couldn't update ${todo.path}: ${errorMessage(e)}`, 'error');
    }
    if (!removed) this.toast('Remove this one in the editor (it isn’t a // TODO comment).', 'error');
    await this.scanTodos();
  }

  /** Ask the assistant to do a TODO, with its line attached. */
  async askTodo(todo: Todo) {
    await this.openAt(todo.path, todo.line);
    const model = this.editor?.getModel();
    if (model) this.editor!.setSelection(new monaco.Range(todo.line, 1, todo.line, model.getLineMaxColumn(todo.line)));
    this.setAgent({ attachments: [] });
    await this.attachSelection({ focus: false });
    this.events.emit('show-agent-pane');
    await this.send(todoPrompt(todo));
  }

  /** A Makefile so the book builds without Foreword (`make` → export/<name>.pdf). */
  async addMakefile() {
    const ws = this.state.workspace;
    if (!ws) return;
    const fonts = this.state.project.settings.fontPaths ?? [];
    try {
      await ipc.fsWrite('Makefile', makefile(ws.name, ws.entry ?? 'main.typ', fonts, this.typstRoot() || '.'), null);
      await this.refreshFiles();
      await this.openFile('Makefile');
      this.toast('Added a Makefile: run make in the book folder to build the PDF into export/ (needs brew install typst).');
    } catch (e) {
      this.toast(`Couldn't add a Makefile: ${errorMessage(e)}`, 'error');
    }
  }

  // ---- review comments -----------------------------------------------------------------

  /** The turn addressing comments: which, in which conversation, and the files and passages as they were. */
  private reviewTurn: { sessionId: string | null; ids: string[]; before: Record<string, string>; at: Record<string, [number, number]> } | null = null;

  async loadReview() {
    const exists = (this.state.workspace?.files ?? []).includes(REVIEW_FILE);
    const comments = exists ? parseReview(await ipc.fsRead(REVIEW_FILE).then((r) => r.text, () => '')) : [];
    this.store.set((s) => ({ review: { ...s.review, comments } }));
  }

  private async saveReview(comments: ReviewComment[]) {
    this.store.set((s) => ({ review: { ...s.review, comments } }));
    try {
      const hash = await ipc.fsHash(REVIEW_FILE);
      if (hash === null) await ipc.fsMkdir('.foreword').catch(() => {});
      await ipc.fsWrite(REVIEW_FILE, serializeReview(comments), hash);
      if (hash === null) await this.refreshFiles();
    } catch (e) {
      this.toast(`Couldn't save the comments: ${errorMessage(e)}`, 'error');
    }
  }

  private updateComment(id: string, patch: (c: ReviewComment) => ReviewComment) {
    return this.saveReview(this.state.review.comments.map((c) => (c.id === id ? patch(c) : c)));
  }

  /** The current text of a file: its buffer if open, else from disk. */
  private async currentText(path: string): Promise<string | null> {
    const doc = this.docs?.get(path);
    if (doc) return doc.model.getValue();
    return ipc.fsRead(path).then((r) => r.text, () => null);
  }

  /** ⌘P: go to a file. */
  openQuickOpen() {
    if (!this.state.workspace) return;
    this.store.set({ quickOpen: 'files' });
    this.events.emit('quick-open', 'files');
  }

  /** ⇧⌘P: the command palette (the same box, with ">" typed). It works without a book too. */
  openCommandPalette() {
    this.store.set({ quickOpen: 'commands' });
    this.events.emit('quick-open', 'commands');
  }

  closeQuickOpen() {
    this.store.set({ quickOpen: false });
  }

  /** The Review view in the sidebar (shown, if the sidebar was hidden). */
  showReview() {
    this.events.emit('show-explorer');
    this.showSidebar('review');
  }

  /** Comment on the editor's selection: a box to write it in opens under the passage. */
  async addComment() {
    const path = this.state.active;
    const model = this.editor?.getModel();
    const range = this.editor?.getSelection();
    if (!path || !model || !range || range.isEmpty()) return this.toast('Select the passage you want to comment on first.');
    this.store.set((s) => ({ review: { ...s.review, draft: { path, start: model.getOffsetAt(range.getStartPosition()), end: model.getOffsetAt(range.getEndPosition()) } } }));
  }

  cancelComment() {
    this.store.set((s) => ({ review: { ...s.review, draft: null } }));
    this.editor?.focus();
  }

  /** Save the comment being written. */
  async saveDraftComment(text: string) {
    const draft = this.state.review.draft;
    if (!draft || !text.trim()) return this.cancelComment();
    const full = await this.currentText(draft.path);
    if (full == null) return this.cancelComment();
    const comment = makeComment(nextCommentId(this.state.review.comments), draft.path, full, draft.start, draft.end, text);
    this.store.set((s) => ({ review: { ...s.review, draft: null } }));
    await this.saveReview([...this.state.review.comments, comment]);
    this.editor?.focus();
  }

  async editComment(id: string, text: string) {
    if (text.trim()) await this.updateComment(id, (c) => ({ ...c, text: text.trim() }));
  }

  async deleteComment(id: string) {
    await this.saveReview(this.state.review.comments.filter((x) => x.id !== id));
  }

  async setCommentStatus(id: string, status: ReviewComment['status']) {
    await this.updateComment(id, (c) => ({ ...c, status, resolved: status === 'resolved' ? Date.now() : undefined }));
  }

  async clearResolved() {
    await this.saveReview(this.state.review.comments.filter((x) => x.status !== 'resolved'));
  }

  /** Where a comment's passage is now (1-based lines), or null if it has changed. */
  async locateComment(c: ReviewComment): Promise<{ start: number; end: number; line: number } | null> {
    const text = await this.currentText(c.path);
    const at = text == null ? null : locate(text, c);
    return at && text != null ? { start: at[0], end: at[1], line: text.slice(0, at[0]).split('\n').length } : null;
  }

  async goToComment(c: ReviewComment) {
    const at = await this.locateComment(c);
    await this.openAt(c.path, at?.line ?? c.outcome?.change?.line ?? c.line);
    const model = this.editor?.getModel();
    if (at && model) this.editor!.setSelection(monaco.Range.fromPositions(model.getPositionAt(at.start), model.getPositionAt(at.end)));
  }

  /**
   * Ask the assistant to fix comments (one, or every open one). It reports on
   * each; a changed passage waits for the author to keep or undo it.
   */
  async addressComments(ids?: string[]) {
    const open = this.state.review.comments.filter((c) => c.status === 'open' && (!ids || ids.includes(c.id)));
    if (!open.length || this.state.agent.running || this.reviewTurn) return;
    const located = [];
    const before: Record<string, string> = {};
    const at: Record<string, [number, number]> = {};
    for (const comment of open) {
      const where = await this.locateComment(comment);
      located.push({ comment, line: where?.line ?? null });
      if (before[comment.path] === undefined) before[comment.path] = (await this.currentText(comment.path)) ?? '';
      if (where) at[comment.id] = [where.start, where.end];
    }
    if (this.state.agent.mode !== 'write') await this.setMode('write');
    this.events.emit('show-agent-pane');
    this.reviewTurn = { sessionId: null, ids: open.map((c) => c.id), before, at };
    this.store.set((s) => ({ review: { ...s.review, busy: open.map((c) => c.id) } }));
    if (!(await this.send(addressPrompt(located)))) {
      this.reviewTurn = null;
      this.store.set((s) => ({ review: { ...s.review, busy: [] } }));
      return;
    }
    if (this.reviewTurn) this.reviewTurn.sessionId = this.state.agent.sessionId;
  }

  /** The turn addressing comments has ended (shown, or in the background): record what it did with each. */
  private async afterReviewTurn(sessionId = this.state.agent.sessionId) {
    const turn = this.reviewTurn;
    if (!turn || (turn.sessionId && turn.sessionId !== sessionId)) return;
    this.reviewTurn = null;
    this.store.set((s) => ({ review: { ...s.review, busy: [] } }));
    // Its last reply: on screen, or from OpenCode if the conversation isn't shown.
    let reply = '';
    if (sessionId === this.state.agent.sessionId) {
      const last = [...this.state.agent.items].reverse().find((i) => i.kind === 'assistant');
      reply = last?.kind === 'assistant' ? last.text : '';
    } else if (sessionId && this.agent) {
      const items = itemsFromContext(await this.agent.sessionContext(sessionId).catch(() => []));
      const last = [...items].reverse().find((i) => i.kind === 'assistant');
      reply = last?.kind === 'assistant' ? last.text : '';
    }
    const reports = parseReport(reply).filter((r) => turn.ids.includes(r.id));
    const now = Date.now();
    const after: Record<string, string> = {};
    for (const path of Object.keys(turn.before)) after[path] = (await this.currentText(path)) ?? '';
    await this.saveReview(
      this.state.review.comments.map((c) => {
        const r = reports.find((x) => x.id === c.id);
        if (!r) return c;
        if (r.kind === 'declined') return { ...c, outcome: { kind: 'declined', note: r.note, at: now } };
        const span = turn.at[c.id];
        const change = span && turn.before[c.path] !== undefined ? (passageChange(turn.before[c.path], after[c.path], span[0], span[1]) ?? undefined) : undefined;
        return { ...c, status: 'addressed', outcome: { kind: 'changed', note: r.note, at: now, change } };
      }),
    );
    const changed = reports.filter((r) => r.kind === 'changed').length;
    const declined = reports.filter((r) => r.kind === 'declined').length;
    const silent = turn.ids.length - reports.length;
    const parts = [
      changed ? `${changed} changed (check ${changed > 1 ? 'them' : 'it'} in the editor or the Review tab: keep or undo)` : '',
      declined ? `${declined} declined (the reason is on the comment)` : '',
      silent ? `${silent} not reported on, still open` : '',
    ].filter(Boolean);
    this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: `Review: ${parts.join('; ')}.` });
  }

  /** Keep the assistant's change for a comment: it's resolved. */
  async keepChange(id: string) {
    await this.setCommentStatus(id, 'resolved');
  }

  /** Undo the assistant's change for a comment (if the passage is still as it left it), and reopen it. */
  async undoCommentChange(id: string) {
    const c = this.state.review.comments.find((x) => x.id === id);
    const change = c?.outcome?.change;
    if (!c || !change) return;
    const text = await this.currentText(c.path);
    const next = text == null ? null : undoChange(text, change);
    if (next == null) return this.toast('That passage has changed since, so the change can’t be undone here. History has the earlier version.', 'error');
    try {
      await this.editFile(c.path, () => next);
    } catch (e) {
      return this.toast(`Couldn't undo it: ${errorMessage(e)}`, 'error');
    }
    await this.updateComment(id, (x) => ({ ...x, status: 'open', outcome: undefined }));
    this.toast('Undone: the passage is back as it was, and the comment is open again.');
  }

  // ---- cover --------------------------------------------------------------------------

  hasCover() {
    return (this.state.workspace?.files ?? []).includes(COVER_PREVIEW);
  }

  openCoverDialog() {
    if (this.hasCover()) {
      void this.setPreviewTarget('cover');
      void this.openFile(COVER_DESIGN);
      return;
    }
    this.store.set({ coverDialogOpen: true });
    this.syncPreviewVisibility();
  }

  closeCoverDialog() {
    this.store.set({ coverDialogOpen: false });
    this.syncPreviewVisibility();
  }

  /** The book's page size, title and author (from its main file) and page count, for the cover. */
  async bookMeasurements(): Promise<{ width: string | null; height: string | null; pages: number | null; title: string | null; author: string | null }> {
    const ws = this.state.workspace;
    const main = ws?.entry ? await this.currentText(ws.entry) : null;
    const trim = main ? trimFromMain(main) : null;
    return { width: trim?.width ?? null, height: trim?.height ?? null, pages: this.state.bookPages, ...(main ? namesFromMain(main) : { title: null, author: null }) };
  }

  /** Create cover/ from a style, then preview it. Never overwrites: throws if any of its files exist. */
  async designCover(styleId: string, info: Omit<CoverInfo, 'width' | 'height' | 'pages'> & Partial<Pick<CoverInfo, 'width' | 'height' | 'pages'>>) {
    const style = COVER_STYLES.find((s) => s.id === styleId) ?? COVER_STYLES[0];
    const book = await this.bookMeasurements();
    const files = coverFiles(style, { ...info, width: info.width ?? book.width ?? '6in', height: info.height ?? book.height ?? '9in', pages: info.pages ?? book.pages ?? 200 });
    const taken = [];
    for (const f of files) if (await ipc.fsHash(f.path)) taken.push(f.path);
    if (taken.length) throw new Error(`${taken.join(', ')} already exist${taken.length === 1 ? 's' : ''}. Move or rename them first.`);
    try {
      await ipc.fsMkdir(COVER_DIR);
    } catch (e) {
      if (!/already exists/.test(errorMessage(e))) throw e;
    }
    for (const f of files) await ipc.fsWrite(f.path, f.text, null);
    await this.refreshFiles();
    this.closeCoverDialog();
    await this.setPreviewTarget('cover');
    await this.openFile(COVER_DESIGN);
    this.toast('Cover created: edit cover/design.typ; the preview shows it with guides. Switch back with Book in the preview.');
  }

  /** Book ↔ cover in the preview (restarts the preview on the other file). */
  async setPreviewTarget(target: 'book' | 'cover') {
    if (target === this.state.previewTarget) return;
    if (target === 'cover' && !this.hasCover()) return this.openCoverDialog();
    this.store.set({ previewTarget: target });
    await this.restartTypst();
  }

  /** Bring the cover's page size and page count (spine) in line with the book. */
  async updateCoverFromBook(pages?: number) {
    const book = await this.bookMeasurements();
    if (pages) book.pages = pages;
    if (!book.pages) return this.toast('Show the book in the preview once, so Foreword knows its page count.', 'error');
    try {
      await this.editForExport(COVER_SPEC, (text) => updateSpec(text, book));
      this.toast(`Cover updated: ${book.pages} pages${book.width ? `, ${book.width} × ${book.height}` : ''}.`);
    } catch (e) {
      this.toast(`Couldn't update the cover: ${errorMessage(e)}`, 'error');
    }
  }

  // ---- the assistant's marks in the editor ---------------------------------------------

  /** Recent agent versions per file, for the "changed by the assistant" marks. */
  private aiEdits = new Map<string, AiEdit[]>();
  /** Versions never change: their per-file changes are worked out once. */
  private aiEditCache = new Map<string, AiEdit>();

  aiEditsFor(path: string): AiEdit[] {
    return this.aiEdits.get(path) ?? [];
  }

  /** What the assistant has read in the current conversation. */
  private aiReads: AiRead[] = [];

  aiReadsFor(path: string): AiRead[] {
    return this.aiReads.filter((r) => r.path === path);
  }

  private addAiRead(read: AiRead) {
    this.setAiReads([...this.aiReads, read]);
  }

  private setAiReads(reads: AiRead[]) {
    this.aiReads = reads;
    this.store.set((s) => ({ aiMarks: s.aiMarks + 1 }));
  }

  /** Who's answering now: the assistant, its model's name and the effort. */
  private turnBy(): TurnBy {
    const a = this.state.agent;
    const model = a.model ? (a.models.find((m) => m.providerID === a.model!.providerID && m.id === a.model!.id)?.name ?? a.model.id) : null;
    const effort = a.effort && a.effort !== 'default' ? (a.efforts.find((o) => o.value === a.effort)?.name ?? a.effort) : null;
    return { assistant: this.state.settings.assistant, model, effort };
  }

  /** A book file's text as it is now: the editor's, if it's open, else the file's (null if it can't be read). */
  async textOf(path: string): Promise<string | null> {
    const doc = this.docs?.get(path);
    if (doc) return doc.model.getValue();
    try {
      return (await ipc.fsRead(path)).text;
    } catch {
      return null;
    }
  }

  /** From the chat: the text an edit wrote, selected in the editor. */
  async showEdit(path: string, after: string) {
    await this.openFile(path);
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model || this.state.active !== path) return;
    const found = after ? model.findMatches(after, false, false, true, null, false, 2) : [];
    if (found.length !== 1) return this.toast(after ? 'That text has changed since the assistant wrote it.' : 'The assistant only took text out there.');
    editor.setSelection(found[0].range);
    editor.revealRangeInCenterIfOutsideViewport(found[0].range);
    editor.focus();
  }

  /** From the chat: put back what one edit replaced (in the editor, so ⌘Z brings the edit back). */
  async undoEdit(path: string, before: string, after: string) {
    await this.openFile(path);
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model || this.state.active !== path) return;
    const found = after ? model.findMatches(after, false, false, true, null, false, 2) : [];
    if (found.length !== 1) return this.toast(found.length ? 'That text is in the file more than once: undo it there, or in History.' : 'That text has changed since the assistant wrote it: undo it in History.', 'error');
    const range = found[0].range;
    editor.pushUndoStop();
    editor.executeEdits('undo-assistant-edit', [{ range, text: before, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    const start = range.getStartPosition();
    const end = model.getPositionAt(model.getOffsetAt(start) + before.length);
    editor.setSelection(monaco.Range.fromPositions(start, end));
    editor.revealRangeInCenterIfOutsideViewport(monaco.Range.fromPositions(start, end));
    this.toast('Edit undone (⌘Z to bring it back).');
  }

  /** From the chat: open the file with the lines the assistant read selected. */
  async showRead(read: { path: string; from: number; to: number }) {
    await this.openAt(read.path, read.from);
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model || this.state.active !== read.path) return;
    const to = Math.min(read.to, model.getLineCount());
    editor.setSelection(new monaco.Range(read.from, 1, to, model.getLineMaxColumn(to)));
    editor.revealRangeInCenterIfOutsideViewport(new monaco.Range(read.from, 1, to, 1));
  }

  /**
   * From the chat: a place a reply points to (`one.typ:42`), with the cursor
   * there, or its lines selected when it names more than one (`one.typ:42-48`);
   * or the file, as from Files (a picture or PDF in Preview).
   */
  async openRef({ path, line, column, endLine }: SourceRef) {
    if (!line || isPicture(path) || /\.pdf$/i.test(path)) return this.openFile(path);
    if (endLine) return this.showRead({ path, from: line, to: endLine });
    await this.openAt(path, line, column);
  }

  /** The assistant's changes to a file, from History's agent versions (the most recent ones). */
  async loadAiEdits(path: string) {
    if (this.state.history.status !== 'ready') return;
    try {
      const versions = (await ipc.historyList(80, path)).filter((v) => v.kind === 'agent').slice(0, AI_EDIT_VERSIONS);
      const edits: AiEdit[] = [];
      for (const v of versions) {
        const e = await this.aiEditOf(v, path);
        if (e) edits.push(e);
      }
      this.aiEdits.set(path, edits);
      this.store.set((s) => ({ aiMarks: s.aiMarks + 1 }));
    } catch (e) {
      console.warn('assistant marks: history', e);
    }
  }

  /** What one agent version changed in a file (cached; null if it isn't a text file there). */
  private async aiEditOf(v: Version, path: string): Promise<AiEdit | null> {
    const key = `${v.id}\0${path}`;
    let e = this.aiEditCache.get(key);
    if (!e) {
      try {
        const [before, after] = await Promise.all([v.parent ? ipc.historyFile(v.parent, path) : Promise.resolve(null), ipc.historyFile(v.id, path)]);
        if (after === null) return null;
        e = aiEdit(v, before, after);
        this.aiEditCache.set(key, e);
      } catch {
        return null; // not a text file
      }
    }
    return e;
  }

  /**
   * Each conversation's place in History: the version right after its last
   * turn, and the versions its turns made. In memory: after a restart, edits
   * are reported from the next turn on.
   */
  private turnVersions = new Map<string, { head: string; versions: string[] }>();

  private recordTurn(sessionId: string | null, turn: { head: string | null; created: string | null }) {
    if (!sessionId || !turn.head) return;
    const t = this.turnVersions.get(sessionId) ?? { head: turn.head, versions: [] };
    t.head = turn.head;
    if (turn.created) t.versions.push(turn.created);
    this.turnVersions.set(sessionId, t);
  }

  /**
   * The author's changes, since this conversation's last turn, to text the
   * assistant wrote in it ("you wrote A, the author changed it to A′"), for the
   * next message. Between turns only the author changes the files.
   */
  private async authorEditsSince(sessionId: string): Promise<AuthorEdit[]> {
    const turn = this.turnVersions.get(sessionId);
    if (!turn?.versions.length || this.state.history.status !== 'ready') return [];
    try {
      const paths = new Set<string>();
      for (const id of turn.versions) for (const c of await ipc.historyChanges(null, id)) if (c.status !== 'D') paths.add(c.path);
      const out: AuthorEdit[] = [];
      for (const path of paths) {
        const [after, current] = await Promise.all([ipc.historyFile(turn.head, path).catch(() => null), ipc.fsRead(path).then((f) => f.text).catch(() => null)]);
        if (after == null || current == null || after === current) continue;
        const versions = (await ipc.historyList(80, path)).filter((v) => turn.versions.includes(v.id));
        const edits = (await Promise.all(versions.map((v) => this.aiEditOf(v, path)))).filter((e): e is AiEdit => !!e);
        const lines = editMarks(edits, after).filter((m) => !m.removal);
        out.push(...authorEdits(path, after, current, lines));
      }
      return out.slice(0, 6);
    } catch (e) {
      console.warn("author's edits: history", e);
      return [];
    }
  }

  /** After a turn (or once History is up): reload the marks for the open files. */
  private async refreshAiEdits() {
    for (const path of fileTabs(this.state.tabs)) await this.loadAiEdits(path);
  }

  /** "What changed" for a version, by id (from a mark's hover). */
  async showVersionChanges(versionId: string) {
    const version = this.state.history.versions.find((v) => v.id === versionId) ?? (await ipc.historyList(300).catch(() => [])).find((v) => v.id === versionId);
    if (!version) return this.toast('That version is too far back in History to show here.', 'error');
    await this.history.showChanges(version);
  }

  /** History, showing only the versions that changed `path`. */
  async showFileHistory(path: string) {
    this.revealSidebar('history');
    await this.history.setFilter(path);
  }

  // ---- printing ------------------------------------------------------------------------

  openPrint() {
    if (!this.state.workspace?.entry) return this.toast('Open a book first.', 'error');
    this.store.set((s) => ({ print: { ...s.print, open: true } }));
    this.syncPreviewVisibility();
    void this.preparePrint();
  }

  closePrint() {
    this.store.set((s) => ({ print: { ...s.print, open: false } }));
    this.syncPreviewVisibility();
  }

  /**
   * Make the print files (the interior with bleed, through a generated wrapper
   * that includes the book unchanged; and the cover), then check them.
   */
  async preparePrint() {
    const ws = this.state.workspace;
    if (!ws?.entry || this.state.print.status === 'working') return;
    const setPrint = (p: Partial<StudioState['print']>) => this.store.set((s) => ({ print: { ...s.print, ...p } }));
    if (!this.typst.running) {
      setPrint({ status: 'done', files: {}, checks: [{ level: 'bad', text: 'The print files need the Typst preview running. Restart the preview and try again.' }] });
      return;
    }
    setPrint({ status: 'working' });
    const rel = (path: string) => (path.startsWith(ws.root + '/') ? path.slice(ws.root.length + 1) : path);
    const info = (path: string) => ipc.pdfInfo(path).catch((): PdfInfo | null => null);
    const failures: Check[] = [];
    const files: StudioState['print']['files'] = {};
    try {
      const unsaved = (await this.docs?.saveAll()) ?? [];
      if (unsaved.length) throw new Error(`couldn't save ${unsaved.map((f) => f.path).join(', ')}`);

      // The wrapper is Foreword's own file; never write over anything else there.
      const existing = await ipc.fsRead(PRINT_WRAPPER).catch(() => null);
      if (existing && !existing.text.startsWith('// Foreword writes this file for printing')) throw new Error(`${PRINT_WRAPPER} isn't Foreword's; move it away first`);
      const wrapper = printWrapper(ws.entry);
      if (!existing) {
        await ipc.fsMkdir('.foreword').catch(() => {});
        await ipc.fsWrite(PRINT_WRAPPER, wrapper, null);
      }
      await this.editForExport(PRINT_WRAPPER, () => wrapper);

      let interior: PdfInfo | null = null;
      try {
        files.interior = rel(await this.typst.exportPdf(`${ws.root}/${PRINT_WRAPPER}`));
        interior = await info(files.interior);
      } catch (e) {
        failures.push({ level: 'bad', text: `The interior PDF couldn’t be made: ${errorMessage(e)}` });
      }

      let cover: PrintFacts['cover'] = null;
      if (this.hasCover()) {
        const spec = parseCoverSpec((await ipc.fsRead(COVER_SPEC).catch(() => ({ text: '' }))).text);
        let pdf: PdfInfo | null = null;
        try {
          files.cover = rel(await this.typst.exportPdf(`${ws.root}/${COVER_PRINT}`));
          pdf = await info(files.cover);
        } catch (e) {
          failures.push({ level: 'bad', text: `The cover PDF couldn’t be made: ${errorMessage(e)}` });
        }
        cover = { spec, pdf };
      }

      const main = await this.currentText(ws.entry);
      const trim = main ? trimFromMain(main) : null;
      const edgeToEdge: string[] = [];
      for (const f of ws.files) {
        if (!f.endsWith('.typ') || f.startsWith('cover/') || f.startsWith('.foreword/')) continue;
        const text = await this.currentText(f);
        if (text && edgeToEdgeWithoutBleed(text)) edgeToEdge.push(f);
      }
      const facts: PrintFacts = {
        trim: trim && lengthPt(trim.width) && lengthPt(trim.height) ? { width: lengthPt(trim.width)!, height: lengthPt(trim.height)! } : null,
        interior,
        cover,
        // Problems are the previewed document's: the book's only while the book is showing.
        errors: this.state.previewTarget === 'book' ? this.state.problems.errors : 0,
        staleCode: this.code.problems().length,
        edgeToEdge,
      };
      setPrint({ status: 'done', files, facts, checks: [...failures, ...printChecks(facts)] });
      void this.refreshFiles();
    } catch (e) {
      setPrint({ status: 'done', files, checks: [{ level: 'bad', text: `Couldn’t make the print files: ${errorMessage(e)}` }] });
    }
  }

  /** Use the printer's spine width for the cover, then make the print files again. */
  async setCoverSpine(width: string) {
    const length = typstLength(width.trim());
    if (!length) return this.toast(`Not a width: ${width}. Use a length like 15.2mm or 0.6in.`, 'error');
    try {
      await this.editForExport(COVER_SPEC, (text) => updateSpec(text, { spineWidth: length }));
    } catch (e) {
      return this.toast(`Couldn't update the cover: ${errorMessage(e)}`, 'error');
    }
    await this.preparePrint();
  }

  /** A printer's page in the browser (the Rust side only opens known printers' https pages). */
  async openPrinterPage(url: string) {
    try {
      await ipc.openUrl(url);
    } catch (e) {
      this.toast(`Couldn't open ${url}: ${errorMessage(e)}`, 'error');
    }
  }

  /** A fix offered next to a print check. */
  async printAction(action: NonNullable<Check['action']>) {
    if (action === 'design-cover') {
      this.closePrint();
      return this.openCoverDialog();
    }
    if (action === 'update-cover') {
      // The page count of the PDF just made is the one that matters.
      await this.updateCoverFromBook(this.state.print.facts?.interior?.pages);
      return this.preparePrint();
    }
    if (action === 'run-code') {
      await this.code.runAll({ onlyStale: true });
      return this.preparePrint();
    }
    this.closePrint();
    await this.nextProblem();
  }

  /** Export the printable cover (no guides) to the export folder. */
  async exportCover() {
    const ws = this.state.workspace;
    if (!ws || this.state.exporting) return;
    if (!this.typst.running) return this.toast('Export needs the Typst preview running. Restart the preview and try again.', 'error');
    this.store.set({ exporting: true });
    try {
      const failures = (await this.docs?.saveAll()) ?? [];
      if (failures.length) throw new Error(`couldn't save ${failures.map((f) => f.path).join(', ')}`);
      const path = await this.typst.exportPdf(`${ws.root}/${COVER_PRINT}`);
      const rel = path.startsWith(ws.root + '/') ? path.slice(ws.root.length + 1) : path;
      this.toast(`Cover exported to ${tildePath(path)}`);
      void this.refreshFiles();
      return rel;
    } catch (e) {
      this.toast(`Cover export failed: ${errorMessage(e)}`, 'error');
    } finally {
      this.store.set({ exporting: false });
    }
  }

  /** Open a file with the cursor on a line (1-based). */
  async openAt(path: string, line: number, column = 1) {
    await this.openFile(path);
    this.editor?.setPosition({ lineNumber: line, column });
    this.editor?.revealLineInCenter(line);
    this.editor?.focus();
  }

  /**
   * Go to Definition (⌘-click; ⌘ alone underlines): a file the path under the
   * pointer names (fileLinkAt), or where Tinymist says the name there is
   * defined, when that's in the book: a #let in the style file, a label.
   * Built-ins like #figure are defined in Typst itself, and a package's files
   * aren't the book's, so they're not links. A definition's file is opened
   * (without a tab) as it's found, so the editor can show the definition under
   * the pointer.
   */
  async definitionsAt(model: monaco.editor.ITextModel, position: monaco.IPosition): Promise<monaco.languages.LocationLink[]> {
    const docs = this.docs;
    const root = this.state.workspace?.root;
    const doc = docs?.all().find((d) => d.model === model);
    if (!docs || !root || !doc) return [];
    const file = await this.fileLinkAt(doc.path, model, position);
    if (file) return [file];
    if (!doc.lspOpen) return [];
    const found = await this.typst.definition(doc.uri, { line: position.lineNumber - 1, character: position.column - 1 }).catch(() => null);
    const links: monaco.languages.LocationLink[] = [];
    for (const d of definitions(found)) {
      const path = this.asWritten(uriToRelative(d.uri, root));
      const target = path && (await docs.open(path).catch(() => null));
      if (!target) continue;
      // Tinymist's range is the name alone; the editor shows the range's text under the pointer.
      const lines = target.model.getLinesContent();
      const { from, to } = definitionPreview(lines, d.nameRange.start.line);
      const range = new monaco.Range(from + 1, 1, to + 1, (lines[to]?.length ?? 0) + 1);
      const originSelectionRange = d.originRange && toMonacoRange(d.originRange);
      links.push({ uri: target.model.uri, range, targetSelectionRange: toMonacoRange(d.nameRange), originSelectionRange });
    }
    return links;
  }

  /**
   * A path in quotes under the pointer that names a file in the book, found as
   * Typst finds it (from this file's folder, or the Typst root for "/…"):
   * `#include "chapters/one.typ"`, `image("figures/a.png")`, a list of the
   * chapters' files. The link goes to the start of the file, and the editor
   * shows its opening lines under the pointer. A picture or PDF opens in
   * Preview; an empty model stands in for it.
   */
  private async fileLinkAt(from: string, model: monaco.editor.ITextModel, position: monaco.IPosition): Promise<monaco.languages.LocationLink | null> {
    const quoted = quotedAt(model.getLineContent(position.lineNumber), position.column - 1);
    const path = quoted && resolveRef(from, quoted.text, this.typstRoot());
    if (!quoted || !path || path === from || !this.state.workspace?.files.includes(path)) return null;
    const originSelectionRange = new monaco.Range(position.lineNumber, quoted.start + 1, position.lineNumber, quoted.end + 1);
    const start = new monaco.Range(1, 1, 1, 1);
    if (isPicture(path) || /\.pdf$/i.test(path)) {
      const uri = monaco.Uri.from({ scheme: VIEWER_SCHEME, path: `/${path}` });
      if (!monaco.editor.getModel(uri)) monaco.editor.createModel('', 'plaintext', uri);
      return { uri, range: start, originSelectionRange };
    }
    const target = await this.docs?.open(path).catch(() => null);
    if (!target) return null;
    const lines = target.model.getLinesContent();
    const { from: top, to } = filePreview(lines);
    return { uri: target.model.uri, range: new monaco.Range(top + 1, 1, to + 1, lines[to].length + 1), targetSelectionRange: start, originSelectionRange };
  }

  /**
   * A definition in another file (⌘-click): its tab, with the cursor where
   * Monaco puts it. A path goes to the start of its file, so the file opens
   * where it was left, as from Files. False if it isn't the book's.
   */
  async openDefinition(uri: monaco.Uri, at?: monaco.IRange | monaco.IPosition): Promise<boolean> {
    if (uri.scheme === VIEWER_SCHEME) {
      await this.openFile(uri.path.slice(1));
      return true;
    }
    const root = this.state.workspace?.root;
    const path = root ? this.asWritten(uriToRelative(uri.toString(), root)) : null;
    if (!path || !this.docs?.get(path)) return false;
    await this.openFile(path);
    const editor = this.editor;
    if (!editor || this.state.active !== path) return false;
    const range = at && ('startLineNumber' in at ? monaco.Range.lift(at) : monaco.Range.fromPositions(at));
    if (range && !(range.startLineNumber === 1 && range.startColumn === 1)) {
      editor.setSelection(range);
      editor.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Immediate);
    }
    return true;
  }

  /** The book's tasks (conversations): in the assistant pane, with its list of them open. */
  showTasks() {
    this.events.emit('show-agent-pane');
    void this.loadTasks();
    this.events.emit('show-tasks');
  }

  showSidebar(view: StudioState['sidebar']) {
    this.store.set({ sidebar: view });
    if (view === 'history') void this.history.refresh().catch(() => {});
  }

  /** Exported PDFs aren't part of the book's history. */
  private historyExcludes(): string[] {
    const dir = this.state.project.settings.outputDir?.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
    const entry = this.state.workspace?.entry;
    return [...(dir ? [`/${dir}/`] : []), ...(entry ? [`/${entry.replace(/\.typ$/, '')}.pdf`] : [])];
  }

  private async closeWorkspace() {
    if (!this.state.workspace) return;
    this.composerDraft = '';
    this.code.reset();
    this.store.set({ todos: [], review: { comments: [], draft: null, busy: [] }, previewTarget: 'book', previewChapter: null, bookPages: null, compile: { status: 'idle' }, snippetBook: null });
    await this.history.stop();
    this.git.reset();
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = null;
    await Promise.allSettled([this.typst.stop(), this.agent?.stop(), ipc.previewClose()]);
    this.previewOpened = false;
    this.docs?.dispose();
    this.docs = null;
    this.agent = null;
    this.diagnostics.clear();
    this.viewStates.clear();
    this.store.set({
      workspace: null,
      tabs: [],
      active: null,
      viewTab: null,
      guideOpen: false,
      dirty: {},
      conflicts: {},
      questions: {},
      problems: { errors: 0, warnings: 0 },
      compile: { status: 'idle' },
      preview: { status: 'off' },
      agent: initialState.agent,
      project: initialState.project,
      styleGuide: initialState.styleGuide,
    });
    this.styleGuideText = null;
  }

  async refreshFiles() {
    const root = this.state.workspace?.root;
    if (!root) return;
    const files = await ipc.workspaceList();
    // Update only the file list, against the current workspace: other fields (the
    // entry point) may have changed while the listing was in flight.
    this.store.set((s) => (s.workspace?.root === root ? { workspace: { ...s.workspace, files } } : {}));
  }

  private onDiskChange(paths: string[]) {
    for (const p of paths) this.pendingDisk.add(p);
    clearTimeout(this.diskTimer);
    this.diskTimer = window.setTimeout(() => {
      const batch = [...this.pendingDisk];
      this.pendingDisk.clear();
      void this.docs?.diskChanged(batch);
      void this.refreshFiles().then(() => {
        void this.code.scan();
        void this.scanTodos();
        void this.refreshNames(batch);
        if (batch.includes(REVIEW_FILE)) void this.loadReview();
        if (batch.includes(VSCODE_SETTINGS)) void this.loadPeacockColor();
        if (this.state.search.query) this.scheduleSearch(300);
      });
      this.history.scheduleSave();
      this.scheduleGitRefresh();
      if (batch.includes(PROJECT_FILE)) void this.loadProjectSettings({ restartIfNeeded: true });
      if (batch.includes(STYLE_GUIDE_FILE)) void this.loadStyleGuide({ updateSession: true });
    }, 120);
  }

  // ---- tabs / editor ------------------------------------------------------------

  attachEditor(editor: monaco.editor.IStandaloneCodeEditor) {
    this.editor = editor;
    const active = this.state.active && this.docs?.get(this.state.active);
    if (active) editor.setModel(active.model);
  }

  async openFile(path: string, { activate = true } = {}) {
    if (!this.docs) return;
    // PDFs (an exported book, say) open in the PDF viewer, not as text, and pictures in Preview.
    if (/\.pdf$/i.test(path)) return this.openPdf(path);
    if (isPicture(path)) return this.openPicture(path);
    try {
      await this.docs.open(path);
    } catch (e) {
      this.toast(`Can't open ${path}: ${errorMessage(e)}`, 'error');
      return;
    }
    this.store.set((s) => ({ tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path] }));
    if (activate) this.activate(path);
    this.persistTabs();
  }

  /** Bring a tab to the front: a file's, or one that isn't a file. */
  activate(path: string) {
    if (isViewTab(path)) return this.showViewTab(path);
    const doc = this.docs?.get(path);
    if (!doc) return;
    const current = this.state.active;
    if (this.editor && current && current !== path) this.viewStates.set(current, this.editor.saveViewState());
    this.store.set({ active: path, viewTab: null, guideOpen: false });
    if (this.editor) {
      // Back from a tab that isn't a file, the editor is still as it was left.
      if (current !== path || this.editor.getModel() !== doc.model) {
        this.editor.setModel(doc.model);
        const view = this.viewStates.get(path);
        if (view) this.editor.restoreViewState(view);
      }
      this.editor.focus();
    }
    this.persistTabs();
  }

  /** The file the editor holds, without bringing it to the front (null: none). */
  private holdFile(path: string | null) {
    const doc = path ? this.docs?.get(path) : undefined;
    this.store.set({ active: doc ? path : null });
    if (!this.editor) return;
    this.editor.setModel(doc?.model ?? null);
    const view = path && this.viewStates.get(path);
    if (view) this.editor.restoreViewState(view);
  }

  /** Open a tab that isn't a file (or bring it forward). */
  openViewTab(key: string) {
    this.store.set((s) => ({ tabs: s.tabs.includes(key) ? s.tabs : [...s.tabs, key] }));
    this.showViewTab(key);
  }

  private showViewTab(key: string) {
    if (this.state.tabs.includes(key)) this.store.set({ viewTab: key, guideOpen: key === GUIDE_TAB });
  }

  /** Close a tab that isn't a file; if it was in front, the last tab takes its place. */
  private closeViewTab(key: string) {
    const tabs = this.state.tabs.filter((t) => t !== key);
    const front = this.state.viewTab === key;
    this.store.set({ tabs, ...(front ? { viewTab: null } : {}), ...(key === GUIDE_TAB ? { guideOpen: false } : {}) });
    // What it showed goes too.
    if (key === HISTORY_TAB) this.history.closeChanges();
    if (key === HISTORY_FILE_TAB) this.history.closeDiff();
    if (key === GIT_TAB) this.git.closeView();
    const next = tabs[tabs.length - 1];
    if (front && next) this.activate(next);
  }

  /**
   * History's and Source Control's "what changed" each show in a tab, as VS
   * Code's diff editors (and, like its preview tab, the next one shown takes
   * the same tab): opened, or brought to the front, when something new is
   * shown (`fresh`), and closed when it's cleared.
   */
  private followChanges(key: string, shown: unknown, fresh: boolean) {
    if (!shown) {
      if (this.state.tabs.includes(key)) this.closeViewTab(key);
    } else if (fresh || !this.state.tabs.includes(key)) {
      this.openViewTab(key);
    }
  }

  async closeTab(path: string) {
    if (isViewTab(path)) return this.closeViewTab(path);
    if (this.state.dirty[path]) {
      const discard = await ask(`${path} has unsaved changes. Close it and discard them?`, {
        title: 'Unsaved changes',
        kind: 'warning',
        okLabel: 'Discard changes',
        cancelLabel: 'Cancel',
      });
      if (!discard) return;
    }
    const tabs = this.state.tabs.filter((t) => t !== path);
    this.docs?.close(path);
    this.viewStates.delete(path);
    this.closedTabs = [...this.closedTabs.filter((p) => p !== path), path].slice(-30);
    this.store.set((s) => {
      const dirty = { ...s.dirty };
      delete dirty[path];
      return { tabs, dirty };
    });
    if (this.state.active === path) {
      // The editor takes the last file still open. If this tab was in front, the last tab takes its place.
      const front = this.state.viewTab ? null : tabs[tabs.length - 1];
      this.holdFile(fileTabs(tabs).pop() ?? null);
      if (front) this.activate(front);
    }
    this.persistTabs();
  }

  // ---- tabs: VS Code's shortcuts ----------------------------------------------------------

  private lastTabCommand = { id: '', at: 0 };

  /**
   * Run a tab shortcut. A press can arrive as a key event and again as the
   * menu's (⌘W, ⌃⇥…): the same command within 300 ms runs once.
   */
  tabCommand(command: TabCommand) {
    if (!this.state.workspace) return;
    const id = commandId(command);
    const now = performance.now();
    if (this.lastTabCommand.id === id && now - this.lastTabCommand.at < 300) return;
    this.lastTabCommand = { id, at: now };
    // Copy Path and Reveal are for a file in front.
    const active = this.state.viewTab ? null : this.state.active;
    if (typeof command !== 'string') return this.showTabAt(command.at);
    switch (command) {
      case 'close':
        return this.closeActiveTab();
      case 'reopen':
        return void this.reopenClosedTab();
      case 'close-others':
        return void this.closeOtherTabs();
      case 'close-all':
        return void this.closeAllTabs();
      case 'close-saved':
        return void this.closeSavedTabs();
      case 'next':
        return this.showNextTab(1);
      case 'prev':
        return this.showNextTab(-1);
      case 'copy-path':
        if (active) this.copy(this.absolutePath(active), 'Path copied');
        return;
      case 'reveal':
        if (active) void this.reveal(active);
        return;
    }
  }

  /** Recently closed tabs, newest last (Reopen Closed Tab). */
  private closedTabs: string[] = [];

  async reopenClosedTab() {
    const files = this.state.workspace?.files ?? [];
    while (this.closedTabs.length) {
      const path = this.closedTabs.pop()!;
      if (files.includes(path) && !this.state.tabs.includes(path)) return this.openFile(path);
    }
  }

  /** The tab in front: a file's, or one that isn't a file. */
  private get frontTab() {
    return this.state.viewTab ?? this.state.active;
  }

  closeActiveTab() {
    if (this.frontTab) void this.closeTab(this.frontTab);
  }

  async closeAllTabs() {
    await this.closeTabs([...this.state.tabs]);
  }

  async closeOtherTabs(keep = this.frontTab) {
    await this.closeTabs(this.state.tabs.filter((t) => t !== keep));
  }

  /** Close the tabs without unsaved changes. */
  async closeSavedTabs() {
    await this.closeTabs(this.state.tabs.filter((t) => !this.state.dirty[t]));
  }

  /** The next (1) or previous (−1) tab, wrapping round. */
  showNextTab(step: 1 | -1) {
    const { tabs } = this.state;
    if (!tabs.length) return;
    const i = this.frontTab ? tabs.indexOf(this.frontTab) : -1;
    this.activate(tabs[(i + step + tabs.length) % tabs.length]);
  }

  /** The tab at a position (0-based); −1 is the last. */
  showTabAt(index: number) {
    const { tabs } = this.state;
    const path = index < 0 ? tabs[tabs.length - 1] : tabs[index];
    if (path) this.activate(path);
  }

  private persistTabs() {
    const root = this.state.workspace?.root;
    if (root) writeJson(tabsKey(root), { tabs: fileTabs(this.state.tabs), active: this.state.active });
  }

  /** `typing`: the cursor moved with an edit (typing, paste, undo), not a click or an arrow key. */
  setCursor(line: number, column: number, typing = false) {
    this.store.set({ cursor: { line, column } });
    this.schedulePreviewSync(typing);
  }

  // ---- source ↔ preview sync ----------------------------------------------------

  /**
   * Source → preview: once the cursor settles, scroll the preview to it. While
   * typing, after a longer pause and quietly (see `syncPreviewToCursor`).
   */
  private schedulePreviewSync(typing = false) {
    if (performance.now() < this.suppressSyncUntil) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => void this.syncPreviewToCursor({ quiet: typing }), typing ? 400 : 150);
  }

  /**
   * Scroll the preview to the editor's cursor. Tinymist marks each jump with a
   * ripple; a jump it can't map is ignored, so nearby positions are tried in
   * turn until one jumps.
   * - `quiet` (while typing): the cursor's own position only, with the ripple
   *   hidden. Fallbacks while the preview recompiles answered late, so several
   *   jumped, each with a ripple somewhere else.
   * - Otherwise one ripple, and a preview still compiling gets time to answer
   *   before the next position is tried.
   */
  async syncPreviewToCursor({ quiet = false } = {}) {
    const path = this.state.active;
    const model = this.editor?.getModel();
    const pos = this.editor?.getPosition();
    if (!path || !model || !pos) return;
    const lineAt = (n: number) => (n >= 0 && n < model.getLineCount() ? model.getLineContent(n + 1) : null);
    await this.jumpPreview(path, lineAt, pos.lineNumber - 1, pos.column - 1, quiet);
  }

  /**
   * From a diff, as from the editor: once the cursor settles on a line of
   * `text` (one side of a change to `path`; 1-based), the preview shows where
   * that line is in the book now. Lines changed since (an older version, edits
   * not saved) are followed onto the text the preview is drawn from; a line
   * the change took out goes to where it was.
   */
  previewDiffAt(path: string, text: string, line: number, column: number) {
    if (performance.now() < this.suppressSyncUntil || !path.endsWith('.typ')) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(async () => {
      const now = await this.textOf(path);
      if (now === null) return;
      const lines = splitLines(now);
      const at = followLine(splitLines(text), lines, line - 1);
      if (at >= 0) await this.jumpPreview(path, (n) => lines[n] ?? null, at, column - 1);
    }, 150);
  }

  /** Scroll the preview to a position (0-based) in a book file whose lines `lineAt` gives (see `syncPreviewToCursor`). */
  private async jumpPreview(path: string, lineAt: (n: number) => string | null, line: number, character: number, quiet = false) {
    const root = this.state.workspace?.root;
    if (!root || !path.endsWith('.typ') || !this.previewOpened || !this.typst.running) return;
    path = this.asShown(path);
    const run = ++this.syncRun;
    const candidates = jumpCandidates(lineAt, line, character);
    if (quiet) {
      if (!candidates.length) return;
      await ipc
        .previewEval(
          "document.documentElement.classList.add('studio-quiet-jump'); clearTimeout(window.__studioQuiet); window.__studioQuiet = setTimeout(() => document.documentElement.classList.remove('studio-quiet-jump'), 1500);",
        )
        .catch(() => {});
      await this.typst.scrollPreviewTo(`${root}/${path}`, candidates[0].line, candidates[0].character).catch(() => {});
      return;
    }
    // A click or arrow key right after typing: the ripple shows again.
    await ipc.previewEval("clearTimeout(window.__studioQuiet); document.documentElement.classList.remove('studio-quiet-jump');").catch(() => {});
    // Best candidate first; stop at the first the preview actually jumps to (one smooth scroll, one ripple).
    const wait = this.state.compile.status === 'compiling' ? 400 : 120;
    for (const c of candidates.slice(0, 16)) {
      if (run !== this.syncRun) return; // the cursor moved again
      const jumped = this.nextPreviewJump(wait);
      await this.typst.scrollPreviewTo(`${root}/${path}`, c.line, c.character).catch(() => {});
      if (await jumped) return;
    }
  }

  private nextPreviewJump(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (v: boolean) => {
        this.jumpWaiters.delete(onJump);
        clearTimeout(timer);
        resolve(v);
      };
      const onJump = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.jumpWaiters.add(onJump);
    });
  }

  /** Preview → source: a click on rendered content selects the source that produced it. */
  private async revealSource(jump: SourceJump) {
    const root = this.state.workspace?.root;
    if (!root || !jump.start || !jump.end || !jump.filepath.startsWith(root + '/')) return;
    const path = this.asWritten(jump.filepath.slice(root.length + 1))!;
    this.suppressSyncUntil = performance.now() + 600;
    clearTimeout(this.syncTimer);
    await this.openFile(path);
    const editor = this.editor;
    if (!editor || this.state.active !== path) return;
    const range = new monaco.Range(jump.start[0] + 1, jump.start[1] + 1, jump.end[0] + 1, jump.end[1] + 1);
    editor.setSelection(range);
    // Level with the click in the preview, so the eye stays where it was; 10% down without one.
    const click = this.previewClick && performance.now() - this.previewClick.at < 3000 ? this.previewClick : null;
    const body = document.querySelector('.preview-body')?.getBoundingClientRect();
    const clickAt = click && body ? body.top + click.y / this.zoomFactor - editor.getDomNode()!.getBoundingClientRect().top : null;
    const start = range.getStartPosition();
    editor.setScrollTop(jumpScrollTop(editor.getTopForPosition(start.lineNumber, start.column), editor.getOption(monaco.editor.EditorOption.lineHeight), editor.getLayoutInfo().height, clickAt));
    rippleAt(editor, start);
    // The click gave the preview webview keyboard focus; hand it back to the editor.
    await ipc.focusMain().catch(() => {});
    editor.focus();
  }

  /** Save a file (⌘S): a Typst file is formatted first if Format on save is on. */
  async save(path = this.state.active, opts?: { overwrite?: boolean; format?: boolean }) {
    if (!path || !this.docs) return;
    try {
      await this.docs.save(path, { format: this.state.settings.formatOnSave, ...opts });
      this.history.scheduleSave();
    } catch (e) {
      this.toast(`Not saved: ${errorMessage(e)}`, 'error');
    }
  }

  /** Format Document (⇧⌥F): the open Typst file, with typstyle, whether or not Format on save is on. Undoable. */
  async formatDocument(path = this.state.active) {
    if (!path || !this.docs) return;
    if (!path.endsWith('.typ')) return this.toast('Only Typst files can be formatted.', 'error');
    const outcome = await this.docs.format(path);
    if (outcome === 'syntax-error') this.toast(`Not formatted: ${path} has a syntax error. Fix it, then format again.`, 'error');
    else if (outcome === 'timeout') this.toast('Not formatted: Tinymist didn’t answer in time.', 'error');
    else if (outcome === 'unavailable') this.toast('Not formatted: Tinymist isn’t running.', 'error');
  }

  /** Save All (⌥⌘S): every file with unsaved changes. */
  async saveAll() {
    for (const path of Object.keys(this.state.dirty).filter((p) => this.state.dirty[p])) await this.save(path);
  }

  private autoSaveTimer: number | undefined;

  /** Auto save, every few minutes (Settings ▸ Editor): what's unsaved goes to disk, unformatted (as VS Code's), so nothing moves under the cursor. */
  private async autoSave() {
    for (const path of Object.keys(this.state.dirty).filter((p) => this.state.dirty[p])) await this.save(path, { format: false });
  }

  /**
   * An assistant's turn starts: it reads the files as they are now (saved just
   * before). Saves while it works stay protected from a write it makes from an
   * older copy (documents.ts merge), until no assistant is at work.
   */
  private turnStarts() {
    if (!Object.values(this.state.agent.background).some((t) => t.running)) this.docs?.markSeen();
  }

  private turnEnds() {
    if (!this.assistantBusy) this.docs?.markSeen();
  }

  // ---- merge questions: a passage both the author and another program changed ----

  /** "Use theirs": the other version of the passage, in the editor (unsaved, undoable). */
  useTheirs(path: string, id: string) {
    this.docs?.useTheirs(path, id);
  }

  /** "Keep mine": the editor already has it; the question goes. */
  keepMine(path: string, id: string) {
    this.docs?.dismissQuestion(path, id);
  }

  /** Ask the assistant to combine both versions of the passage, in the file. */
  async resolveWithAssistant(path: string, id: string) {
    const q = this.state.questions[path]?.find((x) => x.id === id);
    const range = this.docs?.questionRange(path, id);
    if (!q || !range || !this.editor) return;
    if (this.state.active !== path || this.state.viewTab) await this.openFile(path);
    const model = this.editor.getModel();
    if (!model) return;
    // The passage as it is now (the author's) goes as the selection; theirs is in the message.
    const end = range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? new monaco.Position(range.endLineNumber - 1, model.getLineMaxColumn(range.endLineNumber - 1)) : range.getEndPosition();
    this.editor.setSelection(monaco.Range.fromPositions(range.getStartPosition(), end));
    this.setAgent({ attachments: [] });
    await this.attachSelection({ focus: false });
    this.events.emit('show-agent-pane');
    const sent = await this.send(mergePrompt(path, q.theirs, q.by === ASSISTANT_NAMES[this.state.settings.assistant]));
    if (sent) this.docs?.dismissQuestion(path, id);
  }

  async reloadFromDisk(path: string) {
    try {
      await this.docs?.reload(path);
    } catch (e) {
      this.toast(`Reload failed: ${errorMessage(e)}`, 'error');
    }
  }

  /** Revert File: the file as saved, without the unsaved changes. It's one edit, so ⌘Z brings them back. */
  async revertFile(path = this.state.active) {
    if (!path) return;
    await this.reloadFromDisk(path);
    if (!this.state.dirty[path]) this.toast(`${path.split('/').pop()} is as it was saved. ⌘Z brings your changes back.`);
  }

  /**
   * Reload Window, as VS Code's: the page starts over with the same book (its
   * tabs come back), and Tinymist and the preview start again. Unsaved changes
   * are saved first, if the author agrees.
   */
  async reloadWindow() {
    const dirty = Object.keys(this.state.dirty).filter((p) => this.state.dirty[p]);
    if (dirty.length) {
      const which = dirty.length === 1 ? `${dirty[0]} has` : `${dirty.length} files have`;
      if (!(await this.confirmAction(`${which} unsaved changes. Save, then reload the window?`, 'Unsaved changes', 'Save and Reload'))) return;
      await this.saveAll();
      if (Object.values(this.state.dirty).some(Boolean)) return; // a save failed (and said why)
    } else if (this.state.agent.running && !(await this.confirmAction('The assistant is still working. It carries on, but this window stops following it. Reload anyway?', 'Reload window', 'Reload'))) {
      return;
    }
    // This window's book, not the last one opened in any window (a second window has none of its own).
    try {
      sessionStorage.setItem(RELOAD_KEY, this.state.workspace?.root ?? '');
    } catch {}
    await ipc.previewClose().catch(() => {});
    location.reload();
  }

  private onDiagnostics(uri: string, list: LspDiagnostic[]) {
    const root = this.state.workspace?.root;
    const path = root ? this.asWritten(uriToRelative(uri, root)) : null;
    if (!path) return;
    if (list.length) this.diagnostics.set(path, list);
    else this.diagnostics.delete(path);
    this.docs?.setDiagnostics(path, list);
    let errors = 0;
    let warnings = 0;
    for (const ds of this.diagnostics.values()) {
      for (const d of ds) {
        if (d.severity === 1) errors++;
        else if (d.severity === 2) warnings++;
      }
    }
    this.store.set({ problems: { errors, warnings } });
  }

  // ---- Typst / preview -------------------------------------------------------------

  async startTypst() {
    const ws = this.state.workspace;
    if (!ws) return;
    if (!ws.entry) {
      this.store.set({ preview: { status: 'error', error: 'No .typ entry point found in this folder.' } });
      return;
    }
    this.store.set({ preview: { status: 'starting' } });
    // The cover is its own document: preview it instead of the book on request.
    if (this.state.previewTarget === 'cover' && !ws.files.includes(COVER_PREVIEW)) this.store.set({ previewTarget: 'book' });
    // Or one chapter of the book alone (Settings ▸ General ▸ Preview), when the book has chapters to leave out.
    const chapter =
      this.state.previewTarget === 'book' && this.state.settings.previewScope === 'chapter'
        ? await this.chapterPreviewFile()
            .then(async (c) => c && (await ipc.previewChapterFile(c.path), c))
            .catch(() => null)
        : null;
    this.chapterText = chapter?.text ?? '';
    this.store.set({ previewChapter: chapter?.chapter ?? null });
    if (chapter) writeJson(previewChapterKey(ws.root), chapter.chapter);
    const entry = this.state.previewTarget === 'cover' ? COVER_PREVIEW : (chapter?.path ?? ws.entry);
    try {
      const project = this.state.project.settings;
      const { previewUrl } = await this.typst.start(ws.root, entry, {
        outputPath: outputPathPattern(project, ws.root),
        fontPaths: absoluteFontPaths(project, ws.root),
        // The book's root; the cover's files live outside it, in .foreword/.
        rootPath: this.state.previewTarget === 'cover' ? ws.root : `${ws.root}/${this.typstRoot()}`.replace(/\/$/, ''),
        entryText: chapter?.text,
      });
      this.docs?.syncLsp();
      this.store.set({ preview: { status: 'starting', url: previewUrl } });
      await this.showPreview();
    } catch (e) {
      this.store.set({ preview: { status: 'error', error: errorMessage(e) } });
    }
  }

  /** Called by PreviewPane whenever its on-screen rectangle changes. */
  setPreviewBounds(bounds: Bounds | null) {
    this.previewBounds = bounds;
    this.previewVisible = !!bounds && bounds.width > 4 && bounds.height > 4;
    if (this.previewOpened && bounds && this.previewVisible) void ipc.previewSetBounds(bounds);
    if (!this.previewOpened) void this.showPreview();
    this.syncPreviewVisibility();
  }

  /** A dialog is open: the preview (a native view above the page) must hide, or it's drawn over it. */
  private dialogOpen() {
    const s = this.state;
    // The tour too, but on its preview step, which is about the preview.
    const tour = s.tour !== null && !TOUR_STEPS[s.tour]?.preview;
    return s.settingsOpen || s.updateDialog || s.aboutOpen || s.newBookOpen || !!s.prompt || s.coverDialogOpen || s.styleTemplatesOpen || s.epubOpen || s.print.open || !!s.quickOpen || tour;
  }

  private syncPreviewVisibility() {
    if (!this.previewOpened) return;
    const ok = this.state.preview.status !== 'error';
    void ipc.previewSetVisible(this.previewVisible && ok && !this.dialogOpen());
  }

  private async showPreview() {
    const url = this.state.preview.url;
    if (!url || !this.previewBounds || this.previewOpened || !this.previewVisible) return;
    this.previewOpened = true;
    try {
      await ipc.previewOpen(url, this.previewBounds);
      this.syncPreviewVisibility(); // opening shows the webview; respect an open dialog
      setTimeout(() => {
        if (this.state.preview.status === 'starting') this.store.set((s) => ({ preview: { ...s.preview, status: 'ready' } }));
      }, 3000);
    } catch (e) {
      this.previewOpened = false;
      this.store.set({ preview: { status: 'error', error: errorMessage(e) } });
    }
  }

  /**
   * The preview's page loaded (opened, or again: after macOS took back its
   * memory, Restart Preview, reopening the book): which pages it keeps drawn,
   * and with `place`, where the reader was, to go back to (see PAGES_SCRIPT
   * in preview.rs).
   */
  private configurePreview({ place = false } = {}) {
    if (!this.previewOpened) return;
    const options = { pages: this.state.settings.previewPages, ...(place ? { place: this.previewPlace() } : {}) };
    void ipc.previewEval(`window.__studioPreview && window.__studioPreview.configure(${JSON.stringify(options)})`).catch(() => {});
  }

  /** What the preview shows now, for remembering where it was: the book, the cover, or one chapter. */
  private placeKey(): string {
    const { previewTarget, previewChapter } = this.state;
    return previewTarget === 'book' && previewChapter ? `chapter:${previewChapter}` : previewTarget;
  }

  /** Where the preview was in what it shows now (the book, its cover, a chapter), if it's been shown. */
  private previewPlace(): PreviewPlace | null {
    const root = this.state.workspace?.root;
    return (root && readJson<Record<string, PreviewPlace>>(previewPlaceKey(root))?.[this.placeKey()]) || null;
  }

  private rememberPreviewPlace({ page, offset }: { page?: number; offset?: number }) {
    const root = this.state.workspace?.root;
    if (!root || !Number.isInteger(page) || page! < 0 || typeof offset !== 'number' || !(offset >= 0 && offset <= 1)) return;
    const saved = readJson<Record<string, PreviewPlace>>(previewPlaceKey(root)) ?? {};
    writeJson(previewPlaceKey(root), { ...saved, [this.placeKey()]: { page, offset } });
  }

  async restartTypst() {
    await this.typst.stop().catch(() => {});
    await ipc.previewClose().catch(() => {});
    this.previewOpened = false;
    // The next Tinymist reports its own problems; another file (the cover, a chapter alone) may have none of these.
    for (const path of this.diagnostics.keys()) this.docs?.setDiagnostics(path, []);
    this.diagnostics.clear();
    this.store.set({ problems: { errors: 0, warnings: 0 } });
    await this.startTypst();
  }

  // ---- the chapter preview ------------------------------------------------------------

  /** Whether the preview shows one chapter alone (see chapter-preview.ts), rather than the whole book or the cover. */
  get chapterPreview(): boolean {
    return this.state.previewTarget === 'book' && !!this.state.previewChapter;
  }

  /** What the preview shows: the whole book, the chapter being edited, or the cover. */
  async showInPreview(what: PreviewScope | 'cover') {
    if (what === 'cover') return this.setPreviewTarget('cover');
    const fromCover = this.state.previewTarget === 'cover';
    if (!fromCover && this.state.settings.previewScope === what) return;
    if (fromCover) this.store.set({ previewTarget: 'book' });
    // A change of the setting restarts the preview (updateSettings); from the cover, the same setting needs one too.
    if (this.state.settings.previewScope !== what) this.updateSettings({ previewScope: what });
    else await this.restartTypst();
  }

  /** The main file and the files it includes (however deep), as they are now, open buffers included. */
  private async bookTexts(): Promise<{ main: string; chapters: string[]; read: (path: string) => string | null } | null> {
    const entry = this.state.workspace?.entry;
    const main = entry ? await this.currentText(entry) : null;
    if (!entry || main == null) return null;
    const root = this.typstRoot();
    const texts = new Map<string, string | null>([[entry, main]]);
    const load = async (path: string): Promise<void> => {
      if (texts.has(path)) return;
      texts.set(path, null);
      const text = await this.currentText(path);
      texts.set(path, text);
      if (text) await Promise.all(scanIncludes(text).flatMap(({ spec }) => resolveRef(path, spec, root) ?? []).map(load));
    };
    const chapters = mainIncludes(main, entry, root).map((x) => x.file);
    await Promise.all(chapters.map(load));
    return { main, chapters, read: (path) => texts.get(path) ?? null };
  }

  /**
   * The preview's main file for showing one chapter: the chapter the editor is
   * in, else the one shown now, else the one shown last, else the first. Null
   * if the main file includes fewer than two files: there's nothing to leave out.
   */
  private async chapterPreviewFile(): Promise<{ path: string; text: string; chapter: string } | null> {
    const ws = this.state.workspace;
    const book = await this.bookTexts();
    if (!ws?.entry || !book || book.chapters.length < 2) return null;
    const root = this.typstRoot();
    const active = this.state.active ? chapterOf(this.state.active, book.chapters, book.read, root) : null;
    const first = book.chapters.find((c) => chapterNumber(c, this.state.names) != null) ?? book.chapters[0];
    const chapter = [active, this.state.previewChapter, readJson<string>(previewChapterKey(ws.root)), first].find((c): c is string => !!c && book.chapters.includes(c))!;
    return { path: chapterPreviewPath(ws.entry), chapter, text: chapterPreviewText(book.main, ws.entry, chapter, book.read, root) };
  }

  /**
   * The chapter preview's file is the main file line for line (chapterPreviewText):
   * Tinymist's errors and jumps in it are the main file's (`asWritten`), and a
   * place in the main file is found in it (`asShown`).
   */
  private asWritten<T extends string | null>(path: T): T {
    const entry = this.state.workspace?.entry;
    return (entry && path === chapterPreviewPath(entry) ? entry : path) as T;
  }

  private asShown(path: string): string {
    const entry = this.state.workspace?.entry;
    return entry && path === entry && this.chapterPreview ? chapterPreviewPath(entry) : path;
  }

  /** The text Tinymist has for the chapter preview's main file. */
  private chapterText = '';
  private chapterTimer: number | undefined;
  private chapterRun: Promise<void> = Promise.resolve();

  /**
   * Bring the chapter preview up to date: into the chapter the editor moved to,
   * or after the main file changed, or a file was saved (a chapter's headings
   * and labels count for the others). Tinymist typesets the new text without
   * restarting.
   */
  private scheduleChapterPreview(delay = 400) {
    if (!this.chapterPreview) return;
    clearTimeout(this.chapterTimer);
    this.chapterTimer = window.setTimeout(() => (this.chapterRun = this.chapterRun.then(() => this.refreshChapterPreview())), delay);
  }

  private async refreshChapterPreview() {
    if (!this.chapterPreview || !this.typst.running) return;
    const next = await this.chapterPreviewFile().catch(() => null);
    if (!next || !this.chapterPreview) return;
    if (next.text !== this.chapterText && this.typst.setEntryText(next.text)) this.chapterText = next.text;
    if (next.chapter === this.state.previewChapter) return;
    this.store.set({ previewChapter: next.chapter });
    writeJson(previewChapterKey(this.state.workspace!.root), next.chapter);
    // Into the new chapter once it's typeset, where the editor is.
    await this.nextCompile(10_000);
    void this.syncPreviewToCursor();
  }

  /** Resolves when Tinymist next finishes typesetting (or fails to), or after `timeoutMs`. */
  private nextCompile(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        off();
        clearTimeout(timer);
        resolve();
      };
      const off = this.typst.on('compile', (s) => void (s.status !== 'compiling' && done()));
      const timer = window.setTimeout(done, timeoutMs);
    });
  }

  private publishPerf() {
    const stat = (s: { percentile(p: number): number | null; count: number }): Stat => ({
      p50: s.percentile(50),
      p95: s.percentile(95),
      n: s.count,
    });
    this.store.set({ perf: { input: stat(this.perf.inputToPaint), preview: stat(this.perf.editToPreview) } });
  }

  // ---- agent -----------------------------------------------------------------------

  private setAgent(patch: Partial<StudioState['agent']> | ((a: StudioState['agent']) => Partial<StudioState['agent']>)) {
    const wasRunning = this.state.agent.running;
    this.store.set((s) => ({ agent: { ...s.agent, ...(typeof patch === 'function' ? patch(s.agent) : patch) } }));
    // What the agent changed in this turn becomes one history version.
    if (wasRunning && !this.state.agent.running) {
      // The turn is over: no progress line, and no thinking left open.
      const now = Date.now();
      const turnId = [...this.state.agent.items].reverse().find((it) => it.kind === 'user')?.id;
      this.store.set((s) => ({
        agent: {
          ...s.agent,
          activity: null,
          items: s.agent.items.map((it) =>
            it.kind === 'thinking' && !it.done ? { ...it, done: true, ended: it.ended ?? now } : it.kind === 'tool' && it.status === 'running' ? { ...it, ended: it.ended ?? now } : it.id === turnId && it.kind === 'user' ? { ...it, ended: it.ended ?? now } : it,
          ),
        },
      }));
      void this.afterReviewTurn();
      void this.loadTasks();
      void this.refreshContextSize();
      this.turnEnds();
      const sessionId = this.state.agent.sessionId;
      void this.history.afterAgent(this.turnMessage).then((turn) => {
        this.recordTurn(sessionId, turn);
        if (turnId && this.state.agent.sessionId === sessionId) this.updateItem(turnId, (it) => (it.kind === 'user' ? { ...it, version: turn.created } : it));
        return this.refreshAiEdits();
      });
      void this.afterStyleDraft(sessionId);
      void this.runWhenIdle();
      void this.code.afterAgentTurn();
      if (this.restartAgentWhenIdle) {
        this.restartAgentWhenIdle = false;
        void this.restartAgent();
      }
    }
  }

  /** What the running turn is doing now (keeps the turn's start time). */
  private setActivity(next: Omit<Activity, 'since' | 'phaseSince'>) {
    if (!this.state.agent.running) return;
    this.setAgent((a) => ({ activity: nextActivity(a.activity, next, Date.now()) }));
  }

  /** Start OpenCode again (another program was chosen for it); after the turn, if the assistant is working. */
  async restartAgent() {
    if (this.state.agent.running) {
      this.restartAgentWhenIdle = true;
      this.toast('The assistant will start again when it finishes.');
      return;
    }
    await this.agent?.stop().catch(() => {});
    await this.startAgent();
  }

  /** Start the assistant; `signIn`: with its own sign-in first (an ACP agent's authentication method). */
  async startAgent({ signIn }: { signIn?: string } = {}) {
    const ws = this.state.workspace;
    if (!ws) return;
    // OpenCode, or Claude Code, Gemini CLI, Codex or Antigravity over ACP (Settings ▸ Assistant).
    const which = this.state.settings.assistant;
    // Foreword's own tools (its settings), for every conversation.
    const url = await this.studioToolsUrl();
    const tools = url ? { name: STUDIO_TOOLS, url } : null;
    const agent = which === 'opencode' ? new OpenCodeAdapter(ws.root, tools) : new AcpAdapter(ws.root, which, undefined, signIn, tools);
    // Another program: its own models (the list fills in once it's started).
    const switched = this.agentKind !== which;
    this.agentKind = which;
    this.agent = agent;
    this.setAgent({ status: 'starting', error: undefined, signedOut: false, signingIn: !!signIn, background: {}, ...(switched ? { models: [], model: null } : {}) });
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = agent.subscribe((e) => this.onAgentEvent(e));
    window.clearInterval(this.backgroundPoll);
    this.backgroundPoll = window.setInterval(() => void this.pollBackground(), 4000);
    try {
      await agent.start();
      // Started again meanwhile (a sign-in given up, another assistant chosen): that start says how it went.
      if (this.agent !== agent) return;
      this.setAgent({ status: 'ready', signingIn: false });
      await this.loadModels();
      await this.resumeCarried(agent);
      void this.loadTasks();
      await this.afterToolSwitch();
    } catch (e) {
      if (this.agent !== agent) return;
      this.setAgent({ status: 'error', error: errorMessage(e), signedOut: isSignedOut(e), signingIn: false });
    }
  }

  /**
   * Settings ▸ Assistant: download an assistant's connector (Antigravity's, from
   * Google), once; then, if it's the assistant, start it. Kept here, not in
   * Settings, so closing Settings doesn't lose it.
   */
  async downloadAssistant(kind: AssistantId) {
    if (this.state.assistantDownload && !this.state.assistantDownload.error) return;
    this.store.set({ assistantDownload: { kind, received: 0, total: null } });
    const progress = new Channel<DownloadProgress>();
    progress.onmessage = (p) => this.store.set({ assistantDownload: { kind, ...p } });
    try {
      await ipc.assistantDownload(kind, progress);
      this.store.set({ assistantDownload: null });
      if (this.state.settings.assistant === kind && this.state.workspace) await this.restartAgent();
    } catch (e) {
      this.store.set({ assistantDownload: { kind, error: errorMessage(e) } });
    }
  }

  /**
   * Is there a newer Foreword? From the menu, the dialog opens at once and
   * says (up to date, or what's new). At start, it opens only for a version
   * that wasn't skipped; Settings shows the answer in place.
   */
  async checkForUpdates({ dialog, inPlace = false }: { dialog: boolean; inPlace?: boolean }) {
    if (dialog) this.store.set({ updateDialog: true });
    const update = await ipc.updateCheck().catch((e) => ({ ...(this.state.update as UpdateState), status: 'error' as const, error: errorMessage(e) }));
    this.store.set({ update });
    if (!dialog && !inPlace && update.status === 'available' && update.version !== this.state.settings.skippedUpdate) this.store.set({ updateDialog: true });
  }

  closeUpdateDialog() {
    this.store.set({ updateDialog: false });
  }

  openAbout() {
    this.store.set({ aboutOpen: true });
  }

  closeAbout() {
    this.store.set({ aboutOpen: false });
  }

  /** Download, install and restart, with the dialog showing each step. */
  async installUpdateNow() {
    this.store.set({ updateDialog: true });
    // It restarts the app when it's done; it returns only if something went wrong (the dialog says what).
    await ipc.updateInstall().catch((e) => console.warn('update', e));
  }

  /** Download now and install when the app quits. */
  async installUpdateOnQuit() {
    const version = this.state.update?.version;
    this.closeUpdateDialog();
    this.toast(`Foreword ${version} is downloading, and installs when you quit.`);
    await ipc.updateInstallOnQuit().catch((e) => this.toast(`The update didn’t download: ${errorMessage(e)}`, 'error'));
  }

  async cancelUpdateOnQuit() {
    this.store.set({ update: await ipc.updateCancelOnQuit() });
  }

  /** Don't offer this version at start again (a newer one still is). */
  skipUpdate() {
    const version = this.state.update?.version;
    if (version) this.updateSettings({ skippedUpdate: version });
    this.closeUpdateDialog();
  }

  /** Settings ▸ Assistant: start Antigravity with its sign-in, a Google account, in the browser. */
  async signInWithGoogle() {
    await this.agent?.stop().catch(() => {});
    await this.startAgent({ signIn: GOOGLE_SIGN_IN });
  }

  /**
   * OpenCode fills its model list in lazily after startup (the first response
   * may list only one provider), so keep refreshing until the saved model and
   * a preferred provider show up.
   */
  async loadModels(attempt = 0) {
    if (!this.agent) return;
    try {
      const [models, serverDefault] = await Promise.all([this.agent.listModels(), this.agent.defaultModel()]);
      // The mode's model, if it was picked with this assistant; else the one picked last.
      const setup = this.setupFor(this.state.agent.mode);
      const saved = (setup?.assistant === this.agentKind ? setup.model : null) ?? readJson<ModelRef>(MODEL_KEY);
      // Only an active session pins the model; otherwise re-choose as the list fills in.
      const current = this.state.agent.sessionId ? this.state.agent.model : null;
      const chosen = chooseModel(models, { current, saved, serverDefault });
      this.setAgent({ models, model: chosen ? { providerID: chosen.providerID, id: chosen.id } : null });
      const missingSaved = !!saved && !models.some((m) => m.providerID === saved.providerID && m.id === saved.id);
      const missingPreferred = !models.some((m) => PREFERRED_PROVIDERS.includes(m.providerID));
      if ((missingSaved || missingPreferred) && attempt < 8) setTimeout(() => void this.loadModels(attempt + 1), 1500);
      // The effort too before it's started (a mode's handover sends at once): a new conversation starts at it.
      await this.refreshEfforts();
    } catch (e) {
      this.setAgent({ error: `Couldn't list models: ${errorMessage(e)}` });
    }
  }

  /** The model for this conversation; `remember`: the author's choice, kept for this mode (else the mode's own, brought back). */
  async selectModel(model: ModelRef, { remember = true } = {}) {
    const { sessionId, models } = this.state.agent;
    const info = models.find((m) => m.providerID === model.providerID && m.id === model.id);
    if (info && !info.supportsTools) {
      this.pushItem({
        kind: 'notice',
        id: uid('n'),
        tone: 'error',
        text: `${info.name} doesn't support tool calls, so the agent couldn't read or edit files with it. Pick another model.`,
      });
      return;
    }
    try {
      if (sessionId && this.agent) await this.agent.switchModel(sessionId, model);
      if (remember) {
        writeJson(MODEL_KEY, model);
        const recentModels = pushRecent(this.state.agent.recentModels, model);
        writeJson('studio.recentModels', recentModels);
        this.setAgent({ recentModels });
      }
      this.setAgent({ model: { providerID: model.providerID, id: model.id } });
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Model not changed: ${errorMessage(e)}` });
      remember = false;
    }
    await this.refreshEfforts();
    if (remember) this.rememberSetup();
  }

  /**
   * The model's levels of effort, and the one in use. The author's choice for
   * this model wins when it has that level: set on the conversation, or kept
   * for the next one.
   */
  async refreshEfforts() {
    const agent = this.agent;
    const { model, sessionId } = this.state.agent;
    if (!agent || !model) return this.setAgent({ efforts: [], effort: null });
    const efforts = await agent.efforts(sessionId, model).catch(() => null);
    // Another model, conversation or assistant meanwhile: that one's refresh says.
    const now = this.state.agent;
    if (this.agent !== agent || now.sessionId !== sessionId || !now.model || effortKey(now.model) !== effortKey(model)) return;
    if (!efforts) return this.setAgent({ efforts: [], effort: null });
    // The mode's effort with its model; else the one last chosen for the model.
    const setup = this.setupFor(now.mode);
    const own = setup?.model && setup.effort && effortKey(setup.model) === effortKey(model) ? setup.effort : null;
    const chosen = own ?? readJson<Record<string, string>>(EFFORTS_KEY)?.[effortKey(model)];
    let effort = efforts.current;
    if (chosen && chosen !== effort && efforts.options.some((o) => o.value === chosen)) {
      if (!sessionId) effort = chosen;
      else if (!now.running) effort = await agent.switchEffort(sessionId, model, chosen).then(() => chosen, () => effort);
    }
    this.setAgent({ efforts: efforts.options, effort });
  }

  /** The chat's effort menu, or /effort: from the next message on, and remembered for this model and this mode. */
  async selectEffort(value: string) {
    const { model, sessionId, efforts } = this.state.agent;
    const option = efforts.find((o) => o.value === value);
    if (!model || !option) return false;
    try {
      if (sessionId && this.agent) await this.agent.switchEffort(sessionId, model, value);
      writeJson(EFFORTS_KEY, { ...readJson<Record<string, string>>(EFFORTS_KEY), [effortKey(model)]: value });
      this.setAgent({ effort: value });
      this.rememberSetup();
      return true;
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Effort not changed: ${errorMessage(e)}` });
      return false;
    }
  }

  /**
   * Switch between Write, Ask, Discuss, Options and Figures (applies to the
   * current conversation), and to the assistant, model and effort the mode was
   * last used with, once the author rests on it (mode-setups.ts).
   */
  async setMode(mode: AgentMode) {
    const previous = this.state.agent.mode;
    if (mode === previous) return this.setupReady();
    this.keepSetup(previous);
    this.setAgent({ mode });
    // Another assistant's mode: the chat goes over to it (handOverTo), which takes the mode with it.
    const elsewhere = this.setupFor(mode)?.assistant;
    const leaving = !!elsewhere && elsewhere !== this.state.settings.assistant && !this.assistantBusy;
    if (!leaving && !(await this.modeToSession(previous))) return;
    await this.settleSetup();
  }

  /** The mode, for the conversation shown: what it may do, and its instructions; false if it couldn't (back to `previous`). */
  private async modeToSession(previous: AgentMode | null): Promise<boolean> {
    const { sessionId, mode } = this.state.agent;
    if (!sessionId || !this.agent) return true;
    const config = modeConfig(mode);
    try {
      await this.agent.setPermissions(sessionId, this.state.settings.permissions, config.readOnly, this.authorRules(sessionId));
      if (config.instructions) await this.agent.setInstructions(sessionId, MODE_INSTRUCTIONS_KEY, config.instructions);
      else await this.agent.removeInstructions(sessionId, MODE_INSTRUCTIONS_KEY).catch(() => {});
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: config.notice });
      return true;
    } catch (e) {
      if (previous) this.setAgent({ mode: previous });
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't switch to ${config.label} mode: ${errorMessage(e)}` });
      return false;
    }
  }

  // ---- each mode's assistant, model and effort (mode-setups.ts) ----------------------------

  private setupTimer: number | undefined;
  private setupWaiting: (() => void)[] = [];
  private setupChain: Promise<void> = Promise.resolve();

  /** Every window's (another may have changed one since this one started). */
  private setupFor(mode: AgentMode): ModeSetup | undefined {
    return readModeSetups(readJson(MODE_SETUPS_KEY))[mode];
  }

  private saveSetup(mode: AgentMode, setup: ModeSetup) {
    const modeSetups = { ...readModeSetups(readJson(MODE_SETUPS_KEY)), [mode]: setup };
    writeJson(MODE_SETUPS_KEY, modeSetups);
    this.setAgent({ modeSetups });
  }

  /** What's in use now, as the mode's (the author chose it there); not while an assistant is still starting. */
  private rememberSetup(mode = this.state.agent.mode) {
    const a = this.state.agent;
    if (a.status !== 'ready' || !a.model || this.agentKind !== this.state.settings.assistant) return;
    const model = a.model;
    const effort = a.efforts.find((o) => o.value === a.effort);
    this.saveSetup(mode, {
      assistant: this.state.settings.assistant,
      model,
      effort: a.effort,
      modelName: a.models.find((m) => m.providerID === model.providerID && m.id === model.id)?.name ?? model.id,
      ...(effort ? { effortName: effort.name } : {}),
    });
  }

  /** A mode not used yet keeps what's in use (the mode left, or the one chosen); so does one whose assistant was chosen without a model. */
  private keepSetup(mode: AgentMode) {
    const setup = this.setupFor(mode);
    if (!setup || (!setup.model && setup.assistant === this.state.settings.assistant)) this.rememberSetup(mode);
  }

  /** The mode's setup, once ⇧Tab rests on a mode: it passes through others on the way, each maybe another program to start. */
  private settleSetup(delay = SETUP_DELAY): Promise<void> {
    window.clearTimeout(this.setupTimer);
    return new Promise((resolve) => {
      this.setupWaiting.push(resolve);
      this.setupTimer = window.setTimeout(() => {
        this.setupTimer = undefined;
        const waiting = this.setupWaiting.splice(0);
        this.setupChain = this.setupChain
          .then(() => this.applyModeSetup())
          .catch((e) => console.warn('mode setup', e))
          .finally(() => waiting.forEach((w) => w()));
      }, delay);
    });
  }

  /** Before a message goes: the mode's setup now, if it's waiting. */
  private setupReady(): Promise<void> {
    return this.setupTimer !== undefined ? this.settleSetup(0) : this.setupChain;
  }

  /** The mode's assistant, model and effort, brought back; a mode not used yet keeps what's in use. */
  private async applyModeSetup() {
    const { mode } = this.state.agent;
    const setup = this.setupFor(mode);
    if (!setup) return this.keepSetup(mode);
    if (!this.state.workspace) return;
    if (setup.assistant !== this.state.settings.assistant) return this.handOverTo(setup.assistant);
    // Still starting: it takes the mode's model and effort when it's ready (loadModels).
    const { model, models, status } = this.state.agent;
    if (status !== 'ready') return;
    const want = setup.model;
    const listed = want && models.some((m) => m.supportsTools && m.providerID === want.providerID && m.id === want.id);
    if (want && listed && (want.providerID !== model?.providerID || want.id !== model?.id)) await this.selectModel(want, { remember: false });
    else await this.refreshEfforts();
  }

  /**
   * The chat shown, across assistants: each one's conversation in it, and the
   * last item it has seen. A mode set to another assistant hands the chat over
   * (handOverTo); what that one hasn't seen goes with the next message.
   */
  private thread = new Map<AssistantId, { sessionId: string | null; seen: string | null }>();
  /** The turns after `after` (null: all of them) go with the next message. */
  private handover: { after: string | null } | null = null;
  /** The conversation to open again once the assistant handed over to has started. */
  private resumeOnStart: string | null = null;

  /** A new chat (or another conversation shown): nothing to hand over. */
  private forgetThread() {
    this.thread.clear();
    this.handover = null;
    this.resumeOnStart = null;
  }

  /**
   * The mode is set to another assistant: it takes the chat over. Its own
   * conversation in this chat opens again (or a new one starts once the author
   * writes), and the turns it hasn't seen go with the next message. Not while a
   * conversation is at work: switching would stop it.
   */
  private async handOverTo(next: AssistantId) {
    const from = this.state.settings.assistant;
    const label = modeConfig(this.state.agent.mode).label;
    if (this.assistantBusy) {
      this.toast(`${label} is set to ${ASSISTANT_NAMES[next]}, but ${ASSISTANT_NAMES[from]} is at work, so ${label} stays with it this time.`);
      await this.modeToSession(null);
      return;
    }
    const a = this.state.agent;
    const turns = a.items.some((it) => it.kind === 'user' || it.kind === 'assistant');
    // The one left has seen all of the chat, unless what it was to be given hasn't gone yet.
    this.thread.set(from, { sessionId: a.sessionId, seen: this.handover ? (this.thread.get(from)?.seen ?? null) : (a.items.at(-1)?.id ?? null) });
    const there = this.thread.get(next);
    this.handover = turns ? { after: there?.seen ?? null } : null;
    this.resumeOnStart = there?.sessionId ?? null;
    this.store.set((s) => ({ agent: { ...s.agent, sessionId: null, title: null, contextTokens: null, queued: [], activity: null, stopped: false } }));
    this.setAiReads([]);
    this.updateSettings({ assistant: next }, { restart: false });
    await this.restartAgent();
    const now = this.state.agent;
    if (!turns || this.state.settings.assistant !== next || now.status !== 'ready') return;
    const setup = this.setupFor(now.mode);
    const who = setup ? setupLine(setup) : ASSISTANT_NAMES[next];
    const told = this.handover && chatSoFar(now.items, this.handover.after) !== null;
    this.pushItem({
      kind: 'notice',
      id: uid('n'),
      tone: 'info',
      text: `${label} mode, with ${who}: ${now.sessionId ? 'back in its conversation' : 'a new conversation'}${told ? `, and ${now.sessionId ? 'what was said since' : 'the chat so far'} goes with your next message` : ''}.`,
    });
  }

  /** Started for a mode that handed the chat over: its conversation in the chat, opened again (if it can't be, a new one gets all of the chat). */
  private async resumeCarried(agent: AgentAdapter) {
    const sessionId = this.resumeOnStart;
    this.resumeOnStart = null;
    if (!sessionId) return;
    try {
      const messages = await agent.sessionContext(sessionId);
      if (this.agent !== agent || this.state.agent.sessionId) return;
      const root = this.state.workspace?.root ?? '';
      this.setAgent({ sessionId, title: this.state.agent.tasks.find((t) => t.sessionId === sessionId)?.title ?? null, contextTokens: contextTokens(messages) });
      this.setAiReads(readsFromContext(messages, root));
      // The mode, its permissions and instructions, and its model and effort.
      const config = modeConfig(this.state.agent.mode);
      await agent.setPermissions(sessionId, this.state.settings.permissions, config.readOnly, this.authorRules(sessionId)).catch(() => {});
      await this.applyInstructions(sessionId);
      if (!config.instructions) await agent.removeInstructions(sessionId, MODE_INSTRUCTIONS_KEY).catch(() => {});
      const { model } = this.state.agent;
      if (model) await agent.switchModel(sessionId, model).catch(() => {});
      await this.refreshEfforts();
    } catch (e) {
      console.warn('handover: the conversation did not open again', e);
      if (this.state.agent.items.some((it) => it.kind === 'user' || it.kind === 'assistant')) this.handover = { after: null };
    }
  }

  /**
   * A reply's offer of another mode (its ```mode block), as its two ways on:
   * never the mode the chat is in, nor one the author stayed out of when it was
   * offered earlier in this task.
   */
  private modeSuggestionIn(text: string): { modeSuggestion: ModeSuggestion } | Record<string, never> {
    const offer = modeOffer(text);
    const { mode, items } = this.state.agent;
    const declined = items.some((it) => it.kind === 'assistant' && it.modeSuggestion?.state === 'stayed' && it.modeSuggestion.mode === offer?.mode);
    return offer && offer.mode !== mode && !declined ? { modeSuggestion: { ...offer, from: mode, state: 'pending' } } : {};
  }

  /**
   * One of the two ways on that the assistant offered: `go` to its mode, or
   * staying in the one it was in. Sent as the author's next message, in the
   * assistant's own words, so it knows which it was.
   */
  async takeModeSuggestion(itemId: string, go: boolean) {
    const item = this.state.agent.items.find((it) => it.id === itemId);
    const s = item?.kind === 'assistant' ? item.modeSuggestion : undefined;
    if (!s || s.state !== 'pending' || this.state.agent.running) return;
    const mode = go ? s.mode : s.from;
    await this.setMode(mode);
    if (this.state.agent.mode !== mode) return;
    this.updateItem(itemId, (it) => (it.kind === 'assistant' && it.modeSuggestion ? { ...it, modeSuggestion: { ...it.modeSuggestion, state: go ? 'switched' : 'stayed' } } : it));
    await this.send(modeChoiceMessage(s, go));
  }

  /** "Write it" (Discuss) and "Go ahead" (Ask): back to Write mode, to make what was agreed. */
  async carryOut() {
    const carry = modeConfig(this.state.agent.mode).carryOut;
    if (!carry) return;
    await this.setMode('write');
    if (this.state.agent.mode === 'write') await this.send(carry.prompt);
  }

  newSession() {
    // A conversation still at work carries on in the background.
    this.stashCurrent();
    this.forgetThread();
    this.store.set((s) => ({ agent: { ...s.agent, sessionId: null, title: null, items: [], contextTokens: null, queued: [], running: false, activity: null, stopped: false } }));
    this.setAiReads([]);
    void this.refreshEfforts();
  }

  /** New task (the button, ⌘T, /new, Done): a blank conversation, its message box focused to type in. */
  newTask() {
    this.newSession();
    this.events.emit('show-agent-pane');
    this.events.emit('focus-composer');
  }

  // ---- several conversations at once ----------------------------------------------------

  private backgroundPoll: number | undefined;
  /** The message that started each conversation's current turn (History labels its version with it). */
  private turnMessages = new Map<string, string>();

  private setBackground(sessionId: string, task: BackgroundTask | null) {
    this.store.set((s) => {
      const background = { ...s.agent.background };
      if (task) background[sessionId] = task;
      else delete background[sessionId];
      return { agent: { ...s.agent, background } };
    });
  }

  /** Leaving the shown conversation: if it's at work or waiting on the author, it's tracked in the background. */
  private stashCurrent() {
    const a = this.state.agent;
    if (!a.sessionId) return;
    const attention = a.items.some((i) => i.kind === 'question' && i.state === 'pending')
      ? 'question'
      : a.items.some((i) => i.kind === 'permission' && i.state === 'pending')
        ? 'permission'
        : null;
    if (!a.running && !attention) return;
    this.turnMessages.set(a.sessionId, this.turnMessage);
    this.setBackground(a.sessionId, { running: a.running, attention, unread: false, label: activityText(a.activity), since: a.activity?.since ?? Date.now() });
  }

  /** A conversation's title; until OpenCode has named it, its first words. */
  private taskTitle(sessionId: string) {
    const title = sessionId === this.state.agent.sessionId ? (this.state.agent.title ?? this.state.agent.tasks.find((t) => t.sessionId === sessionId)?.title) : this.state.agent.tasks.find((t) => t.sessionId === sessionId)?.title;
    if (title && title !== 'Untitled task') return title;
    const message = sessionId === this.state.agent.sessionId ? this.turnMessage : this.turnMessages.get(sessionId);
    const first = (message ?? '').replace(/\s+/g, ' ').trim();
    return first ? (first.length > 48 ? `${first.slice(0, 47)}…` : first) : 'A task';
  }

  /** Events of a conversation that isn't shown: its status in the task list, and a note when it needs the author or ends. */
  private backgroundEvent(e: AgentEvent) {
    if (!('sessionId' in e) || !e.sessionId) return;
    const sessionId = e.sessionId;
    const bg = this.state.agent.background[sessionId];
    // Only this book's known conversations.
    if (!bg && !this.state.agent.tasks.some((t) => t.sessionId === sessionId)) return;
    const base: BackgroundTask = bg ?? { running: false, attention: null, unread: false, label: '', since: Date.now() };
    const set = (patch: Partial<BackgroundTask>) => this.setBackground(sessionId, { ...base, ...patch });
    const show = { label: 'Show', run: () => void this.switchTask(sessionId) };
    switch (e.type) {
      case 'turn-started':
        if (!base.running) set({ running: true, unread: false, since: Date.now(), label: 'Thinking…', failed: undefined });
        break;
      case 'step-started':
      case 'reasoning-delta':
        if (base.label !== 'Thinking…') set({ label: 'Thinking…' });
        break;
      case 'text-delta':
        if (base.label !== 'Writing…') set({ label: 'Writing…' });
        break;
      case 'text-ended':
        // Questions in a reply: they wait for the author once the turn ends.
        if (splitQuestions(e.text).fields) {
          set({ attention: 'question' });
          this.toast(`“${this.taskTitle(sessionId)}” needs you: it has a question.`, 'info', [show]);
        }
        break;
      case 'retry-scheduled':
        set({ label: 'The model is busy, trying again' });
        break;
      case 'tool-started':
        this.toolCalls.set(e.callId, { name: e.name });
        set({ label: toolActivity(e.name, undefined, this.state.names) });
        break;
      case 'tool-called': {
        const name = this.toolCalls.get(e.callId)?.name ?? '';
        set({ label: toolActivity(name, e.input, this.state.names) });
        break;
      }
      case 'tool-succeeded':
      case 'tool-failed':
        this.toolCalls.delete(e.callId);
        break;
      case 'permission-asked':
      case 'form-asked': {
        const attention = e.type === 'form-asked' ? 'question' : 'permission';
        set({ attention });
        this.toast(`“${this.taskTitle(sessionId)}” needs you: ${attention === 'question' ? 'it has a question' : 'it asks for permission'}.`, 'info', [show]);
        break;
      }
      case 'permission-replied':
      case 'form-settled':
        if (base.attention) set({ attention: null });
        break;
      case 'session-renamed':
        void this.loadTasks();
        break;
      case 'turn-finished':
        this.backgroundFinished(sessionId, e.outcome === 'failed' ? (e.error ?? 'it stopped with an error') : undefined);
        break;
    }
  }

  /** A background conversation's turn ended: its changes become a History version, and the author hears of it. */
  private backgroundFinished(sessionId: string, failed?: string) {
    const bg = this.state.agent.background[sessionId];
    if (!bg?.running) return;
    this.setBackground(sessionId, { ...bg, running: false, unread: true, label: failed ? `Stopped: ${failed}` : 'Finished', failed });
    this.turnEnds();
    const title = this.taskTitle(sessionId);
    void this.history.afterAgent(this.turnMessages.get(sessionId) || title).then((turn) => {
      this.recordTurn(sessionId, turn);
      return this.refreshAiEdits();
    });
    if (this.reviewTurn?.sessionId === sessionId) void this.afterReviewTurn(sessionId);
    void this.loadTasks();
    this.toast(failed ? `“${title}” stopped: ${failed}` : `“${title}” is done.`, failed ? 'error' : 'info', [{ label: 'Show', run: () => void this.switchTask(sessionId) }]);
  }

  /** Turns can end without an event (a rejected permission): check the running background ones now and then. */
  private async pollBackground() {
    const running = Object.entries(this.state.agent.background).filter(([, b]) => b.running);
    if (!running.length || !this.agent) return;
    const active = await this.agent.activeSessions().catch(() => null);
    if (!active) return;
    for (const [sessionId] of running) if (!active.has(sessionId)) this.backgroundFinished(sessionId);
  }

  // ---- tasks (conversations) ----------------------------------------------------------

  private tasksKey() {
    return `studio.tasks:${this.state.workspace?.root ?? ''}`;
  }

  private taskRecords(): TaskRecord[] {
    return readJson<TaskRecord[]>(this.tasksKey()) ?? [];
  }

  private setTaskRecord(sessionId: string, status: TaskRecord['status']) {
    const records = this.taskRecords().filter((r) => r.sessionId !== sessionId);
    records.push({ sessionId, status, ...(status === 'done' ? { doneAt: Date.now() } : {}) });
    writeJson(this.tasksKey(), records.slice(-500));
  }

  /** The book's conversations from OpenCode, with done/open from this Mac. */
  async loadTasks() {
    if (!this.agent || this.state.agent.status !== 'ready') return;
    try {
      const sessions = await this.agent.listSessions(60);
      const records = new Map(this.taskRecords().map((r) => [r.sessionId, r.status]));
      this.setAgent({
        tasks: sessions.map((s) => ({ sessionId: s.id, title: s.title ? stockTitle(s.title) : 'Untitled task', status: records.get(s.id) ?? 'open', updated: s.updated, tokens: s.tokens })),
      });
    } catch (e) {
      console.warn('tasks: list failed', e);
    }
  }

  /** Open another conversation: its messages come back from OpenCode. One at work carries on in the background. */
  async switchTask(sessionId: string) {
    const agent = this.agent;
    if (!agent || sessionId === this.state.agent.sessionId) return;
    try {
      const [messages, active, permissions] = await Promise.all([
        agent.sessionContext(sessionId),
        agent.activeSessions().catch(() => new Set<string>()),
        agent.pendingPermissions(sessionId).catch(() => []),
      ]);
      this.stashCurrent();
      this.forgetThread();
      const task = this.state.agent.tasks.find((t) => t.sessionId === sessionId);
      const root = this.state.workspace?.root ?? '';
      const bg = this.state.agent.background[sessionId];
      const running = active.has(sessionId);
      const items: ChatItem[] = itemsFromContext(messages, root);
      for (const p of permissions) items.push({ kind: 'permission', id: p.requestId, action: p.action, resources: p.resources, patches: p.patches, state: 'pending' });
      this.turnMessage = this.turnMessages.get(sessionId) ?? '';
      // Not setAgent: leaving a running conversation isn't the end of its turn.
      this.store.set((s) => {
        const background = { ...s.agent.background };
        delete background[sessionId];
        return {
          agent: {
            ...s.agent,
            sessionId,
            title: task?.title ?? null,
            items,
            contextTokens: contextTokens(messages),
            attachments: [],
            queued: [],
            running,
            activity: running ? { phase: 'waiting', since: bg?.since ?? Date.now() } : null,
            background,
            stopped: false,
          },
        };
      });
      this.setAiReads(readsFromContext(messages, root));
      void this.syncQuestions();
      // Bring the conversation in line with the current mode, permissions and instructions.
      const config = modeConfig(this.state.agent.mode);
      await agent.setPermissions(sessionId, this.state.settings.permissions, config.readOnly, this.authorRules(sessionId)).catch(() => {});
      await this.applyInstructions(sessionId);
      void this.refreshEfforts();
    } catch (e) {
      this.toast(`Couldn't open that conversation: ${errorMessage(e)}`, 'error');
    }
  }

  /** How full the current conversation is, from its latest call. */
  private async refreshContextSize() {
    const { sessionId } = this.state.agent;
    if (!sessionId || !this.agent) return;
    try {
      const size = contextTokens(await this.agent.sessionContext(sessionId));
      if (this.state.agent.sessionId === sessionId) this.setAgent({ contextTokens: size });
    } catch {}
  }

  /** "Yes, it's done": mark the task finished, save a named version, start a new one. */
  async finishTask() {
    const { sessionId } = this.state.agent;
    if (!sessionId || this.state.agent.running) return;
    // What's in the editor is part of it (an option picked in Options mode is an unsaved edit): saved first, so the version has it.
    const failures = (await this.docs?.saveAll()) ?? [];
    if (failures.length) {
      this.toast(`Not marked done: couldn't save ${failures.map((f) => `${f.path} (${errorMessage(f.error)})`).join(', ')}`, 'error');
      return;
    }
    const title = this.taskTitle(sessionId);
    this.setTaskRecord(sessionId, 'done');
    await this.history.saveNamed(`Task done: ${title}`).catch(() => {});
    this.newTask();
    await this.loadTasks();
    this.toast(`Done: ${title}. Ready for the next one.`, 'info', [{ label: 'Open it again', run: () => void this.switchTask(sessionId) }]);
  }

  /** "Not yet": hide the buttons on that reply. */
  dismissTaskCheck(itemId: string) {
    this.updateItem(itemId, (it) => (it.kind === 'assistant' ? { ...it, taskCheck: 'dismissed' } : it));
    this.events.emit('focus-composer');
  }

  /** Mark any task done (the shown one goes through `finishTask`, which starts the next). */
  async markTaskDone(sessionId: string) {
    if (sessionId === this.state.agent.sessionId) return this.finishTask();
    const title = this.taskTitle(sessionId);
    this.setTaskRecord(sessionId, 'done');
    await this.history.saveNamed(`Task done: ${title}`).catch(() => {});
    await this.loadTasks();
  }

  reopenTask(sessionId: string) {
    this.setTaskRecord(sessionId, 'open');
    void this.loadTasks();
  }

  /** Summarize the conversation so far, freeing context (OpenCode compaction). */
  async compactTask() {
    const { sessionId } = this.state.agent;
    if (!sessionId || !this.agent || this.state.agent.running) return;
    this.setAgent({ compacting: true });
    try {
      await this.agent.compact(sessionId);
      await new Promise((r) => setTimeout(r, 500));
      await waitIdle(this.agent, sessionId);
      const messages = await this.agent.sessionContext(sessionId);
      const root = this.state.workspace?.root ?? '';
      this.setAgent({ items: itemsFromContext(messages, root), contextTokens: contextTokens(messages) });
      // Reads summarized away are no longer in the conversation.
      this.setAiReads(readsFromContext(messages, root));
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: 'Compacted: the conversation so far was summarized to free up the context window.' });
    } catch (e) {
      this.toast(`Couldn't compact: ${errorMessage(e)}`, 'error');
    } finally {
      this.setAgent({ compacting: false });
    }
  }

  /** ⌘I: attach the selection (or cursor position) to the chat and focus it. */
  async attachSelection({ focus = true } = {}) {
    const path = this.state.active;
    const editor = this.editor;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!path || !model || !selection) {
      if (focus) this.events.emit('focus-composer');
      return;
    }
    const captured = await captureSelection(path, model, selection);
    const label = selectionLabel(captured);
    this.setAgent((a) => ({
      attachments: [...a.attachments.filter((x) => x.label !== label), { id: uid('a'), label, selection: captured }],
    }));
    if (focus) this.events.emit('focus-composer');
  }

  private selectionTimer: number | undefined;
  /** Set while a preview selection is being mapped, so it's labelled as coming from the preview. */
  private selectionFrom: 'editor' | 'preview' = 'editor';

  /** The editor's selection changed: keep the chat's live selection in step (debounced). */
  onEditorSelection() {
    clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(() => void this.captureLiveSelection(), 150);
  }

  private async captureLiveSelection() {
    const path = this.state.active;
    const editor = this.editor;
    const model = editor?.getModel();
    const range = editor?.getSelection();
    const from = this.selectionFrom;
    this.selectionFrom = 'editor';
    if (!path || !model || !range || range.isEmpty()) {
      if (this.state.agent.selection) this.setAgent({ selection: null });
      return;
    }
    const captured = await captureSelection(path, model, range);
    if (!captured.selectedText.trim()) return this.setAgent({ selection: null });
    const label = selectionLabel(captured);
    const key = selectionKey(captured);
    this.setAgent((a) => ({
      selection: { attachment: { id: uid('s'), label, selection: captured }, from },
      selectionDismissed: a.selectionDismissed === key ? key : null,
    }));
  }

  /** Whether the live selection goes with the next message (not dismissed). */
  isSelectionIncluded() {
    const { selection, selectionDismissed } = this.state.agent;
    return !!selection && selectionKey(selection.attachment.selection) !== selectionDismissed;
  }

  /** Leave the current selection out of messages until it changes. */
  dismissSelection() {
    const sel = this.state.agent.selection?.attachment.selection;
    this.setAgent({ selectionDismissed: sel ? selectionKey(sel) : null });
  }

  /** What goes with the next message: pinned attachments, plus the live selection. */
  private outgoingAttachments(): Attachment[] {
    const { attachments, selection, selectionDismissed } = this.state.agent;
    const live =
      selection && selectionKey(selection.attachment.selection) !== selectionDismissed && !attachments.some((a) => a.label === selection.attachment.label) ? [selection.attachment] : [];
    return [...attachments, ...live];
  }

  /** Keep the live selection with the chat, after the editor's selection moves on. */
  keepSelection() {
    const live = this.state.agent.selection;
    if (!live) return;
    const { label, selection } = live.attachment;
    this.setAgent((a) => ({ attachments: [...a.attachments.filter((x) => x.label !== label), { id: uid('a'), label, selection }] }));
  }

  /** Select a passage sent (or to be sent) to the chat, in its file. */
  async revealSelection(sel: SourceSelection) {
    await this.openFile(sel.relativePath);
    const editor = this.editor;
    if (!editor || this.state.active !== sel.relativePath) return;
    const range = new monaco.Range(sel.start.line, sel.start.column, sel.end.line, sel.end.column);
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
    editor.focus();
  }

  removeAttachment(id: string) {
    this.setAgent((a) => ({ attachments: a.attachments.filter((x) => x.id !== id) }));
  }

  async send(text: string, { delivery = 'queue' as Delivery } = {}): Promise<boolean> {
    // The mode just chosen: its assistant, model and effort first.
    await this.setupReady();
    const { agent, docs } = this;
    const state = this.state.agent;
    if (!agent || state.status !== 'ready' || !text.trim()) return false;
    // While a turn runs, the message waits for it (or, "send now", joins it at its next step).
    if (state.running) return this.queueMessage(text, delivery);
    // A reply's questions, passed over: the author wrote something else instead.
    const passedOver = (it: ChatItem): it is QuestionItem => it.kind === 'question' && it.via === 'message' && it.state === 'pending';
    if (state.items.some(passedOver)) this.setAgent((a) => ({ items: a.items.map((it) => (passedOver(it) ? { ...it, state: 'dismissed' as const } : it)) }));
    // Options replace a passage: use the editor's cursor when nothing is selected or attached.
    if (state.mode === 'options' && !this.outgoingAttachments().length) await this.attachSelection({ focus: false });
    const attachments = this.outgoingAttachments();
    // Handed over from another assistant: the turns this one hasn't seen go too.
    const handover = this.handover;
    const earlier = handover ? chatSoFar(state.items, handover.after, this.state.workspace?.root) : null;
    // The message shows at once; saving, the History version and the request follow.
    const userId = uid('u');
    this.setAgent((a) => ({
      running: true,
      stopped: false,
      attachments: [],
      activity: { phase: 'sending', since: Date.now() },
      items: [...a.items, { kind: 'user', id: userId, text, attachments: [...attachments.map((x) => x.label), ...(earlier ? [EARLIER_CHIP] : [])], at: Date.now(), by: this.turnBy() }],
    }));
    const unsend = (why: string) => {
      this.setAgent((a) => ({ running: false, attachments, items: a.items.filter((it) => it.id !== userId) }));
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: why });
      return false;
    };
    // SPEC §4: flush pending editor writes so the agent sees what the user sees.
    const failures = (await docs?.saveAll()) ?? [];
    if (failures.length) return unsend(`Not sent: couldn't save ${failures.map((f) => `${f.path} (${errorMessage(f.error)})`).join(', ')}`);
    this.turnStarts();
    // Sending in a finished task reopens it.
    if (state.sessionId && state.tasks.find((t) => t.sessionId === state.sessionId)?.status === 'done') this.reopenTask(state.sessionId);
    // Everything up to now is its own version, so the agent's changes can be undone separately.
    await this.history.beforeAgent();
    this.turnMessage = messageLine(text);
    this.turnErrors.clear();
    // What the author changed in the assistant's text since its last turn goes with the message.
    const edits = state.sessionId ? await this.authorEditsSince(state.sessionId) : [];
    if (edits.length) this.updateItem(userId, (it) => (it.kind === 'user' ? { ...it, attachments: [...it.attachments, ...edits.map((e) => `${AUTHOR_EDIT_CHIP} ${authorEditLabel(e)}`)] } : it));
    const context: MessageContext[] = [
      ...attachments.map((a) => ({
        selection: a.selection,
        stale: docs?.get(a.selection.relativePath)?.model.getVersionId() !== a.selection.documentVersion,
      })),
      ...(edits.length ? [{ authorEdits: edits }] : []),
      ...(earlier ? [{ earlier }] : []),
    ];
    const target = attachments[0]?.selection;
    this.optionsTurn =
      state.mode === 'options'
        ? { target: target ? { path: target.relativePath, start: target.start, end: target.end, text: target.selectedText } : null }
        : null;
    try {
      let sessionId = this.state.agent.sessionId;
      if (!sessionId) {
        const config = modeConfig(this.state.agent.mode);
        sessionId = await agent.createSession(this.state.agent.model, {
          permissions: this.state.settings.permissions,
          readOnly: config.readOnly,
          rules: this.authorRules(null),
          effort: this.state.agent.effort,
        });
        this.setAgent({ sessionId });
        await this.applyInstructions(sessionId);
        // Where the conversation's effort really is (a model can start somewhere of its own).
        void this.refreshEfforts();
      }
      // A brief that goes with this message, out of sight (the style guide's draft).
      if (this.pendingBrief) await agent.setInstructions(sessionId, this.pendingBrief.key, this.pendingBrief.text);
      await agent.send(sessionId, text, context);
      if (this.handover === handover) this.handover = null;
      return true;
    } catch (e) {
      return unsend(`Message not sent: ${errorMessage(e)}`);
    }
  }

  // ---- questions from the assistant ------------------------------------------------
  // Asked with its question tool (OpenCode's form, an ACP agent's form
  // elicitation), or in a reply (a ```questions block): one panel either way.

  private addQuestion(form: FormRequest) {
    if (this.state.agent.items.some((it) => it.id === form.id)) return;
    this.pushItem({ kind: 'question', id: form.id, title: form.title, fields: form.fields, state: 'pending', callId: form.callId });
    this.setActivity({ phase: 'asking' });
    this.events.emit('show-agent-pane');
  }

  /** A reply that ends with a ```questions block: its panel, answered with a message. */
  private addReplyQuestions(itemId: string, text: string) {
    const { fields } = splitQuestions(text);
    const id = `${itemId}:ask`;
    if (!fields || this.state.agent.items.some((it) => it.id === id)) return;
    this.pushItem({ kind: 'question', id, title: 'Questions', fields, state: 'pending', via: 'message' });
    this.events.emit('show-agent-pane');
  }

  /** Questions still waiting in this conversation (after a switch, or if an event was missed). */
  async syncQuestions() {
    const sessionId = this.state.agent.sessionId;
    if (!this.agent || !sessionId) return;
    try {
      for (const form of await this.agent.pendingForms(sessionId)) if (this.state.agent.sessionId === sessionId) this.addQuestion(form);
    } catch (e) {
      console.warn('questions: list failed', e);
    }
  }

  async answerQuestion(formId: string, answer: FormAnswer) {
    const sessionId = this.state.agent.sessionId;
    if (!this.agent || !sessionId) return;
    const item = this.state.agent.items.find((it) => it.id === formId);
    if (item?.kind !== 'question' || (item.state !== 'pending' && item.state !== 'sending')) return;
    if (item.via === 'message') {
      // Answered first, so sending doesn't count it as passed over.
      this.updateItem(formId, (it) => (it.kind === 'question' ? { ...it, state: 'answered', answer } : it));
      if (!(await this.send(answersMessage(item.fields, answer)))) this.updateItem(formId, (it) => (it.kind === 'question' ? { ...it, state: 'pending' } : it));
      return;
    }
    this.updateItem(formId, (it) => (it.kind === 'question' ? { ...it, state: 'sending', answer } : it));
    try {
      await this.agent.replyForm(sessionId, formId, answer);
      this.updateItem(formId, (it) => (it.kind === 'question' ? { ...it, state: 'answered' } : it));
      this.setActivity({ phase: 'waiting' });
    } catch (e) {
      this.updateItem(formId, (it) => (it.kind === 'question' ? { ...it, state: 'pending' } : it));
      this.toast(`Couldn't send the answer: ${errorMessage(e)}`, 'error');
    }
  }

  /** Skip: the assistant hears that the author didn't answer (a reply's questions just go). */
  async dismissQuestion(formId: string) {
    const sessionId = this.state.agent.sessionId;
    if (!this.agent || !sessionId) return;
    const item = this.state.agent.items.find((it) => it.id === formId);
    if (item?.kind === 'question' && item.via === 'message') {
      this.updateItem(formId, (it) => (it.kind === 'question' ? { ...it, state: 'dismissed' } : it));
      return;
    }
    try {
      await this.agent.cancelForm(sessionId, formId);
      this.updateItem(formId, (it) => (it.kind === 'question' ? { ...it, state: 'dismissed' } : it));
    } catch (e) {
      this.toast(`Couldn't dismiss the question: ${errorMessage(e)}`, 'error');
    }
  }

  // ---- messages sent while the assistant works ---------------------------------------

  /** Inbox ids OpenCode delivered before we knew them (the reply to our request can come after the event). */
  private deliveredEarly = new Set<string>();

  private async queueMessage(text: string, delivery: Delivery): Promise<boolean> {
    const { agent, docs } = this;
    const sessionId = this.state.agent.sessionId;
    if (!agent || !sessionId) return false;
    const attachments = this.outgoingAttachments();
    const tempId = uid('q');
    this.setAgent((a) => ({ attachments: [], queued: [...a.queued, { id: tempId, text, attachments: attachments.map((x) => x.label), delivery, sending: true }] }));
    const failures = (await docs?.saveAll()) ?? [];
    const context = attachments.map((x) => ({
      selection: x.selection,
      stale: docs?.get(x.selection.relativePath)?.model.getVersionId() !== x.selection.documentVersion,
    }));
    try {
      if (failures.length) throw new Error(`couldn't save ${failures.map((f) => f.path).join(', ')}`);
      const inboxId = (await agent.send(sessionId, text, context, delivery)) ?? tempId;
      this.setAgent((a) => ({ queued: a.queued.map((q) => (q.id === tempId ? { ...q, id: inboxId, sending: false } : q)) }));
      if (this.deliveredEarly.delete(inboxId)) this.queuedDelivered(inboxId);
      return true;
    } catch (e) {
      this.setAgent((a) => ({ attachments, queued: a.queued.filter((q) => q.id !== tempId) }));
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Message not sent: ${errorMessage(e)}` });
      return false;
    }
  }

  /** OpenCode handed a message to the conversation: a queued one joins the transcript there. */
  private queuedDelivered(inboxId: string) {
    const q = this.state.agent.queued.find((m) => m.id === inboxId);
    if (!q) {
      // Ours, sent normally (already shown), or a queued one whose request hasn't returned yet.
      this.deliveredEarly.add(inboxId);
      if (this.deliveredEarly.size > 50) this.deliveredEarly.delete(this.deliveredEarly.values().next().value!);
      return;
    }
    this.turnMessage = messageLine(q.text);
    this.setAgent((a) => ({
      queued: a.queued.filter((m) => m.id !== inboxId),
      items: [...a.items, { kind: 'user', id: uid('u'), text: q.text, attachments: q.attachments, at: Date.now(), by: this.turnBy() }],
    }));
  }

  /** "Send now": the running turn reads the message at its next step instead of after it. */
  async steerQueued(id: string) {
    const sessionId = this.state.agent.sessionId;
    if (!this.agent || !sessionId) return;
    this.setAgent((a) => ({ queued: a.queued.map((q) => (q.id === id ? { ...q, delivery: 'steer' } : q)) }));
    try {
      await this.agent.steer(sessionId, id);
    } catch (e) {
      // Already delivered (the turn ended meanwhile) is fine.
      if (this.state.agent.queued.some((q) => q.id === id)) this.toast(`Couldn't send it now: ${errorMessage(e)}`, 'error');
    }
  }

  /** Take a queued message back (to edit it, with `edit`). */
  async unqueue(id: string, { edit = false } = {}) {
    const sessionId = this.state.agent.sessionId;
    const q = this.state.agent.queued.find((m) => m.id === id);
    if (!this.agent || !sessionId || !q) return;
    try {
      await this.agent.unqueue(sessionId, id);
    } catch (e) {
      // It may have been delivered meanwhile: then it's in the conversation.
      if (this.state.agent.queued.some((m) => m.id === id)) this.toast(`Couldn't take it back: ${errorMessage(e)}`, 'error');
      return;
    }
    this.setAgent((a) => ({ queued: a.queued.filter((m) => m.id !== id) }));
    if (edit) this.events.emit('fill-composer', q.text);
  }

  async cancel() {
    const { sessionId } = this.state.agent;
    if (!sessionId || !this.agent) return;
    try {
      await this.agent.cancel(sessionId);
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Stop failed: ${errorMessage(e)}` });
    }
    void this.checkTurnEnded(800);
  }

  /**
   * The author's answer to a permission request. "Always" is the app's to keep
   * (command-rules.ts): `remember` says which command rules and where; without
   * it, what was asked is allowed for the rest of the task. The assistant hears
   * "once" either way, so it keeps no rules of its own.
   */
  async replyPermission(requestId: string, decision: PermissionDecision, remember?: { patterns: string[]; scope: RuleScope; label: string }) {
    const item = this.state.agent.items.find((it) => it.id === requestId);
    if (item?.kind === 'permission' && item.local) return this.answerLocalAsk(requestId, decision !== 'reject');
    const { sessionId } = this.state.agent;
    if (!sessionId || !this.agent) return;
    this.updateItem(requestId, (it) => (it.kind === 'permission' ? { ...it, state: 'sending' } : it));
    try {
      // The rules first, so requests it makes meanwhile meet them.
      const remembered = decision === 'always' && item?.kind === 'permission' ? await this.rememberFor(item, sessionId, remember) : undefined;
      await this.agent.replyPermission(sessionId, requestId, decision);
      this.updateItem(requestId, (it) => (it.kind === 'permission' ? { ...it, state: decision, ...(remembered ? { remembered } : {}) } : it));
      // A yes for one of the settings tools: the tool won't ask again.
      const tool = item?.kind === 'permission' ? (item.action === STUDIO_TOOL_ACTION ? item.resources[0] : studioToolName(item.action)) : null;
      if (tool && decision !== 'reject') this.studioApprovals.set(tool, Date.now());
      if (remembered) {
        const where = remembered.scope === 'task' ? 'Allowed for this task' : `Remembered ${remembered.scope === 'book' ? `in ${this.state.workspace?.name ?? 'this book'}` : 'in every book'}`;
        this.toast(`${where}: ${remembered.label}.`, 'info', [
          { label: 'Undo', run: () => void this.forgetRemembered(requestId) },
          { label: 'Rules', run: () => this.openSettings('permissions') },
        ]);
      }
    } catch (e) {
      this.updateItem(requestId, (it) => (it.kind === 'permission' ? { ...it, state: 'pending' } : it));
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Permission reply failed: ${errorMessage(e)}` });
    }
  }

  /** Session context: this is a Typst book, not a software project (see instructions.ts). */
  private async applyInstructions(sessionId: string) {
    const ws = this.state.workspace;
    if (!ws || !this.agent) return;
    const text = buildInstructions({
      projectName: ws.name,
      entry: ws.entry,
      typFiles: ws.files.filter((f) => f.endsWith('.typ')),
      codeExamples: ws.files.includes(OUTPUTS_FILE) || this.state.code.cells.length > 0,
      root: ws.root,
      assistant: this.agentKind ?? this.state.settings.assistant,
      studioTools: this.agent.hasStudioTools(),
    });
    try {
      await this.agent.setInstructions(sessionId, INSTRUCTIONS_KEY, text);
      if (this.styleGuideText?.trim()) await this.agent.setInstructions(sessionId, STYLE_INSTRUCTIONS_KEY, styleInstructions(this.styleGuideText));
      await this.agent.setInstructions(sessionId, TASK_INSTRUCTIONS_KEY, TASK_INSTRUCTIONS);
      const modeText = modeConfig(this.state.agent.mode).instructions;
      if (modeText) await this.agent.setInstructions(sessionId, MODE_INSTRUCTIONS_KEY, modeText);
    } catch (e) {
      // Still usable without them, but the agent will behave like a coding assistant: say so.
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't set the writing-assistant instructions: ${errorMessage(e)}` });
    }
  }

  private newOptionsState(): { options?: OptionsState } {
    const target = this.optionsTurn?.target ?? null;
    return this.optionsTurn ? { options: { target, original: target, applied: null } } : {};
  }

  /**
   * Put option `index` of an Options reply in place of its passage: an ordinary
   * editor edit (undoable, unsaved until the author saves). Picking another
   * option afterwards replaces the one in use (or the original passage, if the
   * author undid it). If the text moved, it's found again only when that's
   * unambiguous; otherwise nothing changes.
   */
  async applyOption(itemId: string, index: number) {
    const item = this.state.agent.items.find((i) => i.id === itemId);
    if (item?.kind !== 'assistant' || !item.options?.target) return;
    const option = parseOptions(item.text).options[index];
    if (option?.text == null || !option.complete) return;
    const { target, original } = item.options;
    const fail = (why: string) => this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Option ${option.n} not applied: ${why}` });
    try {
      await this.openFile(target.path);
    } catch (e) {
      return fail(errorMessage(e));
    }
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model || this.state.active !== target.path) return fail(`couldn't open ${target.path}.`);
    const locate = (t: OptionTarget | null): monaco.Range | null => {
      if (!t) return null;
      const at = new monaco.Range(t.start.line, t.start.column, t.end.line, t.end.column);
      if (model.validateRange(at).equalsRange(at) && model.getValueInRange(at) === t.text) return at;
      const matches = t.text ? model.findMatches(t.text, false, false, true, null, false, 2) : [];
      return matches.length === 1 ? matches[0].range : null;
    };
    const range = locate(target) ?? locate(original);
    if (!range) return fail('the passage has changed since you asked. Select it and ask again, or copy the option.');
    const start = range.getStartPosition();
    editor.pushUndoStop();
    editor.executeEdits('agent-option', [{ range, text: option.text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    const end = model.getPositionAt(model.getOffsetAt(start) + option.text.length);
    editor.setSelection(monaco.Range.fromPositions(start, end));
    editor.revealRangeInCenterIfOutsideViewport(monaco.Range.fromPositions(start, end));
    const applied: OptionTarget = {
      path: target.path,
      start: { line: start.lineNumber, column: start.column },
      end: { line: end.lineNumber, column: end.column },
      text: model.getValueInRange(monaco.Range.fromPositions(start, end)),
    };
    // Picked one: is that the task done? (Asked once; "Not yet" isn't asked again for this reply.)
    this.updateItem(itemId, (it) =>
      it.kind === 'assistant' && it.options ? { ...it, options: { ...it.options, target: applied, applied: index }, taskCheck: it.taskCheck === 'dismissed' ? 'dismissed' : 'ask' } : it,
    );
  }

  private agentError(message: string) {
    this.turnErrors.add(message);
    const m = this.state.agent.model;
    this.pushItem({
      kind: 'notice',
      id: uid('n'),
      tone: 'error',
      text: m ? `${m.providerID}/${m.id}: ${message}` : message,
      ...(this.state.agent.sessionId ? { action: { label: 'Resume', resume: true } } : {}),
    });
  }

  /**
   * A slash command typed in the message box ("/discuss", "/model sonnet"). True if the
   * text was a command (run, or explained), so it isn't sent to the assistant.
   */
  async runSlash(text: string): Promise<boolean> {
    const cmd = parseSlash(text);
    if (!cmd) return false;
    const say = (t: string, tone: 'info' | 'error' = 'info') => this.pushItem({ kind: 'notice', id: uid('n'), tone, text: t });
    switch (cmd.name) {
      case 'write':
      case 'ask':
      case 'discuss':
      case 'options':
      case 'figures':
        await this.setMode(cmd.name);
        break;
      case 'new':
        this.newTask();
        break;
      case 'done':
        if (!this.state.agent.sessionId) say('There’s no task to finish yet.', 'error');
        else await this.finishTask();
        break;
      case 'compact':
        await this.compactTask();
        break;
      case 'stop':
        await this.cancel();
        break;
      case 'resume':
        if (!this.state.agent.stopped) say('Nothing to resume: the last turn wasn’t stopped.', 'error');
        else await this.resume();
        break;
      case 'model': {
        if (!cmd.arg) {
          say(`Model: ${this.state.agent.model?.id ?? 'the default'}. Switch with /model and part of a name, e.g. /model sonnet.`);
          break;
        }
        const recent = this.state.agent.recentModels;
        const found = this.state.agent.models.filter((m) => m.supportsTools && matchesQuery(m, cmd.arg));
        const pick = found.find((m) => recent.some((r) => r.providerID === m.providerID && r.id === m.id)) ?? found[0];
        if (!pick) say(`No model matches “${cmd.arg}”.`, 'error');
        else {
          await this.selectModel({ providerID: pick.providerID, id: pick.id });
          say(`Model: ${pick.name} (${pick.providerName}).`);
        }
        break;
      }
      case 'effort': {
        const { efforts, effort } = this.state.agent;
        if (!efforts.length) {
          say('This model has no effort setting.', cmd.arg ? 'error' : 'info');
          break;
        }
        const levels = efforts.map((o) => o.name).join(', ');
        if (!cmd.arg) {
          say(`Effort: ${efforts.find((o) => o.value === effort)?.name ?? 'not known'}. Change it with /effort and a level: ${levels}.`);
          break;
        }
        const pick = effortFor(cmd.arg, efforts);
        if (!pick) say(`This model's levels are ${levels}: “${cmd.arg}” isn't one of them.`, 'error');
        else if (await this.selectEffort(pick.value)) say(`Effort: ${pick.name}.`);
        break;
      }
      case 'assistant': {
        const names = ASSISTANTS.map((id) => ASSISTANT_NAMES[id]).join(', ');
        if (!cmd.arg) {
          say(`Assistant: ${ASSISTANT_NAMES[this.state.settings.assistant]}. Switch with /assistant and a name: ${names}.`);
          break;
        }
        const [id, ...more] = assistantsFor(cmd.arg);
        if (!id) say(`No assistant is called “${cmd.arg}”. Try ${names}.`, 'error');
        else if (more.length) say(`“${cmd.arg}” could be ${[id, ...more].map((a) => ASSISTANT_NAMES[a]).join(' or ')}: type more of the name.`, 'error');
        else if (id === this.state.settings.assistant) say(`${ASSISTANT_NAMES[id]} is the assistant already.`);
        else this.switchAssistant(id);
        break;
      }
      case 'permissions': {
        const preset = PERMISSION_WORDS[cmd.arg.toLowerCase()];
        if (!preset) say('Use /permissions ask, /permissions edit or /permissions readonly.', 'error');
        else this.updateSettings({ permissions: PRESETS[preset].permissions });
        break;
      }
      case 'fix':
        if (!this.state.review.comments.some((c) => c.status === 'open')) say('No open review comments to fix.', 'error');
        else await this.addressComments();
        break;
      case 'export':
        await this.exportPdf();
        break;
      case 'pdf':
        await this.openExportedPdf();
        break;
      case 'help':
        say(`Commands: ${SLASH_COMMANDS.map((c) => `/${c.name}${c.arg ? ` <${c.arg}>` : ''} — ${c.description}`).join('; ')}.`);
        break;
      default:
        say(`There’s no /${cmd.name} command. Type / to see them all.`, 'error');
    }
    return true;
  }

  /** Carry on with a stopped or failed turn (with the model chosen now). */
  async resume() {
    const sessionId = this.state.agent.sessionId;
    if (!this.agent || !sessionId || this.state.agent.running) return;
    this.setAgent({ running: true, stopped: false, activity: { phase: 'sending', since: Date.now() } });
    this.turnStarts();
    await this.history.beforeAgent();
    try {
      await this.agent.resume(sessionId);
    } catch (e) {
      this.setAgent({ running: false, stopped: true });
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't resume: ${errorMessage(e)}` });
    }
  }

  private pushItem(item: ChatItem) {
    this.setAgent((a) => ({ items: [...a.items, item] }));
  }

  private updateItem(id: string, fn: (item: ChatItem) => ChatItem) {
    this.setAgent((a) => ({ items: a.items.map((it) => (it.id === id ? fn(it) : it)) }));
  }

  private async checkTurnEnded(delay: number) {
    await new Promise((r) => setTimeout(r, delay));
    const { sessionId, running } = this.state.agent;
    if (!running || !sessionId || !this.agent) return;
    try {
      if (!(await this.agent.isRunning(sessionId))) this.setAgent({ running: false });
    } catch {}
  }

  /** The progress line while a permission question waits, to go back to once it's answered. */
  private activityBeforeAsking: StudioState['agent']['activity'] = null;

  /** Permission requests answered by the app, and ones it gave back to the author (the reply failed). */
  private answered = new Set<string>();

  /**
   * Requests that only look although OpenCode asks ("ls figures 2>/dev/null",
   * "sed -n '205,242p' ch1.typ"; see `onlyLooks`): the app says yes for the
   * author. Background conversations are judged as read-only, whatever their mode.
   */
  private answerForAuthor(e: Extract<AgentEvent, { type: 'permission-asked' }>): boolean {
    const agent = this.agent;
    if (!agent || this.answered.has(e.requestId)) return false;
    const foreground = e.sessionId === this.state.agent.sessionId;
    const rules = sessionRules(this.state.settings.permissions, foreground ? modeConfig(this.state.agent.mode).readOnly : true, this.authorRules(e.sessionId));
    if (!onlyLooks(e.action, e.resources, rules)) return false;
    this.answered.add(e.requestId);
    agent.replyPermission(e.sessionId, e.requestId, 'once').catch(() => this.onAgentEvent(e)); // the author answers after all
    return true;
  }

  private onAgentEvent(e: AgentEvent) {
    if (e.type === 'connection') {
      this.setAgent({ connection: e.status });
      return;
    }
    if (e.type === 'permission-asked' && this.answerForAuthor(e)) return;
    if (e.sessionId !== this.state.agent.sessionId) return this.backgroundEvent(e);
    switch (e.type) {
      case 'turn-started':
        // Also when a queued message starts the next turn by itself.
        this.setAgent((a) => ({ running: true, activity: a.activity ?? { phase: 'waiting', since: Date.now(), phaseSince: Date.now() } }));
        break;
      case 'turn-finished':
        this.setAgent({ running: false, stopped: e.outcome === 'failed' || e.outcome === 'interrupted' });
        if (e.outcome === 'failed') {
          // The same failure usually arrives first as a session error; show it once.
          if (!e.error || !this.turnErrors.has(e.error)) this.agentError(e.error ?? 'The agent stopped with an error.');
        } else if (e.outcome === 'interrupted') {
          this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: 'The request was interrupted.', action: { label: 'Resume', resume: true } });
        }
        break;
      case 'step-started':
        this.setActivity({ phase: 'waiting' });
        break;
      case 'inbox-delivered':
        this.queuedDelivered(e.inboxId);
        break;
      case 'form-asked':
        this.addQuestion(e.form);
        break;
      case 'form-settled':
        this.updateItem(e.formId, (it) =>
          it.kind === 'question' && (it.state === 'pending' || it.state === 'sending')
            ? { ...it, state: e.outcome === 'answered' ? 'answered' : e.outcome === 'withdrawn' ? 'expired' : 'dismissed' }
            : it,
        );
        if (this.state.agent.activity?.phase === 'asking') this.setActivity({ phase: 'waiting' });
        break;
      case 'step-finished':
        void this.checkTurnEnded(1500);
        break;
      case 'reasoning-delta': {
        const id = `${e.messageId}:r${e.ordinal}`;
        const now = Date.now();
        const waited = waitedFor(this.state.agent.activity, now);
        this.setActivity({ phase: 'thinking' });
        this.setAgent((a) => {
          const idx = a.items.findIndex((it) => it.id === id);
          if (idx < 0) return { items: [...a.items, { kind: 'thinking', id, text: e.delta, done: false, started: now, ended: now, waited }] };
          const items = a.items.slice();
          const it = items[idx] as Extract<ChatItem, { kind: 'thinking' }>;
          items[idx] = { ...it, text: it.text + e.delta, ended: now };
          return { items };
        });
        break;
      }
      case 'reasoning-ended': {
        const id = `${e.messageId}:r${e.ordinal}`;
        const now = Date.now();
        // Reasoning that came all at once: how long it took is unknown, the wait before it isn't.
        const waited = waitedFor(this.state.agent.activity, now);
        // Done thinking (that it showed), not yet saying anything else: a new wait.
        const phase = this.state.agent.activity?.phase;
        const shown = e.text.trim() || this.state.agent.items.some((it) => it.id === id);
        if (shown && this.state.agent.running && (phase === 'thinking' || phase === 'waiting')) this.setAgent((a) => ({ activity: a.activity && { ...a.activity, phase: 'waiting', phaseSince: now } }));
        this.setAgent((a) =>
          a.items.some((it) => it.id === id)
            ? { items: a.items.map((it) => (it.id === id && it.kind === 'thinking' ? { ...it, text: e.text || it.text, done: true, ended: it.ended ?? now } : it)) }
            : e.text.trim()
              ? { items: [...a.items, { kind: 'thinking', id, text: e.text, done: true, started: now, ended: now, waited }] }
              : {},
        );
        break;
      }
      case 'retry-scheduled':
        this.setActivity({ phase: 'retrying', retryAt: e.at, attempt: e.attempt, reason: e.message });
        break;
      case 'session-renamed':
        this.setAgent({ title: stockTitle(e.title) });
        break;
      case 'text-delta': {
        const id = `${e.messageId}:${e.ordinal}`;
        if (this.state.agent.activity?.phase !== 'writing') this.setActivity({ phase: 'writing' });
        this.setAgent((a) => {
          const idx = a.items.findIndex((it) => it.id === id);
          if (idx < 0) return { items: [...a.items, { kind: 'assistant', id, text: e.delta, done: false, ...this.newOptionsState() }] };
          const items = a.items.slice();
          const it = items[idx] as Extract<ChatItem, { kind: 'assistant' }>;
          items[idx] = { ...it, text: it.text + e.delta };
          return { items };
        });
        break;
      }
      case 'text-ended': {
        const id = `${e.messageId}:${e.ordinal}`;
        const taskCheck = asksTaskDone(e.text) ? ({ taskCheck: 'ask' } as const) : {};
        const offer = this.modeSuggestionIn(e.text);
        this.setAgent((a) =>
          a.items.some((it) => it.id === id)
            ? { items: a.items.map((it) => (it.id === id ? { ...it, text: e.text, done: true, ...taskCheck, ...offer } : it)) }
            : { items: [...a.items, { kind: 'assistant', id, text: e.text, done: true, ...this.newOptionsState(), ...taskCheck, ...offer }] },
        );
        this.addReplyQuestions(id, e.text);
        break;
      }
      case 'tool-started':
        this.setActivity({ phase: 'tool', label: toolActivity(e.name, undefined) });
        // Should the form event not arrive, look for the question ourselves.
        if (e.name === 'question') window.setTimeout(() => void this.syncQuestions(), 1500);
        this.toolCalls.set(e.callId, { name: e.name });
        this.pushItem({ kind: 'tool', id: e.callId, name: e.name, summary: '', status: 'running', detail: '', started: Date.now() });
        break;
      case 'tool-called':
        this.countRuleUse(e.sessionId, e.callId, e.input);
        this.toolCalls.set(e.callId, { name: this.toolCalls.get(e.callId)?.name ?? '', input: e.input });
        this.setActivity({ phase: 'tool', label: toolActivity(this.toolCalls.get(e.callId)!.name, e.input, this.state.names) });
        this.updateItem(e.callId, (it) => (it.kind === 'tool' ? { ...it, input: e.input, summary: summarizeToolInput(e.input) } : it));
        break;
      case 'tool-succeeded': {
        this.setActivity({ phase: 'waiting' });
        const call = this.toolCalls.get(e.callId);
        this.toolCalls.delete(e.callId);
        const read = call && this.state.workspace ? readOf(this.state.workspace.root, call.name, call.input, e.output) : null;
        if (read) this.addAiRead(read);
        const note = call ? describeTool(call.name, call.input, this.state.names, e.output).note : undefined;
        this.updateItem(e.callId, (it) =>
          it.kind === 'tool'
            ? {
                ...it,
                status: 'done',
                detail: e.output.slice(0, 4000),
                note,
                ended: Date.now(),
                ...(read ? { summary: readLabel(read), read: { path: read.path, from: read.start, to: read.start + read.lines.length - 1 } } : {}),
              }
            : it,
        );
        break;
      }
      case 'tool-failed':
        this.setActivity({ phase: 'waiting' });
        this.updateItem(e.callId, (it) => (it.kind === 'tool' ? { ...it, status: 'failed', detail: e.error, ended: Date.now() } : it));
        break;
      case 'permission-asked':
        this.pushItem({
          kind: 'permission',
          id: e.requestId,
          action: e.action,
          resources: e.resources,
          patches: e.patches,
          state: 'pending',
        });
        // Nothing runs until the author answers: say so, not "Running…".
        this.activityBeforeAsking = this.state.agent.activity;
        this.setActivity({ phase: 'asking' });
        break;
      case 'permission-replied':
        this.updateItem(e.requestId, (it) =>
          // An "always" the app kept reaches the assistant as "once" (OpenCode says so back).
          it.kind === 'permission' && !(it.state === 'always' && e.reply === 'once') ? { ...it, state: (['once', 'always', 'reject'].includes(e.reply) ? e.reply : 'reject') as 'once' } : it,
        );
        if (this.state.agent.activity?.phase === 'asking' && this.activityBeforeAsking) {
          const { since: _since, ...before } = this.activityBeforeAsking;
          this.setActivity(e.reply === 'reject' ? { phase: 'waiting' } : before);
        }
        this.activityBeforeAsking = null;
        break;
      case 'session-error':
        if (!this.turnErrors.has(e.message)) this.agentError(e.message);
        break;
      case 'usage':
        break;
    }
  }

  async refreshViewportInset() {
    try {
      const g = await ipc.nativeGeometry('main');
      // Measured, not assumed: the webview less the page's viewport, in points.
      const [, , width, height] = (g?.webviewFrame ?? []) as number[];
      const inset = (frame: number | undefined, css: number) => {
        const d = (frame ?? 0) - css * this.zoomFactor;
        return d > 2 ? Math.round(d) : 0; // the viewport is whole CSS pixels
      };
      const next = { top: inset(height, innerHeight), left: inset(width, innerWidth) };
      if (next.top !== this.viewportInset.top || next.left !== this.viewportInset.left) {
        this.viewportInset = next;
        window.dispatchEvent(new Event('studio-layout'));
      }
      // As tall as macOS's own title bar (its buttons are centred in that), and
      // clear of the buttons, which full screen takes away.
      const safeTop = (g?.webviewSafeAreaInsets as { top?: number } | undefined)?.top;
      const buttons = g?.windowButtons as [number, number, number, number] | null | undefined;
      this.titleBar = { height: safeTop || 32, buttons: buttons ? buttons[2] + 10 : 0 };
      this.applyTitleBar();
    } catch {
      // Non-macOS or unavailable: no inset, and a native title bar above ours.
    }
  }

  /**
   * The title bar is sized in points whatever the zoom, since macOS draws the
   * window's buttons in it at one size. What's in the bar never gets smaller
   * than at 100% (as in VS Code, whose title bar doesn't zoom out), and grows
   * with the zoom above it: `--titlebar-scale` undoes a zoom below 100%. The
   * status bar uses it too, being in the window's corners, which are in points.
   */
  private applyTitleBar() {
    const style = document.documentElement.style;
    style.setProperty('--titlebar-height', `${this.titleBar.height / this.zoomFactor}px`);
    style.setProperty('--titlebar-buttons', `${this.titleBar.buttons / this.zoomFactor}px`);
    style.setProperty('--titlebar-scale', `${Math.max(1, 1 / this.zoomFactor)}`);
  }

  // ---- settings -------------------------------------------------------------------

  /** Settings, at `page` if given (else the one last shown). */
  openSettings(page?: SettingsPage) {
    this.store.set({ settingsOpen: true, settingsPage: page ?? null });
    this.syncPreviewVisibility();
  }

  closeSettings() {
    this.store.set({ settingsOpen: false });
    this.syncPreviewVisibility();
    this.events.emit('focus-editor');
  }

  /** `restart`: another assistant starts at once, with a new conversation (else its caller starts it). */
  updateSettings(patch: Partial<AppSettings>, { write = true, restart = true } = {}) {
    const before = this.state.settings;
    const settings = { ...before, ...patch };
    saveSettings(settings);
    this.store.set({ settings });
    if (write) this.scheduleConfigWrite();
    if (settings.previewPages !== before.previewPages) this.configurePreview();
    // The whole book or one chapter: another main file for Tinymist.
    if (settings.previewScope !== before.previewScope && this.state.workspace && this.state.previewTarget === 'book') void this.restartTypst();
    if (JSON.stringify(settings.permissions) !== JSON.stringify(before.permissions)) this.permissionsApplied = this.applyPermissions();
    else if (rulesDiffer(settings, before)) this.permissionsApplied = this.applyPermissions({ notice: false });
    if (settings.assistant !== before.assistant && this.state.workspace && restart) {
      // Another program's conversations: start a new one with it.
      this.newSession();
      void this.restartAgent();
    }
  }

  /** A conversation is at work (shown or in the background): switching assistant would stop it. */
  get assistantBusy() {
    const a = this.state.agent;
    return a.running || Object.values(a.background).some((t) => t.running);
  }

  /** Another program as the writing assistant (Settings, the chat's assistant menu, /assistant): a new conversation with it. */
  switchAssistant(id: AssistantId): boolean {
    if (id === this.state.settings.assistant) return true;
    if (this.assistantBusy) {
      this.toast(`The assistant is working: stop it, or let it finish, then switch to ${ASSISTANT_NAMES[id]}.`, 'error');
      return false;
    }
    // This mode's assistant from now on, with its own model until one is picked.
    this.saveSetup(this.state.agent.mode, { assistant: id, model: null, effort: null });
    this.updateSettings({ assistant: id });
    return true;
  }

  /** Settings ▸ Tools: check again which programs are in use (e.g. after installing one). */
  async refreshTools() {
    this.store.set({ tools: await ipc.toolsStatus() });
  }

  /**
   * Settings ▸ Tools: run this program for a tool ('' to find it automatically).
   * The Rust side reads the path from the settings file, so that's written at
   * once; then whatever runs the tool starts again with it, in the background
   * and one restart at a time.
   */
  async setToolPath(tool: ToolName, path: string) {
    const p = path.trim();
    if (p === (this.state.settings.toolPaths[tool] ?? '')) return;
    if (this.state.configFile?.error) {
      this.toast('The settings file has a mistake (see Settings ▸ General), so this can’t be saved until it’s fixed.', 'error');
      return;
    }
    const { [tool]: _, ...others } = this.state.settings.toolPaths;
    this.updateSettings({ toolPaths: p ? { ...others, [tool]: p } : others }, { write: false });
    window.clearTimeout(this.configTimer);
    await this.writeConfig();
    await this.refreshTools();
    if (!this.state.workspace) return;
    if (tool === 'git') {
      if (this.state.history.status === 'unavailable') void this.history.start(this.historyExcludes());
      this.scheduleGitRefresh(0);
      return;
    }
    const restart = tool === 'tinymist' ? () => this.restartTypst() : () => this.restartAgent();
    this.toolRestarts = this.toolRestarts.then(restart).catch(() => {});
  }
  private toolRestarts = Promise.resolve();

  // ---- the author's rules (command-rules.ts) ---------------------------------------------

  /** The author's command rules where they apply: every book's, this book's, and the task's (`sessionId`). */
  commandRules(sessionId: string | null = this.state.agent.sessionId): CommandRule[] {
    const app = this.state.settings;
    const book = this.state.project.settings;
    const task = sessionId ? this.state.taskRules[sessionId] : undefined;
    const rules = (patterns: string[] | undefined, effect: RuleEffect, scope: RuleScope) => (patterns ?? []).map((pattern): CommandRule => ({ pattern, effect, scope }));
    return [
      ...rules(app.alwaysAllow, 'allow', 'all'),
      ...rules(book.alwaysAllow, 'allow', 'book'),
      ...rules(task?.alwaysAllow, 'allow', 'task'),
      ...rules(app.neverAllow, 'deny', 'all'),
      ...rules(book.neverAllow, 'deny', 'book'),
    ];
  }

  /** A conversation's rules on top of the kinds of action: the author's commands, and what they allowed for the task. */
  private authorRules(sessionId: string | null): PermissionRule[] {
    return [...commandPermissionRules(this.commandRules(sessionId)), ...(sessionId ? (this.state.taskRules[sessionId]?.actions ?? []) : [])];
  }

  /** When a rule was made and how often it's been used. */
  ruleStat(r: CommandRule, sessionId = this.state.agent.sessionId): RuleStat | undefined {
    return this.state.ruleStats[this.ruleStatKey(r, sessionId)];
  }

  private ruleStatKey(r: CommandRule, sessionId: string | null) {
    return ruleKey(r, r.scope === 'book' ? (this.state.workspace?.root ?? '') : r.scope === 'task' ? (sessionId ?? '') : '');
  }

  private setRuleStats(update: (stats: Record<string, RuleStat>) => void) {
    const ruleStats = { ...this.state.ruleStats };
    update(ruleStats);
    this.store.set({ ruleStats });
    try {
      localStorage.setItem(RULE_STATS_KEY, JSON.stringify(ruleStats));
    } catch {
      // Counts are a nicety.
    }
  }

  private updateTaskRules(sessionId: string, update: (t: TaskRules) => TaskRules) {
    this.store.set((s) => ({ taskRules: { ...s.taskRules, [sessionId]: update(s.taskRules[sessionId] ?? { alwaysAllow: [], actions: [] }) } }));
  }

  /** The conversation's rules, brought up to date (the last change's, awaited by whoever made it). */
  private permissionsApplied: Promise<void> = Promise.resolve();

  /**
   * Let commands run without asking (`allow`) or never (`deny`): for this task,
   * in this book (its .foreword.json) or in every book (the settings file).
   * The conversation has them at once.
   */
  async rememberCommands(patterns: string[], scope: RuleScope, effect: RuleEffect = 'allow') {
    const key = effect === 'allow' ? 'alwaysAllow' : 'neverAllow';
    const sessionId = this.state.agent.sessionId;
    const add = (list: string[] | undefined) => [...new Set([...(list ?? []), ...patterns])];
    if (scope === 'task') {
      if (!sessionId || effect !== 'allow') throw new Error('A task’s rules are for commands to allow, in a conversation.');
      this.updateTaskRules(sessionId, (t) => ({ ...t, alwaysAllow: add(t.alwaysAllow) }));
      this.permissionsApplied = this.applyPermissions({ notice: false });
    } else if (scope === 'book') {
      const errors = await this.updateProjectSettings({ [key]: add(this.state.project.settings[key]) });
      if (errors.length) throw new Error(errors.join(' '));
    } else this.updateSettings({ [key]: add(this.state.settings[key]) });
    const now = Date.now();
    this.setRuleStats((stats) => {
      for (const pattern of patterns) {
        const k = this.ruleStatKey({ pattern, effect, scope }, sessionId);
        stats[k] ??= { created: now, uses: 0, last: 0 };
      }
    });
    await this.permissionsApplied;
  }

  /** Take rules back; asking again from the next request. */
  async forgetCommands(patterns: string[], scope: RuleScope, effect: RuleEffect = 'allow') {
    const key = effect === 'allow' ? 'alwaysAllow' : 'neverAllow';
    const sessionId = this.state.agent.sessionId;
    const without = (list: string[] | undefined) => (list ?? []).filter((p) => !patterns.includes(p));
    if (scope === 'task') {
      if (sessionId) this.updateTaskRules(sessionId, (t) => ({ ...t, alwaysAllow: without(t.alwaysAllow) }));
      this.permissionsApplied = this.applyPermissions({ notice: false });
    } else if (scope === 'book') {
      const errors = await this.updateProjectSettings({ [key]: without(this.state.project.settings[key]) });
      if (errors.length) throw new Error(errors.join(' '));
    } else this.updateSettings({ [key]: without(this.state.settings[key]) });
    await this.permissionsApplied;
  }

  /** What "always" keeps for a request: the command rules the card chose, or else this kind of request for the task. */
  private async rememberFor(item: Extract<ChatItem, { kind: 'permission' }>, sessionId: string, remember?: { patterns: string[]; scope: RuleScope; label: string }): Promise<Remembered> {
    if (remember?.patterns.length) {
      await this.rememberCommands(remember.patterns, remember.scope);
      return { scope: remember.scope, label: remember.label, patterns: remember.patterns, actions: [] };
    }
    const actions = taskAllowance(item.action, item.resources);
    this.updateTaskRules(sessionId, (t) => ({ ...t, actions: [...t.actions, ...actions] }));
    this.permissionsApplied = this.applyPermissions({ notice: false });
    await this.permissionsApplied;
    return { scope: 'task', label: remember?.label ?? taskAllowanceWords(item.action, item.resources), patterns: [], actions };
  }

  /** Take back what an "always" kept (`restore`: put it back). */
  async forgetRemembered(itemId: string, restore = false) {
    const item = this.state.agent.items.find((it) => it.id === itemId);
    const r = item?.kind === 'permission' ? item.remembered : undefined;
    const { sessionId } = this.state.agent;
    if (!r || !!r.removed === !restore) return;
    try {
      if (r.patterns.length) await (restore ? this.rememberCommands(r.patterns, r.scope) : this.forgetCommands(r.patterns, r.scope));
      if (r.actions.length && sessionId) {
        const same = (a: PermissionRule) => r.actions.some((b) => JSON.stringify(a) === JSON.stringify(b));
        this.updateTaskRules(sessionId, (t) => ({ ...t, actions: restore ? [...t.actions, ...r.actions] : t.actions.filter((a) => !same(a)) }));
        this.permissionsApplied = this.applyPermissions({ notice: false });
        await this.permissionsApplied;
      }
      this.updateItem(itemId, (it) => (it.kind === 'permission' && it.remembered ? { ...it, remembered: { ...it.remembered, removed: !restore } } : it));
    } catch (e) {
      this.toast(`Couldn't change the rule: ${errorMessage(e)}`, 'error');
    }
  }

  /** Requests still waiting that the author's rules now answer (the same command, asked again meanwhile). */
  private answerCovered() {
    const { sessionId } = this.state.agent;
    if (!sessionId) return;
    const rules = sessionRules(this.state.settings.permissions, modeConfig(this.state.agent.mode).readOnly, this.authorRules(sessionId));
    for (const it of this.state.agent.items) {
      if (it.kind !== 'permission' || it.state !== 'pending' || it.local || decide(it.action, it.resources, rules) !== 'allow') continue;
      this.updateItem(it.id, (x) => (x.kind === 'permission' ? { ...x, byRule: true } : x));
      void this.replyPermission(it.id, 'once');
    }
  }

  /**
   * The author's rules that let a command run without asking: those that cover
   * it, made before it ran (`at`), where the kinds of action alone would have asked.
   */
  rulesThatAllowed(command: string, at = Infinity): CommandRule[] {
    const readOnly = modeConfig(this.state.agent.mode).readOnly;
    if (decide('shell', [command], sessionRules(this.state.settings.permissions, readOnly)) === 'allow') return [];
    return rulesUsed(command, this.commandRules()).filter((r) => r.effect === 'allow' && (this.ruleStat(r)?.created ?? 0) <= at);
  }

  /**
   * How the rules see one command of a line: it only looks (never asks), the
   * kinds of action allow it, a rule of the author's does, it needs asking, or
   * it may never run.
   */
  commandStatus(command: string): 'looks' | 'allowed' | 'rule' | 'asks' | 'never' {
    const readOnly = modeConfig(this.state.agent.mode).readOnly;
    const effect = decide('shell', [command], sessionRules(this.state.settings.permissions, readOnly, this.authorRules(this.state.agent.sessionId)));
    if (effect === 'deny') return 'never';
    if (effect === 'ask') return 'asks';
    if (this.rulesThatAllowed(command).length) return 'rule';
    return decide('shell', [command], sessionRules(PRESETS.readonly.permissions, true)) === 'allow' ? 'looks' : 'allowed';
  }

  /**
   * The rules the assistant keeps of its own, which let it act without asking
   * (so Foreword never sees those requests): Codex's rules files, and
   * Claude Code's settings in the book's .claude folder and in ~/.claude, for
   * the tools it doesn't ask the app about anyway. Read only.
   */
  async assistantOwnRules(): Promise<{ path: string; inBook: boolean; rules: OwnRule[] }[]> {
    const kind = this.state.settings.assistant;
    if (kind !== 'claude' && kind !== 'codex') return [];
    const files: { path: string; text: string; inBook: boolean }[] = [];
    if (kind === 'claude' && this.state.workspace) {
      for (const path of ['.claude/settings.local.json', '.claude/settings.json']) {
        const text = await ipc.fsRead(path).then((f) => f.text, () => null);
        if (text) files.push({ path, text, inBook: true });
      }
    }
    for (const f of await ipc.assistantRuleFiles(kind).catch(() => [])) files.push({ ...f, inBook: false });
    // Claude Code asks the app about commands, edits, reads and the web whatever its rules say (CLAUDE_ASKS);
    // a skill's commands and edits ask too. Its MCP tools are what still act unasked.
    const stillUnasked = (r: OwnRule) => kind !== 'claude' || (!r.command && !(CLAUDE_ASKS as readonly string[]).includes(r.text.replace(/\(.*$/s, '')) && /^mcp__/.test(r.text));
    return files
      .map((f) => ({ path: f.path, inBook: f.inBook, rules: (kind === 'claude' ? claudeRules : codexRules)(f.text).filter((r) => r.effect === 'allow' && stillUnasked(r)) }))
      .filter((f) => f.rules.length);
  }

  /** Commands it ran: how often each rule let one run. */
  private counted = new Set<string>();
  private countRuleUse(sessionId: string, callId: string, input: unknown) {
    const command = input && typeof input === 'object' ? (input as { command?: unknown }).command : undefined;
    if (typeof command !== 'string' || this.counted.has(callId)) return;
    const used = rulesUsed(command, this.commandRules(sessionId)).filter((r) => r.effect === 'allow');
    if (!used.length) return;
    this.counted.add(callId);
    const now = Date.now();
    this.setRuleStats((stats) => {
      for (const r of used) {
        const k = this.ruleStatKey(r, sessionId);
        const was = stats[k] ?? { created: 0, uses: 0, last: 0 };
        stats[k] = { ...was, uses: was.uses + 1, last: now };
      }
    });
  }

  // ---- the settings file (~/.foreword/settings.json) ---------------------------------

  /** The file's last known text (to notice edits made elsewhere) and its parsed object (to keep unknown keys). */
  private config: { text: string | null; raw: Record<string, unknown> } = { text: null, raw: {} };
  private configTimer: number | undefined;

  /** Read the settings file; with none yet, write it from the settings this machine had. */
  async loadConfig() {
    try {
      const { path, text } = await ipc.configRead();
      this.store.set({ configFile: { path, error: null } });
      if (text === null) {
        this.config = { text: null, raw: {} };
        this.scheduleConfigWrite(0);
        return;
      }
      if (text === this.config.text) return;
      const parsed = parseConfig(text);
      if (parsed.error) {
        // Keep using the last good settings, and leave the file alone until it's fixed.
        this.config = { text, raw: this.config.raw };
        this.store.set({ configFile: { path, error: parsed.error } });
        return;
      }
      this.config = { text, raw: parsed.raw };
      // A mode with its own assistant keeps it: the file has the one another window's mode switched to.
      const own = this.setupFor(this.state.agent.mode) ? { assistant: this.state.settings.assistant } : {};
      this.updateSettings({ ...parsed.settings, ...own }, { write: false });
      if (parsed.zoom && Math.abs(parsed.zoom - this.state.zoom) > 0.001) await this.setZoom(parsed.zoom, { persist: false, write: false });
    } catch (e) {
      console.warn('settings file: read failed', e);
    }
  }

  private scheduleConfigWrite(delay = 300) {
    window.clearTimeout(this.configTimer);
    this.configTimer = window.setTimeout(() => void this.writeConfig(), delay);
  }

  private async writeConfig() {
    if (this.state.configFile?.error) return; // a broken file is the author's to fix
    const text = serializeConfig(this.config.raw, this.state.settings, this.state.zoom);
    if (text === this.config.text) return;
    try {
      await ipc.configWrite(text);
      this.config = { text, raw: JSON.parse(text) };
    } catch (e) {
      console.warn('settings file: write failed', e);
    }
  }

  async openConfigFile() {
    try {
      await this.writeConfig();
      await ipc.configOpen();
    } catch (e) {
      this.toast(`Couldn't open the settings file: ${errorMessage(e)}`, 'error');
    }
  }

  /** Apply the permission settings to the current conversation, and say so in the chat. */
  /** Give the conversation the permissions and rules as they are now; `notice`: say so in the chat (not for a rule the author just made there). */
  private async applyPermissions({ notice = true } = {}) {
    const { sessionId } = this.state.agent;
    if (!sessionId || !this.agent) return;
    const permissions = this.state.settings.permissions;
    try {
      await this.agent.setPermissions(sessionId, permissions, modeConfig(this.state.agent.mode).readOnly, this.authorRules(sessionId));
      if (notice) this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: describePermissions(permissions) });
      // A rule made in Settings, or a kind of action now allowed, answers what's waiting for it.
      this.answerCovered();
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't change permissions for this conversation: ${errorMessage(e)}` });
    }
  }

  // ---- project settings (.foreword.json) -----------------------------------------

  /** Read the project file. With `restartIfNeeded`, restart Typst when an entry/font/output setting changed on disk. */
  async loadProjectSettings({ restartIfNeeded = false } = {}) {
    let text: string | null = null;
    let hash: string | null = null;
    try {
      const file = await ipc.fsRead(PROJECT_FILE);
      text = file.text;
      hash = file.hash;
    } catch (e) {
      if (!isCmdError(e) || e.kind !== 'notFound') {
        this.store.set((s) => ({ project: { ...s.project, error: errorMessage(e) } }));
        return;
      }
    }
    if (hash !== null && hash === this.state.project.hash) return; // our own write echoing back
    const before = this.state.project.settings;
    const parsed = parseProjectSettings(text);
    this.store.set({ project: { settings: parsed.settings, raw: parsed.raw, hash, error: parsed.error } });
    if (restartIfNeeded && needsRestart(before, parsed.settings)) await this.applyEntryAndRestart(parsed.settings);
    if (rulesDiffer(before, parsed.settings)) this.permissionsApplied = this.applyPermissions({ notice: false });
  }

  /** The colour VS Code's Peacock gives the book, which the window wears until the book has its own. */
  async loadPeacockColor() {
    const root = this.state.workspace?.root;
    const text = await ipc
      .fsRead(VSCODE_SETTINGS)
      .then((f) => f.text)
      .catch(() => null);
    if (this.state.workspace?.root === root) this.store.set({ peacockColor: peacockColor(text) });
  }

  private bookColorTimer = 0;

  /**
   * The book's colour: a colour, "none", or null for VS Code's Peacock colour
   * (if any). The window wears it at once; it's saved in the book's settings a
   * moment later, so dragging in the colour picker writes the file once.
   */
  setBookColor(color: string | null) {
    this.store.set((s) => ({ project: { ...s.project, settings: { ...s.project.settings, color: color ?? undefined } } }));
    clearTimeout(this.bookColorTimer);
    this.bookColorTimer = window.setTimeout(async () => {
      const errors = await this.updateProjectSettings({ color: color ?? undefined });
      if (!errors.length) return;
      this.toast(errors.join(' '), 'error');
      // Back to what the file says.
      this.store.set((s) => ({ project: { ...s.project, settings: parseProjectSettings(JSON.stringify(s.project.raw)).settings } }));
    }, 400);
  }

  /** Save project settings; returns validation or write errors (empty on success). */
  async updateProjectSettings(patch: ProjectSettings): Promise<string[]> {
    const ws = this.state.workspace;
    if (!ws) return ['No project is open.'];
    const { project } = this.state;
    if (project.error) return [project.error];
    const next = { ...project.settings, ...patch };
    const errors = validateProjectSettings(next, ws.files.filter((f) => f.endsWith('.typ')));
    if (errors.length) return errors;
    const text = serializeProjectSettings(project.raw, patch);
    try {
      const hash = await ipc.fsWrite(PROJECT_FILE, text, project.hash);
      const parsed = parseProjectSettings(text);
      this.store.set({ project: { settings: parsed.settings, raw: parsed.raw, hash, error: null } });
    } catch (e) {
      if (isCmdError(e) && e.kind === 'conflict') {
        await this.loadProjectSettings();
        return [`${PROJECT_FILE} changed on disk; reloaded it. Try again.`];
      }
      return [`Couldn't save ${PROJECT_FILE}: ${errorMessage(e)}`];
    }
    if (needsRestart(project.settings, next)) await this.applyEntryAndRestart(next);
    if (rulesDiffer(project.settings, next)) this.permissionsApplied = this.applyPermissions({ notice: false });
    return [];
  }

  private async applyEntryAndRestart(settings: ProjectSettings) {
    const ws = this.state.workspace;
    if (!ws) return;
    const entry = settings.entryPoint && ws.files.includes(settings.entryPoint) ? settings.entryPoint : ws.entry;
    if (entry !== ws.entry) this.store.set({ workspace: { ...ws, entry } });
    await this.restartTypst();
  }

  /** Export the entry point to PDF through Tinymist, after saving open edits. */
  async exportPdf() {
    const ws = this.state.workspace;
    if (!ws || this.state.exporting) return;
    if (!this.typst.running) {
      this.toast('Export needs the Typst preview running. Restart the preview and try again.', 'error');
      return;
    }
    // Code examples that aren't up to date would print "not run" / "out of date" notes in the PDF.
    const stale = this.code.problems();
    if (stale.length) {
      const answer = await message(
        `${stale.length} code example${stale.length > 1 ? 's are' : ' is'} not up to date, so the PDF would show that:\n\n${stale.slice(0, 8).join('\n')}${stale.length > 8 ? '\n…' : ''}`,
        { title: 'Code examples', kind: 'warning', buttons: { yes: 'Run them, then export', no: 'Export anyway', cancel: 'Cancel' } },
      );
      if (answer === 'Cancel') return;
      if (answer === 'Yes' || answer === 'Run them, then export') await this.code.runAll({ onlyStale: true });
    }
    // Where to save it: the Save dialog, starting where this book was last saved.
    const target = await this.pickExportPath(await this.defaultExportPath());
    if (!target) return;
    this.store.set({ exporting: true });
    try {
      const failures = (await this.docs?.saveAll()) ?? [];
      if (failures.length) throw new Error(`couldn't save ${failures.map((f) => f.path).join(', ')}`);
      // The book's main file, also while the preview shows the cover.
      const path = await this.typst.exportPdf(ws.entry ? `${ws.root}/${ws.entry}` : undefined);
      const rel = path.startsWith(ws.root + '/') ? path.slice(ws.root.length + 1) : path;
      const saved = await ipc.exportCopy(rel, target);
      this.rememberExportPath(saved);
      this.lastExport = saved;
      const name = saved.slice(saved.lastIndexOf('/') + 1);
      this.toast(`Saved “${name}” in ${tildePath(saved.slice(0, saved.lastIndexOf('/')))}`, 'info', [
        { label: 'Open', run: () => void this.openPdf(saved) },
        { label: 'Show in Finder', run: () => void ipc.revealPdf(saved).catch((e) => this.toast(errorMessage(e), 'error')) },
      ]);
      void this.refreshFiles();
    } catch (e) {
      this.toast(`Export failed: ${errorMessage(e)}`, 'error');
    } finally {
      this.store.set({ exporting: false });
    }
  }

  /**
   * The book's names for its files: headings of the .typ files and the order the
   * main file includes them. With `only`, just those files are re-read. Also
   * the imports the chat's snippets are set with.
   */
  private async refreshNames(only?: string[]) {
    const ws = this.state.workspace;
    if (!ws) return;
    const typ = ws.files.filter((f) => f.endsWith('.typ'));
    const titles = only ? { ...this.state.names.titles } : {};
    const unnumbered = new Set(only ? this.unnumberedFiles : []);
    const contents = only ? { ...this.state.contents } : {};
    const uses = new Map(only ? this.fileUses : []);
    for (const f of only ? only.filter((p) => p.endsWith('.typ')) : typ) {
      const text = await this.currentText(f).catch(() => null);
      const heading = text == null ? null : firstHeading(text);
      if (heading) titles[f] = heading;
      else delete titles[f];
      if (text != null && unnumberedHeading(text)) unnumbered.add(f);
      else unnumbered.delete(f);
      if (text != null) contents[f] = fileContents(text);
      else delete contents[f];
      if (text != null) uses.set(f, fileUses(text));
      else uses.delete(f);
    }
    const main = ws.entry ? await this.currentText(ws.entry).catch(() => null) : null;
    const root = this.typstRoot();
    const includes = main && ws.entry ? mainIncludes(main, ws.entry, root) : [];
    const chapters = includes.map((x) => x.file);
    // Unnumbered too: what the main file includes with heading numbers off around it (a preface, an afterword).
    const front = includes.filter((x) => x.unnumbered).map((x) => x.file);
    const prelude = ws.entry ? snippetPrelude(ws.entry, (p) => uses.get(p), root) : '';
    const was = this.state.snippetBook;
    const snippetBook = prelude ? (was?.root === root && was.prelude === prelude ? was : { root, prelude }) : null;
    if (this.state.workspace?.root !== ws.root) return;
    this.unnumberedFiles = unnumbered;
    this.fileUses = uses;
    this.store.set({ names: { root: ws.root, entry: ws.entry, chapters, titles, unnumbered: [...new Set([...unnumbered, ...front])] }, contents, snippetBook });
  }

  /** The files whose own text turns heading numbers off before their first heading (refreshNames keeps it). */
  private unnumberedFiles = new Set<string>();

  /** What each .typ file imports and includes (refreshNames keeps it), for the snippets' imports. */
  private fileUses = new Map<string, FileUses>();

  /** The last PDF exported in this session (Open Exported PDF). */
  lastExport: string | null = null;

  openEpubDialog() {
    if (!this.state.workspace?.entry) return;
    this.store.set({ epubOpen: true });
    this.syncPreviewVisibility();
  }

  closeEpubDialog() {
    this.store.set({ epubOpen: false });
    this.syncPreviewVisibility();
  }

  /** An exported EPUB in Finder, or opened (Books adds it to its library). */
  async revealEpub(path: string, open = false) {
    await ipc.epubReveal(path, open).catch((e) => this.toast(errorMessage(e), 'error'));
  }

  /** The Save dialog for Export EPUB (replaced in self-tests). */
  pickEpubPath: (defaultPath: string) => Promise<string | null> = async (defaultPath) => {
    const picked = await saveDialog({ title: 'Export EPUB', defaultPath, filters: [{ name: 'EPUB', extensions: ['epub'] }] });
    if (!picked) return null;
    return /\.epub$/i.test(picked) ? picked : `${picked}.epub`;
  };

  /** Where the EPUB goes by default: beside this book's last PDF, else in Documents, named for the book. */
  async defaultEpubPath(): Promise<string> {
    const pdf = await this.defaultExportPath();
    return pdf.replace(/\.pdf$/i, '.epub');
  }

  /**
   * Export EPUB (epub/): reflowing text, or fixed layout (every page as
   * typeset). "auto" picks per book: fixed for a picture book or a paper, for
   * a book with math on most pages, or when the reflowing export fails;
   * reflowing text otherwise. Says which it made, why, and what didn't carry over.
   */
  async exportEpub(choice: 'auto' | EpubKind, target: string): Promise<EpubResult> {
    const ws = this.state.workspace;
    if (!ws?.entry) throw new Error('This book has no main file.');
    const failures = (await this.docs?.saveAll()) ?? [];
    if (failures.length) throw new Error(`couldn't save ${failures.map((f) => f.path).join(', ')}`);
    const entry = ws.entry;
    const main = (await this.currentText(entry)) ?? '';
    const names = namesFromMain(main);
    const title = names.title || ws.name;
    const root = this.typstRoot() || '.';
    const fonts = absoluteFontPaths(this.state.project.settings, ws.root);
    const id = await bookId(ws.root);

    let kind: EpubKind = choice === 'fixed' ? 'fixed' : 'reflow';
    let why = choice === 'fixed' ? 'you chose fixed layout' : choice === 'reflow' ? 'you chose reflowing text' : 'it’s mostly text, so it reflows to fit any screen';
    const fixedWhy = choice === 'auto' ? fixedFor({ files: ws.files, main }) : null;
    if (fixedWhy) [kind, why] = ['fixed', fixedWhy];
    let html: { html: string | null; warnings: string[]; errors: string[] } | null = null;
    if (kind === 'reflow') {
      html = await ipc.epubHtml(entry, epubSource(main).source, root, fonts);
      if (!html.html) [kind, why] = ['fixed', `the reflowing export didn’t work for this book (${html.errors[0] ?? 'Typst stopped'}), so every page stays as typeset`];
      else if (choice === 'auto' && mathHeavy(html.html)) [kind, why] = ['fixed', 'it has math on most pages, which e-readers can’t reflow well'];
    }

    const files: EpubFile[] = [{ name: 'META-INF/container.xml', text: CONTAINER_XML }];
    const items: ManifestItem[] = [{ id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' }];
    const toc: { title: string; href: string }[] = [];
    let lang = /#set text\([^)]*lang:\s*"([a-z-]+)"/i.exec(main)?.[1] ?? 'en';
    let lost: string[] = [];
    let temp: string | null = null;
    try {
      if (kind === 'reflow' && html?.html) {
        const book = splitBook(html.html);
        lang = book?.lang ?? lang;
        const parts = book ? [...(book.front.trim() ? [{ file: null as string | null, body: book.front }] : []), ...book.chapters] : [{ file: null as string | null, body: html.html }];
        items.push({ id: 'css', href: 'style.css', mediaType: 'text/css' });
        files.push({ name: 'OEBPS/style.css', text: EPUB_CSS });
        // Each part's pictures made its own (their ids, and files instead of data: URLs), then links between parts.
        let pictures = 0;
        const bodies = parts.map((part, i) => {
          const { html: body, images } = extractImages(uniqueSvgIds(part.body, `s${i + 1}-`), pictures);
          for (const img of images) {
            items.push({ id: `image-${++pictures}`, href: img.name, mediaType: img.mediaType });
            files.push({ name: `OEBPS/${img.name}`, base64: img.base64 });
          }
          return body;
        });
        const linked = linkParts(
          bodies,
          parts.map((_, i) => chapterFile(i + 1)),
        );
        parts.forEach((part, i) => {
          const n = i + 1;
          const body = linked[i];
          // A chapter's title is its first heading (as the chat names it), else "Chapter 3".
          const number = book && part.file ? book.chapters.findIndex((c) => c.file === part.file) + 1 : n;
          const chapterTitle = part.file ? (this.state.names.titles[resolveRef(entry, part.file, this.typstRoot()) ?? ''] ?? `Chapter ${number}`) : title;
          const href = chapterFile(n);
          files.push({ name: `OEBPS/${href}`, text: xhtmlPage({ title: chapterTitle, lang, body: toXhtml(part.file ? chapterHead(body, chapterTitle) : body), type: part.file ? 'bodymatter' : 'frontmatter' }) });
          items.push({ id: `part-${n}`, href, mediaType: 'application/xhtml+xml', spine: true, ...(/<svg[\s>]/.test(body) ? { properties: 'svg' } : {}) });
          toc.push({ title: chapterTitle, href });
        });
        lost = didntCarryOver(html.warnings);
      } else {
        const pages = await ipc.epubPages(entry, root, fonts);
        temp = pages.dir;
        if (!pages.pages.length) throw new Error(pages.errors[0] ?? 'Typst made no pages');
        const pad = (n: number) => String(n).padStart(3, '0');
        pages.pages.forEach((p, i) => {
          const n = i + 1;
          const image = `images/page-${pad(n)}.svg`;
          files.push({ name: `OEBPS/${image}`, temp: p.file });
          items.push({ id: `image-${n}`, href: image, mediaType: 'image/svg+xml', ...(n === 1 ? { properties: 'cover-image' } : {}) });
          const href = `page-${pad(n)}.xhtml`;
          files.push({ name: `OEBPS/${href}`, text: fixedPage({ n, lang, image, width: p.width, height: p.height }) });
          items.push({ id: `page-${n}`, href, mediaType: 'application/xhtml+xml', spine: true });
        });
        const chapters = pages.toc.filter((t) => t.level === 1 && t.page >= 1 && t.page <= pages.pages.length);
        for (const t of chapters.length ? chapters : [{ title, page: 1 }]) toc.push({ title: t.title, href: `page-${pad(t.page)}.xhtml` });
      }
      files.push({ name: 'OEBPS/nav.xhtml', text: navPage({ lang, entries: toc }) });
      files.push({ name: 'OEBPS/content.opf', text: packageOpf({ id, title, author: names.author, lang, modified: new Date(), fixed: kind === 'fixed', items }) });
      const path = await ipc.epubWrite(target, files);
      return { path, kind, why, lost, chapters: toc.length };
    } finally {
      if (temp) void ipc.epubDone(temp).catch(() => {});
    }
  }

  /** The Save dialog for Export PDF (replaced in self-tests, which can't click native dialogs). */
  pickExportPath: (defaultPath: string) => Promise<string | null> = async (defaultPath) => {
    const picked = await saveDialog({ title: 'Export PDF', defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!picked) return null;
    return /\.pdf$/i.test(picked) ? picked : `${picked}.pdf`;
  };

  private exportTargets() {
    return readJson<Record<string, string>>(EXPORT_TARGETS_KEY) ?? {};
  }

  /** Where this book was last saved; else Documents/<title>.pdf. */
  private async defaultExportPath(): Promise<string> {
    const ws = this.state.workspace!;
    const last = this.exportTargets()[ws.root];
    if (last) return last;
    const main = ws.entry ? await this.currentText(ws.entry) : null;
    const title = (main ? namesFromMain(main).title : null) || ws.name;
    const file = `${title.replace(/[/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Book'}.pdf`;
    const dir = await documentDir().catch(() => ws.root);
    return `${dir.replace(/\/$/, '')}/${file}`;
  }

  private rememberExportPath(path: string) {
    const root = this.state.workspace?.root;
    // Self-tests share this storage with the author's app: never record their paths.
    if (!root || this.state.launch?.selftestOut) return;
    writeJson(EXPORT_TARGETS_KEY, { ...this.exportTargets(), [root]: path });
  }

  /**
   * The book's latest PDF, in the PDF viewer: where it was last exported to,
   * else the export folder, else next to the main file.
   */
  async openExportedPdf() {
    const ws = this.state.workspace;
    if (!ws?.entry) return;
    const stem = ws.entry.replace(/\.typ$/, '');
    const name = `${stem.slice(stem.lastIndexOf('/') + 1)}.pdf`;
    const outputDir = this.state.project.settings.outputDir?.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
    const candidates = [
      this.lastExport ?? this.exportTargets()[ws.root],
      outputDir ? `${outputDir}/${name}` : null,
      `${stem}.pdf`,
    ].filter((p): p is string => !!p);
    for (const path of candidates) {
      try {
        await this.pdfViewer(path);
        return;
      } catch {
        // Not there: the next place.
      }
    }
    this.toast('There’s no PDF of this book yet.', 'info', [{ label: 'Export PDF…', run: () => void this.exportPdf() }]);
  }

  /** Opens a PDF in the viewer; fails if it doesn't exist (replaced in self-tests, which mustn't open windows). */
  pdfViewer: (path: string) => Promise<void> = (path) => ipc.openPdf(path);

  /** Open a PDF (book-relative or absolute) in Preview (or the author's PDF viewer). */
  async openPdf(path: string) {
    try {
      await this.pdfViewer(path);
    } catch (e) {
      this.toast(`Couldn't open ${path}: ${errorMessage(e)}`, 'error');
    }
  }

  /** Opens a picture in the book in Preview (replaced in self-tests, which mustn't open windows). */
  pictureViewer: (path: string) => Promise<void> = (path) => ipc.openPicture(path);

  /** Open a picture in the book (PNG, JPEG…) in Preview: the editor can't show it. */
  async openPicture(path: string) {
    try {
      await this.pictureViewer(path);
    } catch (e) {
      this.toast(`Couldn't open ${path}: ${errorMessage(e)}`, 'error');
    }
  }

  // ---- the assistant's own tools: Foreword's settings (studio-tools.ts) ----------

  private toolsUrl: Promise<string | null> | null = null;
  /** What the tools asked for, to do when the assistant's reply ends. */
  private idleQueue: (() => unknown)[] = [];
  /** An assistant the tools switched to, and its model and effort, for when it has started. */
  private toolSwitch: { assistant: AssistantId; from: AssistantId; choice: ModelChoice } | null = null;

  /** This window's address for the tools (served once; null if they can't be). */
  studioToolsUrl(): Promise<string | null> {
    this.toolsUrl ??= (async () => {
      const page = new Channel<{ id: number; body: string }>();
      page.onmessage = ({ id, body }) =>
        void handleMcp(body, this.toolsHost).then(
          (answer) => ipc.mcpReply(id, answer),
          () => ipc.mcpReply(id, null),
        );
      try {
        return await ipc.mcpServe(page);
      } catch (e) {
        console.warn('Foreword’s tools for the assistant are off:', e);
        return null;
      }
    })();
    return this.toolsUrl;
  }

  /** The author's yes to an assistant's own ask about a settings tool, by tool (when): used once, by the tool. */
  private studioApprovals = new Map<string, number>();
  /** Foreword's own asks, waiting: their answers. */
  private localAsks = new Map<string, (yes: boolean) => void>();

  /**
   * The author's yes for a settings change at Ask. When the assistant asked
   * (Claude Code, OpenCode), the author's answer to that is it; otherwise (Codex
   * asks no one about these tools) a card in the chat, the same as an
   * assistant's. Not answered in 50 s: the assistant would stop waiting for the
   * tool, so it hears so, and the card goes.
   */
  private async approveStudioChange(tool: string, what: string): Promise<'yes' | 'no' | 'unanswered'> {
    const given = this.studioApprovals.get(tool);
    this.studioApprovals.delete(tool);
    if (given && Date.now() - given < 120_000) return 'yes';
    const id = uid('ask');
    const answer = new Promise<boolean | null>((resolve) => {
      this.localAsks.set(id, resolve);
      setTimeout(() => resolve(null), 50_000);
    });
    this.pushItem({ kind: 'permission', id, action: STUDIO_TOOL_ACTION, resources: [tool, what], patches: [], state: 'pending', local: true });
    this.activityBeforeAsking = this.state.agent.activity;
    this.setActivity({ phase: 'asking' });
    this.events.emit('show-agent-pane');
    const yes = await answer;
    this.localAsks.delete(id);
    if (yes === null) this.setAgent((a) => ({ items: a.items.filter((it) => it.id !== id) }));
    if (this.state.agent.activity?.phase === 'asking' && this.activityBeforeAsking) {
      const { since: _since, ...before } = this.activityBeforeAsking;
      this.setActivity(yes ? before : { phase: 'waiting' });
    }
    this.activityBeforeAsking = null;
    return yes === null ? 'unanswered' : yes ? 'yes' : 'no';
  }

  private answerLocalAsk(id: string, yes: boolean) {
    this.updateItem(id, (it) => (it.kind === 'permission' ? { ...it, state: yes ? 'once' : 'reject' } : it));
    this.localAsks.get(id)?.(yes);
  }

  readonly toolsHost: StudioHost = {
    state: () => {
      const a = this.state.agent;
      return {
        settings: this.state.settings,
        zoom: this.state.zoom,
        assistant: this.state.settings.assistant,
        models: a.models,
        model: a.model,
        efforts: a.efforts,
        effort: a.effort,
        mode: a.mode,
        permission: this.state.settings.permissions.settings,
      };
    },
    approve: (tool, what) => this.approveStudioChange(tool, what),
    changePreferences: (patch, zoom) => {
      if (Object.keys(patch).length) this.updateSettings(patch);
      if (zoom !== undefined) void this.setZoom(zoom);
    },
    whenIdle: (run) => {
      if (this.state.agent.running) this.idleQueue.push(run);
      else void run();
    },
    switchAssistant: (assistant, choice) => {
      this.toolSwitch = { assistant, from: this.state.settings.assistant, choice };
      if (!this.switchAssistant(assistant)) this.toolSwitch = null;
    },
    chooseModel: async (choice) => {
      const said = await this.chooseFromTools(choice);
      if (said) this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: `As the assistant was asked: ${said}.` });
    },
    setMode: (mode) => this.setMode(mode),
    openSettings: (page) => this.openSettings(page),
  };

  /** The reply that asked is over: what the tools asked for, in order. */
  private async runWhenIdle() {
    for (let run = this.idleQueue.shift(); run; run = this.idleQueue.shift()) {
      try {
        await run();
      } catch (e) {
        this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn’t change that: ${errorMessage(e)}` });
      }
    }
  }

  /** The model and effort the tools asked for: what came of it, in words ("model Sonnet 5.5, effort High"). */
  private async chooseFromTools({ model, effort }: ModelChoice): Promise<string> {
    const said: string[] = [];
    if (model) {
      const { models, recentModels } = this.state.agent;
      const usable = models.filter((m) => m.supportsTools);
      let pick: ModelInfo | undefined;
      if (model.toLowerCase() === 'default') {
        const own = await this.agent?.defaultModel().catch(() => null);
        pick = usable.find((m) => m.id === 'default') ?? (own ? usable.find((m) => m.providerID === own.providerID && m.id === own.id) : undefined);
      } else {
        const found = usable.filter((m) => matchesQuery(m, model));
        pick = usable.find((m) => m.id === model) ?? found.find((m) => recentModels.some((r) => r.providerID === m.providerID && r.id === m.id)) ?? found[0];
      }
      if (pick) {
        await this.selectModel({ providerID: pick.providerID, id: pick.id });
        said.push(`model ${pick.name}`);
      } else said.push(`no model like “${model}”, so the model is unchanged`);
    }
    if (effort) {
      const { efforts } = this.state.agent;
      const level = effortFor(effort, efforts);
      if (!efforts.length) said.push('this model has no effort setting');
      else if (!level) said.push(`the effort is unchanged (“${effort}” isn’t one of ${efforts.map((e) => e.name).join(', ')})`);
      else if (await this.selectEffort(level.value)) said.push(`effort ${level.name}`);
    }
    return said.join(', ');
  }

  /** Started the assistant the tools switched to: its model and effort, and a word in the new conversation. */
  private async afterToolSwitch() {
    const pending = this.toolSwitch;
    if (!pending || pending.assistant !== this.state.settings.assistant) return;
    this.toolSwitch = null;
    const said = await this.chooseFromTools(pending.choice);
    const model = this.state.agent.models.find((m) => m.providerID === this.state.agent.model?.providerID && m.id === this.state.agent.model?.id);
    const effort = this.state.agent.efforts.find((e) => e.value === this.state.agent.effort);
    const now = said || [model && `model ${model.name}`, effort && `effort ${effort.name}`].filter(Boolean).join(', ');
    this.pushItem({
      kind: 'notice',
      id: uid('n'),
      tone: 'info',
      text: `${ASSISTANT_NAMES[pending.assistant]} is the writing assistant now${now ? ` (${now})` : ''}, as you asked. This is a new conversation: your last one is kept with ${ASSISTANT_NAMES[pending.from]}, to carry on if you switch back.`,
    });
  }

  // ---- writing style guide (WRITING_STYLE.md) --------------------------------------

  private styleDismissKey() {
    return `studio.styleGuideDismissed:${this.state.workspace?.root ?? ''}`;
  }

  /** Read WRITING_STYLE.md; with `updateSession`, push the new text to the running conversation. */
  async loadStyleGuide({ updateSession = false } = {}) {
    let text: string | null = null;
    try {
      text = (await ipc.fsRead(STYLE_GUIDE_FILE)).text;
    } catch {}
    const changed = text !== this.styleGuideText;
    this.styleGuideText = text;
    const dismissed = (() => {
      try {
        return localStorage.getItem(this.styleDismissKey()) === '1';
      } catch {
        return false;
      }
    })();
    this.store.set((s) => ({ styleGuide: { ...s.styleGuide, exists: text !== null, chars: text?.length ?? 0, dismissed } }));
    const { sessionId } = this.state.agent;
    if (!updateSession || !changed || !sessionId || !this.agent) return;
    try {
      if (text?.trim()) await this.agent.setInstructions(sessionId, STYLE_INSTRUCTIONS_KEY, styleInstructions(text));
      else await this.agent.removeInstructions(sessionId, STYLE_INSTRUCTIONS_KEY);
      // The draft says it's ready when its turn ends (afterStyleDraft).
      if (sessionId === this.state.styleGuide.drafting) return;
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text: text?.trim() ? `Using the updated ${STYLE_GUIDE_FILE}.` : `${STYLE_GUIDE_FILE} was removed; no style guide in use.` });
    } catch (e) {
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'error', text: `Couldn't update the style guide for this conversation: ${errorMessage(e)}` });
    }
  }

  openStyleTemplates() {
    this.store.set({ styleTemplatesOpen: true });
    this.syncPreviewVisibility();
  }

  closeStyleTemplates() {
    this.store.set({ styleTemplatesOpen: false });
    this.syncPreviewVisibility();
  }

  /**
   * WRITING_STYLE.md from a template (style-guides/; Blank has a prompt under each
   * heading), named for the book, and open it. Over a guide that's there, asked
   * first: History keeps the one it replaces.
   */
  async createStyleGuideFromTemplate(templateId = 'blank') {
    const ws = this.state.workspace;
    if (!ws) return false;
    const template = STYLE_TEMPLATES.find((t) => t.id === templateId) ?? STYLE_TEMPLATES[STYLE_TEMPLATES.length - 1];
    const title = (await this.bookMeasurements().catch(() => null))?.title ?? ws.name;
    const there = await ipc.fsRead(STYLE_GUIDE_FILE).catch(() => null);
    if (there) {
      const ok = await this.confirmAction(
        `This replaces your ${STYLE_GUIDE_FILE} with the ${template.name} template. History keeps the guide you have now, so you can go back to it.`,
        'Replace the style guide?',
        'Replace',
      );
      if (!ok) return false;
      await this.docs?.saveAll();
      await this.history.checkpoint().catch(() => null);
    }
    try {
      await ipc.fsWrite(STYLE_GUIDE_FILE, template.text(title), there?.hash ?? null);
    } catch (e) {
      this.toast(`Couldn't write ${STYLE_GUIDE_FILE}: ${errorMessage(e)}`, 'error');
      return false;
    }
    this.closeStyleTemplates();
    await this.loadStyleGuide({ updateSession: true });
    await this.refreshFiles();
    await this.reloadFromDisk(STYLE_GUIDE_FILE).catch(() => {});
    await this.openFile(STYLE_GUIDE_FILE);
    return true;
  }

  /** Instructions for the next message's conversation, which the author doesn't see (set by draftStyleGuide). */
  private pendingBrief: { key: string; text: string } | null = null;

  /** The guide's text when its draft began: the draft is done when the file is there and different. */
  private styleDraftBefore: string | null = null;

  /**
   * "Draft from my chapters": a task of its own, in Write mode, that reads the
   * manuscript, may ask a question or two about the book, and writes the guide.
   * The chat shows the author a short message; the brief goes with it as that
   * conversation's instructions, out of sight.
   */
  async draftStyleGuide({ kind = 'draft' as StyleDraftKind, request = '' } = {}) {
    const a = this.state.agent;
    if (!this.agent || a.status !== 'ready' || a.running) return false;
    if (a.sessionId || a.items.length) this.newSession();
    if (this.state.agent.mode !== 'write') await this.setMode('write');
    this.styleDraftBefore = this.styleGuideText;
    // How the author has rewritten the assistant's text: the guide should ask for that (a revision changes only what they ask).
    const revisions = kind === 'revise' ? [] : await this.authorRevisions();
    const brief =
      kind === 'revise'
        ? styleReviseBrief()
        : kind === 'interview'
          ? styleInterviewBrief({ revisions, existing: this.state.styleGuide.exists })
          : styleDraftBrief({ revisions, ...(kind === 'redraft' ? { redraft: { authorChanges: await this.guideAuthorChanges() } } : {}) });
    this.pendingBrief = { key: STYLE_DRAFT_KEY, text: brief };
    this.store.set((s) => ({ styleGuide: { ...s.styleGuide, drafting: '', draftKind: kind } }));
    const sent = await this.send(kind === 'revise' ? styleReviseMessage(request) : kind === 'interview' ? STYLE_INTERVIEW_MESSAGE : kind === 'redraft' ? STYLE_REDRAFT_MESSAGE : STYLE_DRAFT_MESSAGE);
    this.pendingBrief = null;
    this.store.set((s) => ({ styleGuide: { ...s.styleGuide, drafting: sent ? this.state.agent.sessionId : null } }));
    return sent;
  }

  /** A turn of the draft ended: once the guide is written, it opens in the editor. */
  private async afterStyleDraft(sessionId: string | null) {
    if (!sessionId || sessionId !== this.state.styleGuide.drafting) return;
    const kind = this.state.styleGuide.draftKind;
    await this.loadStyleGuide();
    const text = this.styleGuideText;
    if (!text?.trim() || text === this.styleDraftBefore) {
      // A revision that changed nothing (the guide said so already): it's over, unless it asked something first.
      const asking = this.state.agent.sessionId === sessionId && this.state.agent.items.some((it) => it.kind === 'question' && it.state === 'pending');
      if (kind === 'revise' && !asking) this.store.set((s) => ({ styleGuide: { ...s.styleGuide, drafting: null } }));
      return;
    }
    this.store.set((s) => ({ styleGuide: { ...s.styleGuide, drafting: null } }));
    // What the author says next in this task changes the guide as they ask, rather than writing it all again.
    if (kind !== 'revise') await this.agent?.setInstructions(sessionId, STYLE_DRAFT_KEY, styleReviseBrief()).catch((e) => console.warn('style guide: the revision brief', e));
    await this.refreshFiles();
    await this.openFile(STYLE_GUIDE_FILE);
    if (this.state.agent.sessionId === sessionId) {
      const text =
        kind === 'revise'
          ? `Your style guide is changed, and open in the editor (${STYLE_GUIDE_FILE}). Say here if anything else should change.`
          : `${this.styleDraftBefore !== null ? `Your new style guide is open in the editor (${STYLE_GUIDE_FILE}); History keeps the one before.` : `Your style guide is open in the editor (${STYLE_GUIDE_FILE}).`} Every message follows it from now on. Say here what should change, or change it yourself.`;
      this.pushItem({ kind: 'notice', id: uid('n'), tone: 'info', text });
    }
  }

  /** "Revise…": the author says what should change, and the assistant changes that in the guide, in a task of its own, keeping the rest. */
  async reviseStyleGuide() {
    if (!this.state.styleGuide.exists) return false;
    const request = await this.prompt({
      title: 'Revise the style guide',
      label: 'What should change?',
      placeholder: STYLE_REVISE_PLACEHOLDER,
      okLabel: 'Revise',
      multiline: true,
      help: `The assistant changes just that in ${STYLE_GUIDE_FILE}, in a task of its own, and leaves the rest as it is. History keeps this version.`,
    });
    if (!request?.trim()) return false;
    return this.draftStyleGuide({ kind: 'revise', request });
  }

  /** "Redraft…": the guide isn't quite right. Asked first: it's written again (History keeps this one). */
  async redraftStyleGuide() {
    if (!this.state.styleGuide.exists) return this.draftStyleGuide();
    const ok = await this.confirmAction(
      `The assistant reads your chapters again and rewrites ${STYLE_GUIDE_FILE}, keeping the rules you wrote or changed yourself. History keeps this version, so you can go back to it.`,
      'Redraft the style guide?',
      'Redraft',
    );
    if (ok) await this.draftStyleGuide({ kind: 'redraft' });
  }

  /** "Interview me": the guide from the author's answers. Over a guide that's there, asked first (History keeps it). */
  async interviewStyleGuide() {
    if (this.state.styleGuide.exists) {
      const ok = await this.confirmAction(
        `The assistant asks you how the book should read, then writes ${STYLE_GUIDE_FILE} again from your answers, keeping the rules you wrote yourself. History keeps this version, so you can go back to it.`,
        'Write the style guide by interview?',
        'Interview me',
      );
      if (!ok) return;
    }
    await this.draftStyleGuide({ kind: 'interview' });
  }

  /**
   * How the author rewrote the assistant's text, from History, newest first:
   * for each of the assistant's recent versions, the passages it wrote in the
   * book's Typst files that the author then changed by hand, as they left them
   * before an assistant next changed that file (or as they are now), so later
   * assistant changes never count as the author's. Changes of spacing only, and
   * the style guide itself, are left out.
   */
  async authorRevisions(): Promise<AuthorRevision[]> {
    if (this.state.history.status !== 'ready') return [];
    const out: AuthorRevision[] = [];
    try {
      const agents = (await ipc.historyList(400)).filter((v) => v.kind === 'agent' && v.parent).slice(0, 40);
      /** Per file, the assistant's next version that changed it (newer than the one being looked at). */
      const next = new Map<string, Version>();
      const flat = (t: string) => t.replace(/\s+/g, ' ').trim();
      for (const v of agents) {
        const paths = (await ipc.historyChanges(v.parent, v.id)).filter((c) => c.status !== 'D' && c.path.endsWith('.typ')).map((c) => c.path);
        for (const path of paths) {
          if (out.length >= 12) break;
          const edit = await this.aiEditOf(v, path);
          const lines = edit?.blocks.filter((b) => b.to > b.from).map((b) => ({ from: b.from + 1, to: b.to })) ?? [];
          const later = next.get(path);
          const left = later ? await ipc.historyFile(later.parent!, path).catch(() => null) : await this.currentText(path).catch(() => null);
          if (!edit || !lines.length || left == null) continue;
          for (const e of authorEdits(path, edit.after.join('\n'), left, lines)) if (flat(e.wrote) !== flat(e.now)) out.push({ path, wrote: e.wrote, now: e.now });
        }
        for (const path of paths) next.set(path, v);
      }
    } catch (e) {
      console.warn('style guide: the author’s revisions', e);
    }
    return out.slice(0, 12);
  }

  /**
   * What the author changed in the guide since an assistant last wrote it (theirs,
   * to keep): null when no assistant ever wrote it, undefined when History can't say.
   */
  private async guideAuthorChanges(): Promise<GuideChange[] | null | undefined> {
    if (this.state.history.status !== 'ready') return undefined;
    try {
      const written = (await ipc.historyList(200, STYLE_GUIDE_FILE)).find((v) => v.kind === 'agent');
      if (!written) return null;
      const edit = await this.aiEditOf(written, STYLE_GUIDE_FILE);
      const current = (await ipc.fsRead(STYLE_GUIDE_FILE)).text;
      if (!edit) return undefined;
      const lines = edit.blocks.filter((b) => b.to > b.from).map((b) => ({ from: b.from + 1, to: b.to }));
      return authorEdits(STYLE_GUIDE_FILE, edit.after.join('\n'), current, lines).map((e) => ({ wrote: e.wrote, now: e.now }));
    } catch (e) {
      console.warn('style guide: History', e);
      return undefined;
    }
  }

  dismissStyleGuidePrompt() {
    try {
      localStorage.setItem(this.styleDismissKey(), '1');
    } catch {}
    this.store.set((s) => ({ styleGuide: { ...s.styleGuide, dismissed: true } }));
  }

  // ---- zoom -----------------------------------------------------------------------

  /** ⌘= / ⌘− / ⌘0. The same press can arrive as a key event and as a menu event; apply it once. */
  async zoom(action: ZoomAction, source: 'key' | 'menu') {
    const now = performance.now();
    if (source === 'menu' && this.lastZoom.action === action && now - this.lastZoom.at < 300) return;
    this.lastZoom = { action, at: now };
    await this.setZoom(nextZoom(this.state.zoom, action));
  }

  async setZoom(factor: number, { persist = true, write }: { persist?: boolean; write?: boolean } = {}) {
    write ??= persist;
    this.zoomFactor = factor;
    const applied = await ipc.setUiZoom(factor);
    this.zoomFactor = applied;
    this.applyTitleBar();
    this.store.set({ zoom: applied });
    if (persist) writeJson(ZOOM_KEY, applied);
    if (write) this.scheduleConfigWrite();
    monaco.editor.remeasureFonts();
    window.dispatchEvent(new Event('studio-layout')); // re-place the preview webview
  }

  // ---- misc -----------------------------------------------------------------------

  toast(text: string, tone: 'info' | 'error' = 'info', actions?: ToastAction[]) {
    this.store.set({ toast: { text, tone, actions } });
    // Longer when there's something to click.
    setTimeout(
      () => {
        if (this.state.toast?.text === text) this.store.set({ toast: null });
      },
      actions?.length ? 12000 : 6000,
    );
  }

  now() {
    return clock();
  }
}

/** Settings Tinymist reads at start-up: changing them needs a restart. */
function needsRestart(a: ProjectSettings, b: ProjectSettings): boolean {
  return a.entryPoint !== b.entryPoint || (a.root ?? '') !== (b.root ?? '') || (a.outputDir ?? '') !== (b.outputDir ?? '') || JSON.stringify(a.fontPaths ?? []) !== JSON.stringify(b.fontPaths ?? []);
}

/** A running turn's activity in a few words (the task list). */
export function activityText(a: Activity | null): string {
  if (!a) return '';
  if (a.phase === 'tool') return a.label ?? 'Working';
  return { sending: 'Sending…', waiting: 'Waiting for the model…', thinking: 'Thinking…', writing: 'Writing…', retrying: 'The model is busy, trying again', asking: 'Waiting for your answer', tool: '' }[a.phase];
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const v = o.path ?? o.filePath ?? o.file ?? o.pattern ?? o.command ?? o.query ?? o.url;
  return typeof v === 'string' ? v : JSON.stringify(input).slice(0, 120);
}

export const studio = new Studio();
