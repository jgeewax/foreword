import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { barProgress, COMPACT_BELOW, passageChange, presetsFor, selectionSummary, wordsLabel, type BarKind, type BarProgress, type BarRequest } from '../app/selection-bar';
import { optionsPrompt, revisePrompt } from '../app/stock-prompts';
import { studio } from '../app/studio';
import { looksLikeProse, trimPieces } from '../app/trace';
import { monaco } from '../editor/monaco';
import { modeConfig } from '../services/agent/modes';
import { OPTION_COUNT } from '../services/agent/options-mode';
import { Icon } from './icons';
import { DiffText } from './Trace';

const OPTIONS_GLYPH = modeConfig('options').icon;
const NOT_READY = 'The assistant isn’t ready yet';
const { ABOVE, BELOW } = monaco.editor.ContentWidgetPositionPreference;
/** The passage a request is about, followed through edits: what the assistant writes at its ends is part of it. */
const GROWS = monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges;
/** Where a selection the author made comes from (Monaco's sources, and the preview's mapping in studio.ts). */
const AUTHORS = ['mouse', 'keyboard', 'preview'];

type Act = 'revise' | 'options' | 'explain' | 'comment' | 'ask' | 'fix';

/** The bar under a selection: what you do to a passage, then the chat. In a narrow pane all but the first show only their icons. */
function Bar({ compact, error, ready, act }: { compact: boolean; error: boolean; ready: boolean; act: (what: Act) => void }) {
  const title = (text: string) => (ready ? text : NOT_READY);
  const word = (text: string) => (compact ? null : text);
  const iconOnly = compact ? ' icon-only' : '';
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection">
      {error && (
        <button className="sel-btn sel-fix lead" disabled={!ready} title={title('The assistant explains the error and fixes it')} onClick={() => act('fix')}>
          <Icon name="error" size={14} />
          Fix error
        </button>
      )}
      <button className={`sel-btn sel-revise${error ? '' : ' lead'}`} disabled={!ready} title={title('Change it in place: say how, or pick one of the usual ones')} onClick={() => act('revise')}>
        <Icon name="edit" size={14} />
        Revise
      </button>
      <button className={`sel-btn sel-options${iconOnly}`} disabled={!ready} aria-label={compact ? 'Options' : undefined} title={title(`${OPTION_COUNT} versions of it to pick from`)} onClick={() => act('options')}>
        <span className="sel-glyph" aria-hidden>
          {OPTIONS_GLYPH}
        </span>
        {word('Options')}
      </button>
      <button className={`sel-btn sel-explain${iconOnly}`} disabled={!ready} aria-label={compact ? 'Explain' : undefined} title={title('Explain it in plain words (changes nothing)')} onClick={() => act('explain')}>
        <Icon name="bulb" size={14} />
        {word('Explain')}
      </button>
      <button className={`sel-btn sel-comment${iconOnly}`} aria-label={compact ? 'Comment' : undefined} title="Comment on the selection (⌥⌘M)" onClick={() => act('comment')}>
        <Icon name="comments" size={14} />
        {word('Comment')}
      </button>
      <span className="sel-sep" />
      <button className={`sel-btn sel-ask${iconOnly}`} aria-label={compact ? 'Ask in chat' : undefined} title="Ask about it in the chat (⌘I)" onClick={() => act('ask')}>
        <Icon name="sparkle" size={14} />
        {word('Ask in chat')}
        {!compact && <kbd>⌘I</kbd>}
      </button>
    </div>
  );
}

