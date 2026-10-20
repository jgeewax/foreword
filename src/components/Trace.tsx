// The conversation as a trace of what happened. Each message starts a turn:
// what you asked, then the assistant's steps on a line, each with a dot of
// its kind's colour (blue: it looked, purple: it changed something, as the
// editor marks what it read and changed; grey: it thought; amber: it needs
// you; red: it didn't work), the words an edit changed, then its reply and how
// the turn ended. Earlier turns fold to a line each.
import { useEffect, useMemo, useRef, useState } from 'react';
import { activityWords, clockTime, stepTimes, thinkingSoFar, thoughtHeading, waitedPrefix, waitingTip, workerName } from '../app/activity';
import { ASSISTANT_NAMES } from '../app/settings';
import { studio, type Activity, type ChatItem, type QuestionItem, type TurnBy } from '../app/studio';
import { withoutAddressed } from '../app/review';
import { withoutMarker } from '../app/tasks';
import { describePermission, describeTool } from '../app/tool-labels';
import { attachmentPlace, editOf, linesOf, lookOf, looksLikeProse, patchChanges, spanWords, statsOf, toolTone, trimPieces, turnsOf, turnTime, turnWords, verbAndRest, type Edit, type Tone, type ToolItem, type Turn } from '../app/trace';
import { wordPieces, type Piece } from '../app/prose-diff';
import { onContextMenu } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { parseOptions } from '../services/agent/options-mode';
import { answerText, questionText, splitQuestions } from '../services/agent/questions';
import { AssistantMark } from './AssistantSettings';
import { CommandPermission, RuleChip, scopeWords } from './CommandPermission';
import { FileIcon, Icon, type IconName } from './icons';
import { Markdown, MarkdownLine } from './Markdown';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function copyText(text: string) {
  navigator.clipboard.writeText(text).then(
    () => studio.toast('Copied'),
    (e) => studio.toast(`Couldn't copy: ${e}`, 'error'),
  );
}

const selectedText = () => String(window.getSelection() ?? '').trim();

/** Right-click on a chat item: copy the selection, the message, or a tool's details. */
const itemMenu = (text: string, what: string) =>
  onContextMenu(() => [
    !!selectedText() && { label: 'Copy', action: () => studio.copy(selectedText()) },
    { label: `Copy ${what}`, action: () => studio.copy(text) },
  ]);

/** A clock that ticks while `on`, for a live time. */
export function useNow(on: boolean, every = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [on, every]);
  return now;
}

/** Who's at work, for the chat: "Claude", "Codex", or OpenCode's model. */
function useWorkerName() {
  const assistant = useStore(studio.store, (s) => s.settings.assistant);
  const model = useStore(studio.store, (s) => (s.agent.model ? s.agent.models.find((m) => m.providerID === s.agent.model!.providerID && m.id === s.agent.model!.id)?.name : null));
  return workerName(assistant, model);
}

/** A book file's text as it is now, again after each turn (null until it's read, or if it can't be). */
function useFileText(path: string | null) {
  const marks = useStore(studio.store, (s) => s.aiMarks);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (path) void studio.textOf(path).then((t) => live && setText(t));
    return () => {
      live = false;
    };
  }, [path, marks]);
  return text;
}

/**
 * A small moving picture for what the assistant is doing: a sparkle that
 * twinkles while it thinks, a line being written while it writes, a comet
 * going round while a tool runs, an hourglass while it waits to try again.
 */
export function ActivityGlyph({ phase }: { phase: Activity['phase'] | 'starting' }) {
  if (phase === 'writing') {
    return (
      <svg className="glyph glyph-write" viewBox="0 0 24 24" aria-hidden>
        <path className="glyph-ink" d="M2 15c2.5-5 4.5-5 5.5-1s2.5 4 4.5-1 3.5-5.5 5-1 2.5 3.5 5 1" />
        <circle className="glyph-nib" cx="22" cy="13" r="1.6" />
      </svg>
    );
  }
  if (phase === 'tool') return <span className="glyph glyph-comet" aria-hidden />;
  if (phase === 'retrying') {
    return (
      <svg className="glyph glyph-hourglass" viewBox="0 0 24 24" aria-hidden>
        <path className="glass" d="M7 3.5h10M7 20.5h10M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5-8 8.5s8 3.5 8 8.5" />
        <path className="sand-top" d="M9.6 6.5h4.8L12 10.5z" />
        <path className="sand-bottom" d="M12 15.5l3.6 4H8.4z" />
      </svg>
    );
  }
  if (phase === 'asking') return <span className="glyph glyph-pulse" aria-hidden />;
  return (
    <svg className="glyph glyph-sparkle" viewBox="0 0 24 24" aria-hidden>
      <path className="sparkle-big" d="M10 3.5l1.9 6.6 6.6 1.9-6.6 1.9L10 20.5l-1.9-6.6L1.5 12l6.6-1.9z" />
      <path className="sparkle-small a" d="M19.5 2.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
      <path className="sparkle-small b" d="M19 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}

// ---- one step on the line --------------------------------------------------------------

type NodeTone = Tone | 'said' | 'done';

/** A step on the line: its dot (its kind's colour and icon, alive while it runs) and what it was. */
function Step({ tone, icon, live, children, menu }: { tone: NodeTone; icon?: IconName; live?: boolean; children: React.ReactNode; menu?: React.MouseEventHandler }) {
  return (
    <li className={`trace-step tone-${tone}${live ? ' live' : ''}`} onContextMenu={menu}>
      <span className="trace-node" aria-hidden>
        {icon && <Icon name={icon} size={12} />}
      </span>
      <div className="trace-body">{children}</div>
    </li>
  );
}

const TOOL_ICONS: Record<string, IconName> = {
  read: 'book',
  grep: 'search',
  glob: 'search',
  websearch: 'search',
  webfetch: 'search',
  list: 'files',
  edit: 'edit',
  write: 'edit',
  patch: 'edit',
  apply_patch: 'edit',
  bash: 'terminal',
  shell: 'terminal',
  todowrite: 'todos',
  plan_write: 'checklist',
  plan_exit: 'checklist',
  plan_enter: 'checklist',
};

/** A tool call in words ("Read “The Storm” (chapter 2) · lines 1–40"); its raw output folds out. An edit shows the words it changed. */
function ToolStep({ item, editOpen }: { item: ToolItem; editOpen: boolean }) {
  const names = useStore(studio.store, (s) => s.names);
  // A question asked here is shown by its card.
  const hasCard = useStore(studio.store, (s) => item.name === 'question' && s.agent.items.some((i) => i.kind === 'question' && i.callId === item.id));
  if (hasCard) return null;
  const label = describeTool(item.name, item.input, names, undefined, item.read);
  const [verb, rest] = verbAndRest(item.status === 'running' ? `${label.running}…` : label.done);
  // A no from you (keep planning) isn't a failure: it says what you chose.
  const declined = item.status === 'failed' && label.declined && /doesn.t want to proceed|refused permission|keep planning/i.test(item.detail) ? label.declined : null;
  const note = declined ?? item.note ?? label.note;
  const tone = declined ? 'other' : toolTone(item, label.done);
  // A command that only looked: a book or a magnifier, not a terminal.
  const look = tone === 'look' && (!TOOL_ICONS[item.name] || TOOL_ICONS[item.name] === 'terminal') ? lookOf(label.done) : null;
  const edit = tone === 'change' ? editOf(item, names.root) : null;
  const time = item.started && item.ended ? spanWords(item.ended - item.started) : undefined;
  // A command that did more than look: the command itself, and the rule that let it run without asking.
  const command = (item.name === 'bash' || item.name === 'shell') && tone !== 'look' ? (item.input as { command?: unknown } | undefined)?.command : undefined;
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (item.read) void studio.showRead(item.read);
    else if (label.path) void studio.openFile(label.path);
  };
  const words = (
    <>
      <span className="step-verb">{verb}</span> {rest}
    </>
  );
  return (
    <Step tone={tone} icon={item.status === 'failed' ? 'close' : look ? (look === 'read' ? 'book' : 'search') : (TOOL_ICONS[item.name] ?? (item.name.startsWith('foreword') ? 'settings' : 'more'))} live={item.status === 'running'} menu={itemMenu(`${item.name} ${item.summary}\n${item.detail}`, 'Details')}>
      <details className={`tool ${item.status}`}>
        <summary title={`${item.name}: ${item.summary}`} data-time={time}>
          {label.path && (item.read || item.name !== 'read') ? (
            <button className="tool-label link" title={item.read ? 'Open the file with these lines selected' : 'Open the file'} onClick={open}>
              {words}
            </button>
          ) : (
            <span className="tool-label">{words}</span>
          )}
          {note && <span className="tool-note">· {note}</span>}
        </summary>
        {/* The command itself, for the curious: in words above, exact here. */}
        {label.code && <pre className="tool-command">{label.code}</pre>}
        {/* Words of its own (a plan) say more than the tool's reply. */}
        {label.text ? (
          <div className="tool-text md">
            <Markdown text={label.text} />
          </div>
        ) : (
          item.detail && !declined && <pre className="tool-detail">{item.detail}</pre>
        )}
      </details>
      {typeof command === 'string' && command.trim() && (
        <div className="tool-cmdline">
          <code title={command}>{command.trim().split('\n')[0]}</code>
          <RuleChip command={command} at={item.started} />
        </div>
      )}
      {item.read && <ReadBar read={item.read} />}
      {edit && <EditCard edit={edit} initiallyOpen={editOpen && item.status === 'done'} made={item.status === 'done'} />}
    </Step>
  );
}

/** How much of the file a read covered, as a bar. */
function ReadBar({ read }: { read: { path: string; from: number; to: number } }) {
  const text = useFileText(read.path);
  const total = text == null ? 0 : text.split('\n').length;
  if (!total) return null;
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / total) * 100))}%`;
  return (
    <div className="read-bar" title={`Lines ${read.from}–${read.to} of ${total}`} aria-hidden>
      <span style={{ left: pct(read.from - 1), width: pct(read.to - read.from + 1) }} />
    </div>
  );
}

/** Words of a diff: the same, cut (struck through) and put in. */
function DiffText({ pieces, prose }: { pieces: Piece[]; prose: boolean }) {
  return (
    <p className={`diff-text${prose ? ' prose' : ''}`}>
      {pieces.map((p, i) => (p.kind === 'same' ? <span key={i}>{p.text}</span> : p.kind === 'del' ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>))}
    </p>
  );
}

/** What an edit changed, word by word, where it is now, and Show in editor / Undo this edit. */
function EditCard({ edit, initiallyOpen, made }: { edit: Edit; initiallyOpen: boolean; made: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const text = useFileText(edit.path || null);
  const where = text != null && !edit.whole ? linesOf(text, edit.after) : null;
  const pieces = useMemo(() => trimPieces(edit.pieces, 12), [edit.pieces]);
  const prose = looksLikeProse(`${edit.before} ${edit.after}`);
  const at = where ? (where.from === where.to ? `line ${where.from}` : `lines ${where.from}–${where.to}`) : null;
  const canAct = made && !!edit.path && !edit.whole && !!edit.after;
  return (
    <div className="edit-card">
      <div className="edit-meta">
        {at && <span>{at}</span>}
        {edit.whole ? (
          <span>
            <span className="plus">+{edit.added}</span> words, the whole file
          </span>
        ) : (
          <span>
            <span className="plus">+{edit.added}</span> <span className="minus">−{edit.removed}</span> words
          </span>
        )}
        {!edit.whole && (
          <button className="edit-toggle link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide change' : 'Show change'}
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
          </button>
        )}
      </div>
      {open && !edit.whole && (
        <div className="edit-diff">
          <DiffText pieces={pieces} prose={prose} />
          {canAct && (
            <div className="edit-actions">
              <button className="small ghost" title="Select the text it wrote, in the editor" onClick={() => void studio.showEdit(edit.path, edit.after)}>
                <Icon name="eye" size={13} />
                Show in editor
              </button>
              <button className="small ghost" title="Put back what this edit replaced (⌘Z brings it back)" onClick={() => void studio.undoEdit(edit.path, edit.before, edit.after)}>
                <Icon name="undo" size={13} />
                Undo this edit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The model's reasoning: its last lines while it streams, then folded to
 * "Waited 12 s · Thought for 4 s". Waiting (the model saying nothing yet:
 * queued, loading, or reasoning it doesn't show) and thinking (its reasoning
 * streaming in) are timed apart, so a slow start doesn't count as thought.
 */
function Thinking({ item }: { item: Extract<ChatItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  const now = useNow(!item.done, 1000);
  const name = useWorkerName();
  if (!item.done) {
    return (
      <div className="thinking live">
        <div className="thinking-head">
          <ActivityGlyph phase="thinking" />
          {waitedPrefix(item)}
          <span className="shimmer">{name} is thinking…</span> <span className="thinking-time">{clockTime(thinkingSoFar(item, now))}</span>
        </div>
        <div className="thinking-tail">
          <div>{item.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="thinking">
      <button className="thinking-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {thoughtHeading(item)}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
      </button>
      {open && <div className="thinking-text">{item.text}</div>}
    </div>
  );
}

type Field = QuestionItem['fields'][number];

/** A question's short name, for tabs and the record: its header, or the start of the question. */
export function questionName(f: Field) {
  if (f.title) return f.title;
  const t = questionText(f).replace(/\s+/g, ' ');
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

/**
 * The question in the chat, once it's answered: what was asked and what you
 * said (asked in a reply, your message below says it). While it waits, a line
 * pointing to the panel.
 */
function QuestionRecord({ item }: { item: QuestionItem }) {
  const questions = item.fields.filter((f) => f.type !== 'external');
  const several = questions.length > 1;
  if (item.state === 'pending' || item.state === 'sending') {
    return (
      <div className="question-waiting">
        <strong>Needs you:</strong> the assistant asks you {several ? `${questions.length} questions` : 'a question'}, below
      </div>
    );
  }
  const head = item.state === 'answered' ? (item.via === 'message' ? 'The assistant asked' : 'You answered') : item.state === 'dismissed' ? `You skipped ${several ? 'the questions' : 'the question'}` : 'Not answered';
  const withAnswers = item.state === 'answered' && item.via !== 'message';
  return (
    <div className={`question-record ${item.state}`}>
      <div className="question-record-head">{head}</div>
      {questions.map((f) => (
        <div key={f.key} className="question-record-row" title={questionText(f)}>
          <span className="question-record-q">{withAnswers ? questionName(f) : questionText(f)}</span>
          {withAnswers && <span className="question-record-a">{answerText(f, item.answer?.[f.key]) ? <MarkdownLine text={answerText(f, item.answer?.[f.key])} /> : <span className="muted">Not answered</span>}</span>}
        </div>
      ))}
    </div>
  );
}

/** A unified diff, line by line: for a patch that isn't book text. */
function Patch({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => !l.startsWith('Index:') && !/^={5,}/.test(l));
  return (
    <pre className="patch">
      {lines.map((l, i) => (
        <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : ''}>
          {l || ' '}
        </div>
      ))}
    </pre>
  );
}

/** A question about something the assistant may not do without asking, in words; what it would change, word by word. */
function PermissionCard({ item }: { item: Extract<ChatItem, { kind: 'permission' }> }) {
  if ((item.action === 'shell' || item.action === 'bash') && !item.local) return <CommandPermission item={item} />;
  return <RequestPermission item={item} />;
}

/** A request that isn't a command: an edit (word by word), a page, a folder outside the book, a setting. */
function RequestPermission({ item }: { item: Extract<ChatItem, { kind: 'permission' }> }) {
  const names = useStore(studio.store, (s) => s.names);
  const assistant = useStore(studio.store, (s) => ASSISTANT_NAMES[s.settings.assistant]);
  const book = useStore(studio.store, (s) => s.workspace?.name ?? 'this book');
  const pending = item.state === 'pending' || item.state === 'sending';
  const { what, code } = describePermission(item.action, item.resources, names);
  const r = item.remembered;
  return (
    <div className={`permission ${pending ? 'pending' : item.state}`}>
      <div className="permission-title">
        {pending ? `${assistant} asks to` : item.state === 'reject' ? 'You didn’t let the assistant' : 'You let the assistant'} {what}
        {r && !r.removed ? `, and allowed ${r.label} ${scopeWords(r.scope, book)}` : ''}.
      </div>
      {r && (
        <div className="perm-remembered">
          <button className="link" onClick={() => void studio.forgetRemembered(item.id, !!r.removed)}>
            {r.removed ? 'Allow for this task again' : 'Undo for the rest of the task'}
          </button>
        </div>
      )}
      {pending && !item.local && (
        <div className="permission-why">
          You chose to be asked first, in{' '}
          <button className="link" onClick={() => studio.openSettings('permissions')}>
            Settings › Permissions
          </button>
          .
        </div>
      )}
      {code && (
        <details className="permission-command">
          <summary>Show the command</summary>
          <pre className="tool-command">{code}</pre>
        </details>
      )}
      {item.patches.map((p) => {
        const changes = patchChanges(p.patch);
        const prose = changes.length > 0 && changes.every((c) => looksLikeProse(`${c.before} ${c.after}`));
        return (
          <div key={p.file} className="permission-file">
            <div className="permission-file-name">
              <FileIcon path={p.file} />
              <span>{p.file}</span>
            </div>
            {prose ? (
              changes.map((c, i) => <PermissionChange key={i} file={p.file} change={c} />)
            ) : (
              <Patch text={p.patch} />
            )}
          </div>
        );
      })}
      {pending && (
        <div className="permission-actions">
          <button className="primary" disabled={item.state === 'sending'} title="Just this once; it asks again next time" onClick={() => void studio.replyPermission(item.id, 'once')}>
            Allow
          </button>
          {!item.local && (
            <button disabled={item.state === 'sending'} title="Allow this kind of request until this task ends; nothing is kept after it" onClick={() => void studio.replyPermission(item.id, 'always')}>
              Allow for this task
            </button>
          )}
          <button className="ghost" disabled={item.state === 'sending'} onClick={() => void studio.replyPermission(item.id, 'reject')}>
            Don’t allow
          </button>
        </div>
      )}
    </div>
  );
}

/** One change a permission asks for, word by word, at its line (from the file when the patch doesn't say). */
function PermissionChange({ file, change }: { file: string; change: { line: number; before: string; after: string } }) {
  const text = useFileText(change.line ? null : file);
  const line = change.line || (text != null ? (linesOf(text, change.before)?.from ?? 0) : 0);
  return (
    <div className="permission-change">
      <span className="permission-line">{line || ''}</span>
      <DiffText pieces={trimPieces(wordPieces(change.before, change.after), 12)} prose />
    </div>
  );
}

/** One step of a turn, by kind; `editOpen`, whether an edit shows its words at once. */
function StepItem({ item, editOpen }: { item: ChatItem; editOpen: boolean }) {
  switch (item.kind) {
    case 'tool':
      return <ToolStep item={item} editOpen={editOpen} />;
    case 'thinking':
      return (
        <Step tone="think" icon="bulb" live={!item.done}>
          <Thinking item={item} />
        </Step>
      );
    case 'question': {
      const pending = item.state === 'pending' || item.state === 'sending';
      return (
        <Step tone={pending ? 'ask' : 'other'} icon={pending ? 'help' : 'check'} live={pending}>
          <QuestionRecord item={item} />
        </Step>
      );
    }
    case 'permission': {
      const pending = item.state === 'pending' || item.state === 'sending';
      return (
        <Step tone={pending ? 'ask' : item.state === 'reject' ? 'other' : 'done'} icon={pending ? 'shield' : item.state === 'reject' ? 'close' : 'check'} live={pending}>
          <PermissionCard item={item} />
        </Step>
      );
    }
    case 'assistant': {
      const text = withoutAddressed(withoutMarker(splitQuestions(item.text).text));
      if (!text.trim()) return null;
      return (
        <Step tone="said" menu={itemMenu(item.text, 'Message')}>
          <div className={`msg assistant md${item.done ? '' : ' streaming'}`}>
            <Markdown text={text} />
          </div>
        </Step>
      );
    }
    case 'notice':
      return (
        <Step tone={item.tone === 'error' ? 'fail' : 'other'} icon={item.tone === 'error' ? 'close' : undefined}>
          <div className={`notice ${item.tone}`}>
            {item.text}
            {item.action && (
              <div className="notice-action">
                <button onClick={() => void (item.action!.resume ? studio.resume() : studio.send(item.action!.prompt ?? ''))}>{item.action.label}</button>
              </div>
            )}
          </div>
        </Step>
      );
    case 'user':
      return null;
  }
}

// ---- the reply -------------------------------------------------------------------------

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>;

/** Options-mode reply: one card per option; picking one replaces the passage in the editor. */
function OptionsReply({ item }: { item: AssistantItem }) {
  const parsed = useMemo(() => parseOptions(item.text), [item.text]);
  const { target, applied } = item.options!;
  if (!parsed.options.some((o) => o.text != null)) {
    return (
      <div className={`msg assistant md${item.done ? '' : ' streaming'}`}>
        <Markdown text={item.text} />
      </div>
    );
  }
  const where = target && `${target.path.split('/').pop()}:${target.start.line}`;
  return (
    <div className="msg assistant options-reply">
      {parsed.intro && (
        <div className="md">
          <Markdown text={parsed.intro} />
        </div>
      )}
      <div className="options-target">{target ? `Pick one to ${target.text ? 'replace' : 'insert at'} ${where}` : 'Nothing was selected: copy the one you want.'}</div>
      {parsed.options.map((o, i) => (
        <div key={i} className={`option-card${applied === i ? ' applied' : ''}`}>
          <div className="option-head">
            <span className="option-n">Option {o.n}</span>
            {o.label && <span className="option-label">{o.label}</span>}
          </div>
          {o.text != null && <pre className={`option-text${o.complete ? '' : ' streaming'}`}>{o.text}</pre>}
          {o.note && (
            <div className="option-note md">
              <Markdown text={o.note} />
            </div>
          )}
          <div className="option-actions">
            {target && (
              <button
                className={applied === i ? '' : 'primary'}
                disabled={!item.done || !o.complete || o.text == null}
                title={applied === i ? 'This option is in the editor (⌘Z to undo)' : `Put this in place of ${where} (⌘Z to undo)`}
                onClick={() => void studio.applyOption(item.id, i)}
              >
                {applied === i ? 'In use ✓' : applied != null ? 'Use this instead' : target.text ? 'Use this' : 'Insert'}
              </button>
            )}
            <button disabled={!o.complete || o.text == null} onClick={() => copyText(o.text ?? '')}>
              Copy
            </button>
          </div>
        </div>
      ))}
      {/* Once one is in use: was that it? */}
      {applied != null && item.taskCheck === 'ask' && <TaskCheck id={item.id} question={`Option ${parsed.options[applied]?.n ?? applied + 1} is in. Is this task done?`} />}
    </div>
  );
}

/** "Is the task done?" under the reply that asks it (or the option picked). */
function TaskCheck({ id, question = 'Is this task done?' }: { id: string; question?: string }) {
  const running = useStore(studio.store, (s) => s.agent.running);
  return (
    <div className="task-check">
      <Icon name="check" size={16} />
      <span className="task-check-words">
        <span className="task-check-question">{question}</span>
        <span className="task-check-hint">A new task starts fresh. This one stays in your list.</span>
      </span>
      <button className="primary" disabled={running} title="Saves your files, keeps a named version in History, and starts a new task" onClick={() => void studio.finishTask()}>
        Yes, it's done
      </button>
      <button disabled={running} title="Keep going in this task" onClick={() => studio.dismissTaskCheck(id)}>
        Not yet
      </button>
    </div>
  );
}

/** Who answered: the assistant's mark and name, its model and effort. */
function Byline({ by }: { by: TurnBy | undefined }) {
  const now = useStore(studio.store, (s) => s.settings.assistant);
  const model = useStore(studio.store, (s) => (s.agent.model ? (s.agent.models.find((m) => m.providerID === s.agent.model!.providerID && m.id === s.agent.model!.id)?.name ?? null) : null));
  const who = by ?? { assistant: now, model, effort: null };
  const more = [who.model, who.effort && `${who.effort.toLowerCase()} effort`].filter(Boolean).join(' · ');
  return (
    <div className="byline">
      <AssistantMark id={who.assistant} size={18} />
      <span className="byline-name">{ASSISTANT_NAMES[who.assistant]}</span>
      {more && <span className="byline-more">{more}</span>}
    </div>
  );
}

/** The reply that ends a turn, under its byline. */
function Reply({ item, by }: { item: AssistantItem; by: TurnBy | undefined }) {
  const text = withoutAddressed(withoutMarker(splitQuestions(item.text).text));
  if (!item.options && !text.trim() && item.taskCheck !== 'ask') return null;
  return (
    <div className="reply" onContextMenu={itemMenu(item.text, 'Message')}>
      <Byline by={by} />
      {item.options ? (
        <OptionsReply item={item} />
      ) : (
        <div className={`msg assistant md${item.done ? '' : ' streaming'}`}>
          <Markdown text={text} />
        </div>
      )}
      {!item.options && item.taskCheck === 'ask' && <TaskCheck id={item.id} />}
    </div>
  );
}

/** While a turn runs: what it's doing now, animated, with the time so far, and Stop. */
function ActivityLine() {
  const running = useStore(studio.store, (s) => s.agent.running);
  const activity = useStore(studio.store, (s) => s.agent.activity);
  // A live thinking block already says "… is thinking".
  const thinkingShown = useStore(studio.store, (s) => {
    const last = s.agent.items[s.agent.items.length - 1];
    return last?.kind === 'thinking' && !last.done;
  });
  const waitingOnYou = useStore(studio.store, (s) => s.agent.items.some((it) => (it.kind === 'permission' || it.kind === 'question') && (it.state === 'pending' || it.state === 'sending')));
  const name = useWorkerName();
  const now = useNow(running);
  if (!running || !activity || (thinkingShown && activity.phase === 'thinking')) return null;
  if (waitingOnYou && activity.phase !== 'asking') return <ActivityCard activity={{ ...activity, phase: 'asking', label: undefined }} name={name} now={now} />;
  return <ActivityCard activity={activity} name={name} now={now} />;
}

function ActivityCard({ activity, name, now }: { activity: Activity; name: string; now: number }) {
  // This step's own time (how long it's been waiting, or thinking, or on this
  // tool), and the turn's when it has had other steps before.
  const { step, total } = stepTimes(activity, now);
  const wait = activity.retryAt ? Math.max(0, Math.ceil((activity.retryAt - now) / 1000)) : 0;
  const words = activityWords(activity, name, step, wait);
  const label = activity.phase === 'asking' || activity.phase === 'retrying' ? words : `${words}…`;
  // A long turn: something worth knowing, under the line (not while it's waiting on you).
  const tip = activity.phase === 'asking' ? null : waitingTip(total, activity.since);
  return (
    <div className={`activity phase-${activity.phase}`}>
      <div className="activity-card">
        <div className="activity-line" role="status" aria-live="polite" title={activity.reason}>
          <ActivityGlyph phase={activity.phase} />
          {/* Keyed by its words, so each new phrase comes in rather than just swapping. */}
          <span key={words} className="activity-label shimmer">
            {label}
          </span>
          <span className="activity-time">{clockTime(step)}</span>
          {total > step && (
            <span className="activity-total" title="Since you sent it">
              {clockTime(total)} in all
            </span>
          )}
        </div>
        <button className="activity-stop small" title="Stop the assistant now" onClick={() => void studio.cancel()}>
          <Icon name="stop" size={11} />
          Stop
        </button>
      </div>
      {tip && (
        <div key={tip} className="activity-tip">
          {tip}
        </div>
      )}
    </div>
  );
}

// ---- turns -----------------------------------------------------------------------------

/** Your message: when you sent it, what you said, and what went with it. */
function UserCard({ item, onFold }: { item: Extract<ChatItem, { kind: 'user' }>; onFold?: () => void }) {
  return (
    <div className="msg user" onContextMenu={itemMenu(item.text, 'Message')}>
      <div className="turn-who">
        You{item.at ? ` · ${clock(item.at)}` : ''}
        {onFold && (
          <button className="turn-fold icon" aria-label="Fold this turn" aria-expanded title="Fold this turn to a line" onClick={onFold}>
            <Icon name="chevronDown" size={13} />
          </button>
        )}
      </div>
      <div className="msg-text">{item.text}</div>
      {item.attachments.length > 0 && (
        <div className="chips">
          {item.attachments.map((a) => {
            const place = attachmentPlace(a);
            return place ? (
              <span key={a} className="chip place-chip" title={a}>
                <FileIcon path={place.path} />
                {basename(place.path)}
                <span className="chip-where">{place.where}</span>
              </span>
            ) : (
              <span key={a} className="chip">
                {a}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** How a finished turn ended: in how long, the History version it made, and copy / try again. */
function TurnFooter({ turn, last }: { turn: Turn; last: boolean }) {
  const stopped = useStore(studio.store, (s) => last && s.agent.stopped);
  const running = useStore(studio.store, (s) => s.agent.running);
  const user = turn.user!;
  const failed = [...turn.steps, ...turn.after].some((it) => it.kind === 'notice' && it.tone === 'error');
  const time = user.at && user.ended ? turnTime(user.ended - user.at) : null;
  const outcome = failed ? 'failed' : stopped ? 'stopped' : 'done';
  const words = outcome === 'done' ? (time ? `Done in ${time}` : 'Done') : outcome === 'stopped' ? `Stopped${time ? ` after ${time}` : ''}` : 'Didn’t finish';
  const reply = turn.reply && withoutMarker(splitQuestions(turn.reply.text).text).trim();
  return (
    <div className={`turn-foot ${outcome}`}>
      <span className="turn-outcome">
        <Icon name={outcome === 'done' ? 'check' : outcome === 'stopped' ? 'stop' : 'close'} size={12} />
        {words}
      </span>
      {user.version && (
        <button className="link" title="What this turn changed, in History" onClick={() => void studio.showVersionChanges(user.version!)}>
          Saved in History
        </button>
      )}
      <span className="spacer" />
      {reply && (
        <button className="icon" aria-label="Copy the reply" title="Copy the reply" onClick={() => copyText(reply)}>
          <Icon name="copy" size={13} />
        </button>
      )}
      {last && (
        <button className="icon" aria-label="Try again" title="Send the same message again" disabled={running} onClick={() => void studio.send(user.text)}>
          <Icon name="retry" size={13} />
        </button>
      )}
    </div>
  );
}

/** An earlier turn, folded to a line: what you asked, and what came of it. */
function FoldedTurn({ turn, onOpen }: { turn: Turn; onOpen: () => void }) {
  const names = useStore(studio.store, (s) => s.names);
  const user = turn.user!;
  const stats = useMemo(() => statsOf([...turn.steps, ...turn.after], names.root, (it) => describeTool(it.name, it.input, names).done), [turn, names]);
  const tone: NodeTone = stats.files.size ? 'change' : stats.looked ? 'look' : stats.failed ? 'fail' : 'said';
  const time = user.at && user.ended ? turnTime(user.ended - user.at) : null;
  // "Read 1 chapter · Answered in 6 s", "Edited 1 file · +4 −14 · Done in 21 s".
  const ended = stats.files.size ? 'Done' : turn.reply ? 'Answered' : '';
  const words = [turnWords(stats, (p) => names.chapters.includes(p)), ended ? `${ended}${time ? ` in ${time}` : ''}` : time].filter(Boolean).join(' · ');
  return (
    <button className="turn-folded" aria-expanded={false} title="Show this turn" onClick={onOpen}>
      <Icon name="chevronRight" size={13} />
      <span className="turn-folded-body">
        <span className="turn-who">You{user.at ? ` · ${clock(user.at)}` : ''}</span>
        <span className="turn-folded-text">{user.text}</span>
        {words && (
          <span className="turn-folded-sum">
            <span className={`turn-dot tone-${tone}`} aria-hidden />
            {words}
          </span>
        )}
      </span>
    </button>
  );
}

/** A turn: your message, the steps on their line, the reply, and how it ended. */
function TurnView({ turn, last, running, onFold }: { turn: Turn; last: boolean; running: boolean; onFold?: () => void }) {
  // The first two edits show their words at once (short ones); the rest fold.
  const editIds = useMemo(() => {
    const open = new Set<string>();
    for (const it of turn.steps) {
      if (it.kind !== 'tool' || toolTone(it) !== 'change' || open.size >= 2) continue;
      const o = (it.input ?? {}) as Record<string, unknown>;
      if (String(o.oldString ?? '').length + String(o.newString ?? '').length < 1600) open.add(it.id);
    }
    return open;
  }, [turn.steps]);
  const steps = turn.steps.filter((it) => it.kind !== 'user');
  return (
    <div className={`turn${last ? ' last' : ''}`}>
      {turn.user && <UserCard item={turn.user} onFold={onFold} />}
      {steps.length > 0 && (
        <ol className="trace" aria-label="What the assistant did">
          {steps.map((it) => (
            <StepItem key={it.id} item={it} editOpen={editIds.has(it.id)} />
          ))}
        </ol>
      )}
      {turn.reply && <Reply item={turn.reply} by={turn.user?.by} />}
      {turn.after.length > 0 && (
        <ol className="trace after">
          {turn.after.map((it) => (
            <StepItem key={it.id} item={it} editOpen={false} />
          ))}
        </ol>
      )}
      {running && last && <ActivityLine />}
      {turn.user && !(running && last) && <TurnFooter turn={turn} last={last} />}
    </div>
  );
}

/** What the task changed, file by file: the words, and where in the file it read and wrote. */
function TaskChanges({ items }: { items: ChatItem[] }) {
  const root = useStore(studio.store, (s) => s.names.root);
  const files = useMemo(() => {
    const out = new Map<string, { added: number; removed: number; edits: Edit[]; reads: { from: number; to: number }[] }>();
    for (const it of items) if (it.kind === 'tool' && toolTone(it) === 'change' && it.status === 'done') {
      const edit = editOf(it, root);
      const path = edit?.path || '';
      if (!path) continue;
      const f = out.get(path) ?? { added: 0, removed: 0, edits: [], reads: [] };
      f.added += edit!.added;
      f.removed += edit!.removed;
      f.edits.push(edit!);
      out.set(path, f);
    }
    for (const it of items) if (it.kind === 'tool' && it.read && out.has(it.read.path)) out.get(it.read.path)!.reads.push(it.read);
    return out;
  }, [items, root]);
  if (!files.size) return null;
  return (
    <section className="task-changes" aria-label="Changed in this task">
      <div className="task-changes-head">
        <span>Changed in this task</span>
        <button className="link" title="Every version, in History" onClick={() => studio.revealSidebar('history')}>
          <Icon name="history" size={13} />
          Review in History
        </button>
      </div>
      {[...files].map(([path, f]) => (
        <ChangedFile key={path} path={path} {...f} />
      ))}
    </section>
  );
}

const ranges = (list: { from: number; to: number }[]) => list.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`)).join(', ');