/** Revise or Options, in place of the bar: say how, or pick one of the usual ones; or take it to the chat. */
function Card(props: {
  kind: BarKind;
  summary: string;
  styleGuide: boolean;
  setKind: (kind: BarKind) => void;
  send: (kind: BarKind, instruction: string) => void;
  toChat: (kind: BarKind, draft: string) => void;
  close: () => void;
}) {
  const { kind, summary, styleGuide, setKind, send, toChat, close } = props;
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const revise = kind === 'revise';
  // Once Monaco has drawn it in its place (it's hidden until then).
  useEffect(() => {
    let tries = 0;
    let frame = 0;
    const focus = () => {
      input.current?.focus();
      if (document.activeElement !== input.current && ++tries < 10) frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [kind]);
  const go = () => draft.trim() && send(kind, draft);
  return (
    <div
      className={`selection-card ${revise ? 'sel-revise' : 'sel-options'}`}
      role="dialog"
      aria-label={revise ? 'Revise the selection' : 'Options for the selection'}
      // The editor's keys stay out of it; Escape closes it.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="sel-card-head">
        <div className="sel-tabs" role="tablist">
          <button role="tab" aria-selected={revise} className="sel-tab sel-revise" onClick={() => setKind('revise')}>
            <Icon name="edit" size={13} />
            Revise
          </button>
          <button role="tab" aria-selected={!revise} className="sel-tab sel-options" onClick={() => setKind('options')}>
            <span className="sel-glyph" aria-hidden>
              {OPTIONS_GLYPH}
            </span>
            Options
          </button>
        </div>
        <span className="spacer" />
        <span className="sel-card-where">{summary}</span>
        <button className="sel-close" aria-label="Close" title="Close (esc)" onClick={close}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <input
        ref={input}
        className="sel-input"
        value={draft}
        placeholder={revise ? 'How should it change?' : 'What should the options try?'}
        aria-label={revise ? 'How should it change?' : 'What should the options try?'}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          go();
        }}
      />
      <div className="sel-presets">
        {presetsFor(kind, styleGuide).map((p) => (
          <button key={p.label} className="sel-preset" title={p.instruction} onClick={() => send(kind, p.instruction)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="sel-card-foot">
        <button className="sel-to-chat" title="Take it to the chat, with the passage, to say more" onClick={() => toChat(kind, draft)}>
          <Icon name="sparkle" size={13} />
          Continue in chat
        </button>
        <span className="spacer" />
        <span className="sel-hint">esc to close</span>
        <button className="sel-go" disabled={!draft.trim()} onClick={go}>
          {revise ? 'Revise' : `Show ${OPTION_COUNT} options`}
          <kbd>⏎</kbd>
        </button>
      </div>
    </div>
  );
}

type Change = ReturnType<typeof passageChange>;

/** How a request from the bar is getting on, under its passage: it waits, it works, it's done (and can be undone). */
function Note(props: {
  kind: BarKind;
  progress: BarProgress;
  change: Change;
  showChange: boolean;
  toggleChange: () => void;
  undo: () => void;
  dismiss: () => void;
  /** Held back for a reply in another mode: it's not sent after all. */
  callOff: () => void;
}) {
  const { kind, progress, change, showChange, toggleChange, undo, dismiss, callOff } = props;
  const revise = kind === 'revise';
  const chat = () => studio.events.emit('show-agent-pane');
  if (progress.phase === 'queued') {
    // In the assistant's queue (it can read it now), or held back until a reply in another mode ends (no id).
    const queued = !!progress.id;
    return (
      <div className="selection-note" role="status">
        <span className="sel-note-icon queued">
          <Icon name="history" size={14} />
        </span>
        <span>{revise ? 'Revise waits for the current reply' : 'Options wait for the current reply'}</span>
        <span className="sel-sep" />
        {queued && (
          <button className="sel-btn" disabled={progress.sending} title="The assistant reads it at its next step" onClick={() => void studio.steerQueued(progress.id)}>
            Send now
          </button>
        )}
        <button className="sel-btn sel-quiet" disabled={progress.sending} onClick={() => (queued ? void studio.unqueue(progress.id) : callOff())}>
          Cancel
        </button>
      </div>
    );
  }
  if (progress.phase === 'working') {
    return (
      <div className={`selection-note ${revise ? 'sel-revise' : 'sel-options'}`} role="status">
        <span className="sel-spin" aria-hidden />
        <span>{revise ? 'Revising…' : `Writing ${OPTION_COUNT} options…`}</span>
        <button className="sel-btn sel-quiet sel-in-chat" title="Show the chat" onClick={chat}>
          in the chat
        </button>
        <span className="sel-sep" />
        <button className="sel-btn sel-quiet" onClick={() => void studio.cancel()}>
          <Icon name="stop" size={12} />
          Stop
        </button>
      </div>
    );
  }
  if (progress.phase === 'options') {
    return (
      <div className="selection-note sel-options" role="status">
        <span className="sel-glyph" aria-hidden>
          {OPTIONS_GLYPH}
        </span>
        <span>{OPTION_COUNT} options are in the chat</span>
        <span className="sel-sep" />
        <button className="sel-btn" onClick={chat}>
          Pick one
        </button>
        <button className="sel-btn sel-quiet" onClick={dismiss}>
          Keep mine
        </button>
      </div>
    );
  }
  if (!revise || !change) {
    return (
      <div className="selection-note" role="status">
        <span>{revise ? 'The passage is as it was' : 'No options came back'}</span>
        <span className="sel-sep" />
        <button className="sel-btn" onClick={chat}>
          See the chat
        </button>
        <button className="sel-btn sel-quiet" aria-label="Close" onClick={dismiss}>
          <Icon name="close" size={12} />
        </button>
      </div>
    );
  }
  const prose = looksLikeProse(change.pieces.map((p) => p.text).join(''));
  return (
    <div className={`selection-note done${showChange ? ' open' : ''}`} role="status">
      <div className="sel-note-row">
        <span className="sel-note-icon ok">
          <Icon name="check" size={14} />
        </span>
        <span>Revised</span>
        <span className="sel-words">{wordsLabel(change.words)}</span>
        <span className="sel-sep" />
        <button className="sel-btn sel-quiet" title="Put the passage back as it was (⌘Z brings the revision back)" onClick={undo}>
          <Icon name="undo" size={14} />
          Undo
        </button>
        <button className="sel-btn sel-revise" aria-expanded={showChange} onClick={toggleChange}>
          <Icon name="eye" size={14} />
          {showChange ? 'Hide change' : 'Show change'}
        </button>
      </div>
      {showChange && <DiffText pieces={trimPieces(change.pieces, 12)} prose={prose} />}
    </div>
  );
}

/** A widget's place under a range: its end, or the end of its last line when it ends at the start of the next. */
function endOf(model: monaco.editor.ITextModel, r: monaco.IRange): monaco.IPosition {
  if (r.endColumn === 1 && r.endLineNumber > r.startLineNumber) return { lineNumber: r.endLineNumber - 1, column: model.getLineMaxColumn(r.endLineNumber - 1) };
  return { lineNumber: r.endLineNumber, column: r.endColumn };
}

/** Clicks keep the editor's focus and selection (but the card's box takes the keys). */
const keepFocus = (e: MouseEvent) => {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
};

/**
 * The selection bar: under a selection after a moment, Revise, Options,
 * Explain, Comment and Ask in chat (Fix error first over a Typst error).
 * Revise and Options open a card in its place. A request sent from it gets a
 * note under its passage while it waits and works, and when it's done: the
 * words it changed, and Undo. Returns its cleanup.
 */
export function attachSelectionBar(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  // ---- the bar, or its card, under the selection ----
  const barNode = document.createElement('div');
  barNode.className = 'selection-widget';
  barNode.onmousedown = keepFocus;
  const barRoot = createRoot(barNode);
  let view: { kind: 'bar' } | { kind: 'card'; tab: BarKind } | null = null;
  let anchor: monaco.IPosition | null = null;
  let barKey = '';
  let showTimer: number | undefined;
  const barWidget: monaco.editor.IContentWidget = {
    getId: () => 'studio.selectionBar',
    getDomNode: () => barNode,
    getPosition: () => (view && anchor ? { position: anchor, preference: [BELOW, ABOVE] } : null),
  };
  editor.addContentWidget(barWidget);

  const selection = () => {
    const sel = editor.getSelection();
    return sel && !sel.isEmpty() ? sel : null;
  };
  const barNow = () => {
    if (!view) return null;
    const ready = studio.state.agent.status === 'ready';
    if (view.kind === 'bar') {
      const sel = selection();
      return <Bar compact={editor.getLayoutInfo().contentWidth < COMPACT_BELOW} error={!!sel && !!studio.errorIn(sel)} ready={ready} act={act} />;
    }
    const sel = selection();
    const model = editor.getModel();
    const summary = sel && model ? selectionSummary(sel.startLineNumber, endOf(model, sel).lineNumber, model.getValueInRange(sel)) : '';
    return <Card key="card" kind={view.tab} summary={summary} styleGuide={studio.state.styleGuide.exists} setKind={openCard} send={send} toChat={toChat} close={close} />;
  };
  // At once, so Monaco measures it and puts it below the line (or above, at the bottom of the pane);
  // from the store, whose updates can come mid-render, on the next frame.
  const renderBar = (now = true) => {
    barKey = keyOfBar();
    if (!now) {
      barRoot.render(barNow());
      requestAnimationFrame(() => editor.layoutContentWidget(barWidget));
      return;
    }
    flushSync(() => barRoot.render(barNow()));
    editor.layoutContentWidget(barWidget);
  };
  const keyOfBar = () => `${view?.kind}:${view?.kind === 'card' ? view.tab : ''}:${studio.state.agent.status}:${studio.state.styleGuide.exists}`;
  const showBar = (next: typeof view) => {
    clearTimeout(showTimer);
    const sel = selection();
    const model = editor.getModel();
    view = next && sel && model ? next : null;
    anchor = sel && model ? endOf(model, sel) : null;
    renderBar();
  };
  const hideBar = () => {
    clearTimeout(showTimer);
    if (view) showBar(null);
  };
  function openCard(tab: BarKind) {
    showBar({ kind: 'card', tab });
  }
  function close() {
    hideBar();
    editor.focus();
  }
  function act(what: Act) {
    if (what === 'revise' || what === 'options') return openCard(what);
    const sel = selection();
    hideBar();
    if (what === 'explain') void studio.explainSelection();
    else if (what === 'comment') void studio.addComment();
    else if (what === 'ask') void studio.askAboutSelection();
    else if (what === 'fix' && sel) {
      const error = studio.errorIn(sel);
      if (error) void studio.fixProblem(error);
    }
  }
  function toChat(kind: BarKind, draft: string) {
    hideBar();
    void studio.continueInChat(kind, draft);
  }

  // ---- a request sent from it, followed under its passage ----
  type Tracked = {
    req: BarRequest;
    model: monaco.editor.ITextModel;
    decoration: string;
    pending: boolean;
    original: string;
    /** Until Studio has sent it (it may wait for a reply in another mode). */
    starting: boolean;
    abort: AbortController;
    showChange: boolean;
  };
  let tracked: Tracked | null = null;
  let noteKey = '';
  const noteNode = document.createElement('div');
  noteNode.className = 'selection-widget';
  noteNode.onmousedown = keepFocus;
  const noteRoot = createRoot(noteNode);
  const rangeOf = (t: Tracked) => t.model.getDecorationRange(t.decoration);
  const noteWidget: monaco.editor.IContentWidget = {
    getId: () => 'studio.selectionNote',
    getDomNode: () => noteNode,
    getPosition: () => {
      const range = tracked && editor.getModel() === tracked.model ? rangeOf(tracked) : null;
      return tracked && range && noteKey ? { position: endOf(tracked.model, range), preference: [BELOW, ABOVE] } : null;
    },
  };
  editor.addContentWidget(noteWidget);
  const decorate = (t: Tracked, pending: boolean) => {
    const range = rangeOf(t);
    if (!range || t.pending === pending) return;
    t.pending = pending;
    const options: monaco.editor.IModelDecorationOptions = { stickiness: GROWS, ...(pending ? { inlineClassName: 'sel-pending' } : {}) };
    t.decoration = t.model.deltaDecorations([t.decoration], [{ range, options }])[0];
  };
  function untrack() {
    if (!tracked) return;
    tracked.abort.abort();
    if (!tracked.model.isDisposed()) tracked.model.deltaDecorations([tracked.decoration], []);
    tracked = null;
    noteKey = '';
    flushSync(() => noteRoot.render(null));
    editor.layoutContentWidget(noteWidget);
  }
  function undo() {
    const t = tracked;
    const range = t && editor.getModel() === t.model ? rangeOf(t) : null;
    if (!t || !range) return;
    editor.pushUndoStop();
    editor.executeEdits('undo-revise', [{ range, text: t.original, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    const start = range.getStartPosition();
    untrack();
    editor.setSelection(monaco.Range.fromPositions(start, t.model.getPositionAt(t.model.getOffsetAt(start) + t.original.length)));
    editor.focus();
  }
  /** The note as things are now; only redrawn when what it says changes (not at each word the assistant streams). */
  function renderNote(now = true) {
    const t = tracked;
    if (!t) return;
    if (t.model.isDisposed()) return untrack();
    let progress = barProgress(studio.state.agent, t.req);
    // Not in the chat yet: held back while a reply runs, or on its way.
    if (progress.phase === 'gone' && t.starting) progress = studio.state.agent.running ? { phase: 'queued', id: '', sending: false } : { phase: 'working' };
    const range = rangeOf(t);
    if (progress.phase === 'gone' || (progress.phase === 'options' && progress.picked) || !range) return untrack();
    decorate(t, progress.phase === 'queued' || progress.phase === 'working');
    const change = progress.phase === 'ended' ? passageChange(t.original, t.model.getValueInRange(range)) : null;
    const key = JSON.stringify([progress, change?.words, change && t.model.getValueInRange(range), t.showChange]);
    if (key === noteKey) return;
    noteKey = key;
    const note = (
      <Note
        kind={t.req.kind}
        progress={progress}
        change={change}
        showChange={t.showChange}
        toggleChange={() => {
          t.showChange = !t.showChange;
          renderNote();
        }}
        undo={undo}
        dismiss={untrack}
        callOff={untrack}
      />
    );
    if (!now) {
      noteRoot.render(note);
      requestAnimationFrame(() => editor.layoutContentWidget(noteWidget));
      return;
    }
    flushSync(() => noteRoot.render(note));
    editor.layoutContentWidget(noteWidget);
  }
  /** Revise or Options from the card: the passage is followed (a decoration) while the chat works on it. */
  async function send(kind: BarKind, instruction: string) {
    const sel = selection();
    const model = editor.getModel();
    if (!sel || !model) return;
    hideBar();
    editor.focus();
    untrack();
    const req: BarRequest = { kind, message: kind === 'revise' ? revisePrompt(instruction) : optionsPrompt(instruction), since: Date.now() };
    const decoration = model.deltaDecorations([], [{ range: sel, options: { stickiness: GROWS } }])[0];
    const t: Tracked = { req, model, decoration, pending: false, original: model.getValueInRange(sel), starting: true, abort: new AbortController(), showChange: false };
    tracked = t;
    renderNote();
    const { signal } = t.abort;
    const sent = await (kind === 'revise' ? studio.reviseSelection(instruction, signal) : studio.optionsForSelection(instruction, signal));
    if (tracked !== t) return;
    t.starting = false;
    if (sent) renderNote();
    else untrack();
  }

  // ---- when they show and go ----
  const subs = [
    editor.onDidChangeCursorSelection((e) => {
      clearTimeout(showTimer);
      if (view) showBar(null);
      // The author's own selections, in the editor or the preview: not one Foreword makes (a chat chip, a search, Show in editor), nor an edit moving it.
      if (e.selection.isEmpty() || !AUTHORS.includes(e.source)) return;
      showTimer = window.setTimeout(() => {
        if (selection() && !studio.state.review.draft) showBar({ kind: 'bar' });
      }, 450);
    }),
    // Typing: the bar goes, and so does a finished request's note.
    editor.onKeyDown((e) => {
      if (view?.kind === 'bar') hideBar();
      if (tracked && !tracked.starting && !['Meta', 'Shift', 'Alt', 'Control'].includes(e.browserEvent.key)) {
        const phase = barProgress(studio.state.agent, tracked.req).phase;
        if (phase !== 'queued' && phase !== 'working') untrack();
      }
    }),
    editor.onDidChangeModelContent(() => {
      if (view?.kind === 'bar') hideBar();
      if (tracked && editor.getModel() === tracked.model) {
        renderNote();
        editor.layoutContentWidget(noteWidget);
      }
    }),
    editor.onDidChangeModel(() => {
      hideBar();
      noteKey = '';
      renderNote();
      editor.layoutContentWidget(noteWidget);
    }),
    editor.onDidLayoutChange(() => view?.kind === 'bar' && renderBar()),
  ];
  // The assistant getting ready or going to work, the reply that answers a request, the style guide appearing.
  const offStore = studio.store.subscribe(() => {
    if (view && (studio.state.review.draft || keyOfBar() !== barKey)) {
      if (studio.state.review.draft) view = null;
      renderBar(false);
    }
    if (tracked) renderNote(false);
  });
  // The context menu's Revise… and Options…, and the commands.
  const offCard = studio.events.on('selection-card', (kind) => selection() && openCard(kind));
  return () => {
    clearTimeout(showTimer);
    untrack();
    for (const s of subs) s.dispose();
    offStore();
    offCard();
    editor.removeContentWidget(barWidget);
    editor.removeContentWidget(noteWidget);
    queueMicrotask(() => {
      barRoot.unmount();
      noteRoot.unmount();
    });
  };
}