function ChangedFile({ path, added, removed, edits, reads }: { path: string; added: number; removed: number; edits: Edit[]; reads: { from: number; to: number }[] }) {
  const text = useFileText(path);
  const total = text == null ? 0 : text.split('\n').length;
  const changed = text == null ? [] : edits.flatMap((e) => (e.whole ? [] : (linesOf(text, e.after) ?? [])));
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / Math.max(total, 1)) * 100))}%`;
  return (
    <div className="changed-file">
      <div className="changed-file-row">
        <button className="changed-file-name" title="This file’s versions, in History" onClick={() => void studio.showFileHistory(path)}>
          <FileIcon path={path} />
          <span>{path}</span>
        </button>
        <span className="changed-words">
          <span className="plus">+{added}</span> <span className="minus">−{removed}</span>
        </span>
      </div>
      {total > 0 && (
        <>
          <div className="file-map" role="img" aria-label={`Where in the file: ${reads.length ? `read lines ${ranges(reads)}, ` : ''}changed ${changed.length ? `lines ${ranges(changed)}` : 'text'}, of ${total} lines`}>
            {reads.map((r, i) => (
              <span key={`r${i}`} className="map-read" style={{ left: pct(r.from - 1), width: pct(r.to - r.from + 1) }} />
            ))}
            {changed.map((r, i) => (
              <span key={`c${i}`} className="map-change" style={{ left: pct(r.from - 1), width: pct(r.to - r.from + 1) }} />
            ))}
          </div>
          <div className="file-map-key">
            {reads.length > 0 && (
              <span>
                <i className="key-read" />
                Read {ranges(reads)}
              </span>
            )}
            {changed.length > 0 && (
              <span>
                <i className="key-change" />
                Changed {ranges(changed)}
              </span>
            )}
            <span className="file-map-total">{plural(total, 'line')}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** The conversation: turns (earlier ones folded), then what the task changed. */
export function Transcript() {
  const items = useStore(studio.store, (s) => s.agent.items);
  const running = useStore(studio.store, (s) => s.agent.running);
  const turns = useMemo(() => turnsOf(items), [items]);
  // Opened or folded by hand (keyed by task, so another task starts afresh); otherwise the last turn is open and the others folded.
  const [shown, setShown] = useState<Record<string, boolean>>({});
  return (
    <>
      {turns.map((t, i) => {
        const last = i === turns.length - 1;
        const open = last || !t.user || (shown[t.key] ?? false);
        return open ? (
          <TurnView key={t.key} turn={t} last={last} running={running} onFold={!last && t.user ? () => setShown((s) => ({ ...s, [t.key]: false })) : undefined} />
        ) : (
          <FoldedTurn key={t.key} turn={t} onOpen={() => setShown((s) => ({ ...s, [t.key]: true }))} />
        );
      })}
      {!running && <TaskChanges items={items} />}
    </>
  );
}

// ---- the strip under the header --------------------------------------------------------

/** The style guide, from the strip: open it, or have it written again. */
function StyleGuideMenu() {
  const ready = useStore(studio.store, (s) => s.agent.status === 'ready' && !s.agent.running);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const pick = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  return (
    <div className="style-menu" ref={rootRef}>
      <button className="style-menu-trigger link" aria-haspopup="menu" aria-expanded={open} title="Every message follows your style guide (WRITING_STYLE.md)" onClick={() => setOpen(!open)}>
        <Icon name="check" size={12} />
        Style guide
      </button>
      {open && (
        <div className="style-menu-popover" role="menu">
          <button role="menuitem" onClick={pick(() => void studio.openFile('WRITING_STYLE.md'))}>
            Open WRITING_STYLE.md
          </button>
          <button role="menuitem" className="style-interview" disabled={!ready} title="The assistant asks you how the book should read, and writes the guide again from your answers" onClick={pick(() => void studio.interviewStyleGuide())}>
            Interview me…
          </button>
          <button
            role="menuitem"
            className="style-redraft"
            disabled={!ready}
            title="Not quite right? The assistant drafts it again from your chapters, keeping the rules you wrote or changed yourself. History keeps this one."
            onClick={pick(() => void studio.redraftStyleGuide())}
          >
            Redraft…
          </button>
        </div>
      )}
    </div>
  );
}

/** Under the header: the task at a glance (turns, time, reads, edits, words) and the style guide. */
export function TaskStrip() {
  const items = useStore(studio.store, (s) => s.agent.items);
  const running = useStore(studio.store, (s) => s.agent.running);
  const names = useStore(studio.store, (s) => s.names);
  const guide = useStore(studio.store, (s) => s.styleGuide.exists && s.styleGuide.drafting === null);
  const now = useNow(running, 1000);
  const stats = useMemo(() => statsOf(items, names.root, (it) => describeTool(it.name, it.input, names).done), [items, names]);
  const users = items.filter((it): it is Extract<ChatItem, { kind: 'user' }> => it.kind === 'user');
  if (!users.length && !guide) return null;
  const first = users.find((u) => u.at)?.at;
  const end = running ? now : Math.max(0, ...users.map((u) => u.ended ?? 0));
  let added = 0;
  let removed = 0;
  for (const f of stats.files.values()) {
    added += f.added;
    removed += f.removed;
  }
  return (
    <div className="task-strip">
      {users.length > 0 ? (
        <span className="strip-words">
          {running ? 'Working' : plural(users.length, 'turn')}
          {first && end > first ? ` · ${spanWords(end - first)}` : ''}
        </span>
      ) : (
        <span className="strip-words">Every message follows your style guide.</span>
      )}
      {stats.reads > 0 && (
        <span className="strip-chip tone-look">
          <Icon name="book" size={12} />
          {plural(stats.reads, 'read')}
        </span>
      )}
      {stats.searches > 0 && (
        <span className="strip-chip tone-look">
          <Icon name="search" size={12} />
          {plural(stats.searches, 'search', 'searches')}
        </span>
      )}
      {stats.changed > 0 && (
        <span className="strip-chip tone-change">
          <Icon name="edit" size={12} />
          {plural(stats.changed, 'edit')}
        </span>
      )}
      {stats.files.size > 0 && (
        <span className="strip-chip files" title="Words added and removed">
          {plural(stats.files.size, 'file')}
          <span className="plus">+{added}</span>
          <span className="minus">−{removed}</span>
        </span>
      )}
      <span className="spacer" />
      {guide && <StyleGuideMenu />}
    </div>
  );
}
