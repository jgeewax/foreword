// Scripted end-to-end check run inside the real app (WKWebView, Tinymist,
// OpenCode) when TYPST_STUDIO_SELFTEST=<out.json> is set. Never saves files;
// agent edit requests are rejected.
import { studio } from './app/studio';
import { monaco } from './editor/monaco';
import { errorMessage, ipc, type LaunchOptions } from './lib/ipc';
import { afterNextPaint, clock, LatencyStats } from './lib/perf';
import { parseOptions } from './services/agent/options-mode';
import { TEMPLATES } from './templates';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (step: string) => void ipc.uiLog(`[selftest +${Math.round(performance.now())}ms] ${step}`);

/** Resolves after the next painted frame, or false after `ms` (occluded windows get no frames). */
function nextPaint(ms = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    afterNextPaint(() => !done && ((done = true), resolve(true)));
    setTimeout(() => !done && ((done = true), resolve(false)), ms);
  });
}

async function waitFor<T>(probe: () => T | null | undefined | false, timeout: number, what: string): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

// ---- preview inspection (runs inside the preview webview, reports back over IPC) ----

const REPORT_JS = (tag: string) => `(() => {
  const c = document.getElementById('typst-container-main');
  const pages = [...document.querySelectorAll('svg.typst-doc > g.typst-page')];
  const info = pages.map((g, i) => {
    const r = g.getBoundingClientRect();
    return { i, mode: (g.getAttribute('data-tid') || '').startsWith('canvas') ? 'C' : 'S', top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  window.__TAURI_INTERNALS__.invoke('preview_report', { report: {
    tag: ${JSON.stringify(tag)},
    scrollTop: c ? Math.round(c.scrollTop) : null,
    scrollHeight: c ? c.scrollHeight : null,
    modes: info.map((p) => p.mode).join(''),
    visible: info.filter((p) => p.bottom > 0 && p.top < innerHeight).map((p) => (p.i + 1) + p.mode).join(' '),
    idleShim: String(window.requestIdleCallback).includes('setTimeout'),
  } });
})();`;

async function previewState(tag: string): Promise<Record<string, unknown>> {
  const { listen } = await import('@tauri-apps/api/event');
  let resolve!: (v: Record<string, unknown>) => void;
  const result = new Promise<Record<string, unknown>>((r) => (resolve = r));
  const off = await listen<Record<string, unknown>>('preview:report', (e) => e.payload?.tag === tag && resolve(e.payload));
  await ipc.previewEval(REPORT_JS(tag));
  const report = await Promise.race([result, sleep(3000).then(() => ({ tag, error: 'no report from preview' }))]);
  off();
  return report;
}

const scrollPreview = (expr: string) =>
  ipc.previewEval(`(() => { const c = document.getElementById('typst-container-main'); if (c) c.scrollTop = ${expr}; })();`);

/** Scroll the preview and sync in both directions, with snapshots of what is actually painted. */
async function previewChecks(chapter: string, editor: monaco.editor.IStandaloneCodeEditor) {
  const states: Record<string, unknown>[] = [];
  const snapshots: string[] = [];
  const snap = async (name: string) => {
    try {
      snapshots.push(await ipc.previewSnapshot(name));
    } catch (e) {
      snapshots.push(`${name}: ${errorMessage(e)}`);
    }
  };
  const step = async (name: string) => {
    await snap(name);
    states.push(await previewState(name));
  };

  // Scrolling: pages must be in order and never blank, without any click.
  await step('p1-top');
  await scrollPreview('c.scrollHeight');
  await sleep(150);
  await step('p2-bottom-150ms');
  await sleep(250);
  await step('p2b-bottom-400ms');
  await sleep(1250);
  await step('p3-bottom-settled');
  await scrollPreview('0');
  await sleep(150);
  await step('p4-top-150ms');
  await sleep(250);
  await step('p4b-top-400ms');
  await sleep(1250);
  await step('p5-top-settled');

  // Source → preview: cursor to the end, then the start, of the chapter.
  let jumps = 0;
  const { listen } = await import('@tauri-apps/api/event');
  const offJumps = await listen<{ tag?: string }>('preview:report', (e) => void (e.payload?.tag === 'jump' && jumps++));
  const jumpCount = () => {
    const n = jumps;
    jumps = 0;
    return n;
  };
  const model = editor.getModel()!;
  const last = model.getLineCount();
  editor.setPosition({ lineNumber: last, column: model.getLineMaxColumn(last) });
  await sleep(1500);
  await step('p6-cursor-at-end');
  states[states.length - 1].jumps = jumpCount();
  editor.setPosition({ lineNumber: 1, column: 3 });
  await sleep(1500);
  await step('p7-cursor-at-start');
  states[states.length - 1].jumps = jumpCount();
  offJumps();

  // Preview → source: click on rendered text in the middle of the preview.
  editor.setPosition({ lineNumber: 1, column: 1 });
  await sleep(300);
  const before = editor.getPosition();
  await ipc.previewEval(`(() => {
    const texts = [...document.querySelectorAll('.typst-text')].filter((t) => { const r = t.getBoundingClientRect(); return r.top > innerHeight * 0.3 && r.bottom < innerHeight * 0.9 && r.width > 20; });
    const t = texts[Math.floor(texts.length / 2)];
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  })();`);
  await sleep(1500);
  const after = editor.getPosition();
  const clickToSource = {
    before: before && `${before.lineNumber}:${before.column}`,
    after: after && `${after.lineNumber}:${after.column}`,
    activeFile: studio.state.active,
    selection: editor.getModel()?.getValueInRange(editor.getSelection()!).slice(0, 80),
    moved: !!after && !!before && (after.lineNumber !== before.lineNumber || studio.state.active !== chapter),
  };
  await snap('p8-after-click');
  return { states, snapshots, clickToSource };
}

/**
 * Project settings (TODO #5): .typst-studio.json from the Settings UI. Writes
 * files, so only with TYPST_STUDIO_SELFTEST_EDITS=1 on a scratch book that has
 * an alt.typ entry and a .typst-studio.json with an unknown "custom" key.
 */
async function projectSettingsChecks() {
  const out: Record<string, unknown> = {};
  const raw = async () => JSON.parse((await ipc.fsRead('.typst-studio.json')).text);
  const compiled = async () => {
    await sleep(500);
    await waitFor(() => studio.state.preview.status !== 'starting' && studio.state.compile.status === 'ok', 30000, 'compile').catch(() => {});
    await sleep(800);
    return studio.state.compile.pages;
  };
  out.initial = { settings: studio.state.project.settings, entry: studio.state.workspace?.entry, pages: await compiled() };

  studio.openSettings();
  await sleep(500);
  out.sectionShown = !!document.querySelector('#project-entry');
  try {
    out.snapshot = await ipc.previewSnapshot('project-settings', 'main');
  } catch (e) {
    out.snapshot = errorMessage(e);
  }
  studio.closeSettings();

  // Output folder + export.
  out.setOutput = await studio.updateProjectSettings({ outputDir: 'dist' });
  await compiled();
  await studio.exportPdf();
  out.exportToast = studio.state.toast?.text;
  out.pdfWritten = (await ipc.fsHash('dist/main.pdf')) !== null;

  // Validation: refused, file unchanged.
  const before = await raw();
  out.badOutputErrors = await studio.updateProjectSettings({ outputDir: '../outside' });
  out.unchangedAfterBadValue = JSON.stringify(await raw()) === JSON.stringify(before);

  // Entry point switch recompiles from the new file.
  out.setEntry = await studio.updateProjectSettings({ entryPoint: 'alt.typ' });
  out.afterEntrySwitch = { entry: studio.state.workspace?.entry, pages: await compiled() };
  out.fileAfter = await raw();

  // External edit of the file is picked up (and restarts on the main file again).
  const current = await ipc.fsRead('.typst-studio.json');
  await ipc.fsWrite('.typst-studio.json', JSON.stringify({ ...JSON.parse(current.text), entryPoint: 'main.typ' }, null, 2) + '\n', current.hash);
  await sleep(1500);
  out.afterExternalEdit = { entry: studio.state.workspace?.entry, pages: await compiled(), settingsEntry: studio.state.project.settings.entryPoint };
  return out;
}

/** Ask the agent something and return its last reply (no tools expected). */
async function askAgent(text: string): Promise<string> {
  await studio.send(text);
  await sleep(1000);
  await waitFor(() => !studio.state.agent.running, 120000, text).catch(() => {});
  const replies = studio.state.agent.items.filter((i) => i.kind === 'assistant');
  return replies.length ? (replies[replies.length - 1] as { text: string }).text : '';
}

/** Writing style guide (TODO #10). Writes WRITING_STYLE.md: scratch book only. */
async function styleGuideChecks() {
  const out: Record<string, unknown> = {};
  await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
  out.initial = { exists: studio.state.styleGuide.exists, setupBarShown: !!document.querySelector('.style-bar.setup') };
  try {
    out.snapshotSetup = await ipc.previewSnapshot('style-setup', 'main');
  } catch (e) {
    out.snapshotSetup = errorMessage(e);
  }

  await studio.createStyleGuideFromTemplate();
  await sleep(500);
  out.fromTemplate = {
    exists: studio.state.styleGuide.exists,
    openedInEditor: studio.state.active === 'WRITING_STYLE.md',
    firstLine: studio.editor?.getModel()?.getLineContent(1),
    barShowsFile: document.querySelector('.style-bar .link')?.textContent,
  };

  // The user fills in the guide; the agent follows it.
  const write = async (codeword: string) => {
    const cur = await ipc.fsRead('WRITING_STYLE.md');
    const text = cur.text.replace(/## Words and spelling\n[^#]*/, `## Words and spelling\nAlways use British spelling. In this book the reader is always addressed by the codeword "${codeword}".\n\n`);
    await ipc.fsWrite('WRITING_STYLE.md', text, cur.hash);
  };
  await write('Sparrow');
  await sleep(1500);
  studio.newSession();
  const q = 'Without using any tools: according to my writing style guide, what codeword is the reader addressed by? Reply with just the word.';
  out.firstAnswer = await askAgent(q);
  const sid = studio.state.agent.sessionId!;
  out.instructionKeys = (await studio.agent!.getInstructions(sid)).map((e) => e.key);

  // Change the guide mid-conversation: the session picks it up.
  await write('Heron');
  await sleep(2500);
  out.updateNotice = studio.state.agent.items.filter((i) => i.kind === 'notice').map((i) => (i as any).text).pop();
  out.secondAnswer = await askAgent(q);

  // Drafting from the manuscript: reads chapters, asks questions, changes no chapter.
  const chapterHash = await ipc.fsHash('chapters/ch2-eigenvalues.typ');
  studio.newSession();
  const from = studio.state.agent.items.length;
  await studio.draftStyleGuide();
  await sleep(1000);
  await waitFor(() => !studio.state.agent.running, 180000, 'draft').catch(() => {});
  const items = studio.state.agent.items.slice(from);
  const reply = items.filter((i) => i.kind === 'assistant').map((i) => (i as any).text).join('\n');
  out.draft = {
    tools: items.filter((i) => i.kind === 'tool').map((i) => `${(i as any).name} ${(i as any).summary}`),
    asksQuestions: (reply.match(/\?/g) ?? []).length,
    replyStart: reply.slice(0, 400),
    chapterUnchanged: (await ipc.fsHash('chapters/ch2-eigenvalues.typ')) === chapterHash,
  };
  return out;
}

/** Agent replies render as Markdown (headings, lists, emphasis, code, math kept verbatim). */
async function markdownChecks() {
  await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
  studio.newSession();
  const reply = await askAgent(
    'Without reading or changing any files, reply using Markdown: a "###" heading "Checklist", a numbered list of two items where the first has a **bold** word, ' +
      'one bulleted item containing the inline code `#set page()`, a sentence with the Typst math $a_i + b_i$, and a fenced ```typst code block with `= Intro`.',
  );
  await sleep(300);
  const msg = [...document.querySelectorAll('.msg.assistant')].pop();
  const out: Record<string, unknown> = {
    replyStart: reply.slice(0, 400),
    rawMarkersVisible: /(^|\n)#{1,6} |\*\*/.test(msg?.textContent ?? ''),
    heading: !!msg?.querySelector('h3,h4,h5,h6'),
    orderedItems: msg?.querySelectorAll('ol > li').length ?? 0,
    bulletItems: msg?.querySelectorAll('ul > li').length ?? 0,
    strong: !!msg?.querySelector('strong'),
    inlineCode: [...(msg?.querySelectorAll('code:not(.md-math)') ?? [])].map((c) => c.textContent),
    math: [...(msg?.querySelectorAll('code.md-math') ?? [])].map((c) => c.textContent),
    codeBlock: msg?.querySelector('pre.md-code')?.textContent ?? null,
    noScriptOrLinks: !msg?.querySelector('script,a,iframe,img'),
  };
  try {
    out.snapshot = await ipc.previewSnapshot('markdown', 'main');
  } catch (e) {
    out.snapshot = errorMessage(e);
  }
  return out;
}

/**
 * Options mode (TODO #6): three versions of a selected sentence, applied as
 * undoable buffer edits. Never saves, and restores the buffer. Scratch book only.
 */
async function optionsChecks() {
  const out: Record<string, unknown> = {};
  const file = 'chapters/ch2-eigenvalues.typ';
  await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
  studio.newSession();
  await studio.setMode('options');
  await studio.openFile(file);
  const editor = studio.editor!;
  const model = editor.getModel()!;
  const original = model.getValue();
  const diskBefore = await ipc.fsHash(file);
  const line = model.getLinesContent().findIndex((l) => /^The eigenvalues of/.test(l)) + 1;
  const sentence = model.getLineContent(line);
  editor.setSelection(new monaco.Range(line, 1, line, model.getLineMaxColumn(line)));
  await sleep(300);

  // No ⌘I: Options mode attaches the editor selection itself.
  const reply = await askAgent('Make this sentence more inviting for a reader meeting eigenvalues for the first time.');
  await sleep(300);
  const user = [...studio.state.agent.items].reverse().find((i) => i.kind === 'user') as { attachments: string[] } | undefined;
  const item = [...studio.state.agent.items].reverse().find((i) => i.kind === 'assistant' && i.options) as any;
  const parsed = parseOptions(reply);
  out.reply = {
    attachments: user?.attachments,
    target: item?.options?.target,
    options: parsed.options.map((o) => ({ n: o.n, label: o.label, complete: o.complete, text: o.text })),
    keepsMath: parsed.options.every((o) => o.text?.includes('$A$')),
    tools: studio.state.agent.items.filter((i) => i.kind === 'tool').map((i) => `${(i as any).name} → ${(i as any).status}`),
    cards: document.querySelectorAll('.option-card').length,
    diskUnchanged: (await ipc.fsHash(file)) === diskBefore,
  };
  try {
    out.snapshot = await ipc.previewSnapshot('options', 'main');
  } catch (e) {
    out.snapshot = errorMessage(e);
  }
  if (!item || parsed.options.length < 3) return out;

  const lineText = () => model.getValueInRange(new monaco.Range(line, 1, line + 20, 1));
  const has = (n: number) => lineText().startsWith(parsed.options[n].text!);
  const click = async (n: number) => {
    (document.querySelectorAll('.option-card')[n]?.querySelector('.option-actions button') as HTMLButtonElement | null)?.click();
    await sleep(400);
  };
  await click(1);
  out.useSecond = { inBuffer: has(1), sentenceGone: !model.getValue().includes(sentence), dirty: !!studio.state.dirty[file], button: document.querySelectorAll('.option-card')[1]?.querySelector('button')?.textContent };
  await click(2);
  out.switchToThird = { inBuffer: has(2), secondGone: !model.getValue().includes(parsed.options[1].text!) };
  editor.trigger('selftest', 'undo', null);
  editor.trigger('selftest', 'undo', null);
  await sleep(200);
  out.undoTwice = { originalBack: model.getValue() === original };
  await click(0);
  out.useFirstAfterUndo = { inBuffer: has(0) };
  try {
    out.snapshotApplied = await ipc.previewSnapshot('options-applied', 'main');
  } catch (e) {
    out.snapshotApplied = errorMessage(e);
  }
  for (let i = 0; i < 20 && model.getValue() !== original && model.canUndo(); i++) editor.trigger('selftest', 'undo', null);
  await sleep(300);
  out.restored = { buffer: model.getValue() === original, dirty: !!studio.state.dirty[file], diskUnchanged: (await ipc.fsHash(file)) === diskBefore };
  await studio.setMode('write');
  return out;
}

/**
 * History (TODO #8): automatic versions, the panel and diff, restores, and
 * undoing an agent turn. Writes files: scratch book only.
 */
async function historyChecks(withAgent: boolean) {
  const out: Record<string, unknown> = {};
  const h = studio.history;
  const hs = () => studio.state.history;
  await waitFor(() => ['ready', 'unavailable'].includes(hs().status), 30000, 'history');
  out.start = { status: hs().status, error: hs().error, versions: hs().versions.length, latest: hs().versions[0] && { kind: hs().versions[0].kind, label: hs().versions[0].label } };
  if (hs().status !== 'ready') return out;
  const savedConfirm = h.confirm;
  h.confirm = async () => true;
  const file = 'chapters/ch1-vectors.typ';
  await studio.openFile(file);
  const editor = studio.editor!;
  const model = editor.getModel()!;
  const original = model.getValue();
  const disk = async () => (await ipc.fsRead(file)).text;
  const lastToast = () => studio.state.toast?.text ?? '';

  // A save becomes a version once things are quiet.
  const count = hs().versions.length;
  const end = model.getFullModelRange().getEndPosition();
  editor.executeEdits('selftest', [{ range: monaco.Range.fromPositions(end), text: '\nA sentence added by the history self-test.\n' }]);
  const edited = model.getValue();
  await studio.save(file);
  const t0 = clock();
  await waitFor(() => hs().versions.length > count && hs().versions[0].kind === 'save', 30000, 'save version').catch(() => {});
  const saveVersion = hs().versions[0];
  out.saveVersion = { label: saveVersion?.label, kind: saveVersion?.kind, files: saveVersion?.files, added: saveVersion?.added, afterMs: Math.round(clock() - t0) };
  const before = hs().versions[1];

  // Panel: expand the version, open the file's diff.
  studio.showSidebar('history');
  await sleep(400);
  (document.querySelector('.history-row') as HTMLElement | null)?.click();
  await waitFor(() => hs().open?.changes != null, 10000, 'changes').catch(() => {});
  await sleep(200);
  out.panel = { rows: document.querySelectorAll('.history-row').length, files: [...document.querySelectorAll('.history-file .history-path')].map((e) => e.textContent) };
  (document.querySelector('.history-file') as HTMLElement | null)?.click();
  await waitFor(() => !!hs().diff, 10000, 'diff').catch(() => {});
  await sleep(1200);
  out.diff = {
    open: !!hs().diff,
    path: hs().diff?.path,
    beforeIsOriginal: hs().diff?.before === original,
    afterIsEdited: hs().diff?.after === edited,
    monacoDiff: !!document.querySelector('.history-diff .monaco-diff-editor'),
    insertedLines: document.querySelectorAll('.history-diff .line-insert, .history-diff .char-insert').length,
  };
  try {
    out.snapshotDiff = await ipc.previewSnapshot('history-diff', 'main');
  } catch (e) {
    out.snapshotDiff = errorMessage(e);
  }
  h.closeDiff();
  await sleep(200);

  // Restore the version before the edit: the file (and its open buffer) go back.
  await h.restoreVersion(before);
  await sleep(500);
  out.restoreVersion = {
    disk: (await disk()) === original,
    buffer: model.getValue() === original,
    dirty: !!studio.state.dirty[file],
    latest: { kind: hs().versions[0]?.kind, label: hs().versions[0]?.label },
    toast: lastToast(),
  };

  // One file from a version (as the diff's "Restore this file" does).
  await h.restoreFile(saveVersion, file);
  await sleep(500);
  out.restoreFile = { disk: (await disk()) === edited, buffer: model.getValue() === edited, toast: lastToast() };

  // Unsaved edits are never overwritten.
  editor.pushUndoStop();
  editor.executeEdits('selftest', [{ range: monaco.Range.fromPositions(model.getFullModelRange().getEndPosition()), text: 'unsaved' }]);
  const dirtyText = model.getValue();
  await h.restoreVersion(before);
  await sleep(300);
  out.unsavedBlocks = { buffer: model.getValue() === dirtyText, disk: (await disk()) === edited, toast: lastToast() };
  editor.pushUndoStop();
  model.undo();
  await sleep(100);
  out.undoneTyping = { buffer: model.getValue() === edited, dirty: !!studio.state.dirty[file] };
  await h.restoreVersion(before);
  await sleep(300);
  out.cleanAgain = { disk: (await disk()) === original, dirty: !!studio.state.dirty[file] };

  if (withAgent) {
    await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
    const policy = studio.state.settings.agentEdits;
    studio.updateSettings({ agentEdits: 'allow' });
    await studio.setMode('write');
    studio.newSession();
    const textBefore = await disk();
    await askAgent(`Add one short sentence at the very end of ${file} saying that vectors can also be added geometrically, tip to tail. Edit the file directly.`);
    await sleep(1500);
    await waitFor(() => hs().versions[0]?.kind === 'agent', 15000, 'agent version').catch(() => {});
    const agentVersion = hs().versions[0];
    const agentChanged = (await disk()) !== textBefore;
    out.agentTurn = { latest: { kind: agentVersion?.kind, label: agentVersion?.label, files: agentVersion?.files }, fileChanged: agentChanged };
    if (agentVersion?.kind === 'agent') {
      studio.showSidebar('history');
      await sleep(300);
      try {
        out.snapshotPanel = await ipc.previewSnapshot('history-panel', 'main');
      } catch (e) {
        out.snapshotPanel = errorMessage(e);
      }
      await h.undoVersion(agentVersion);
      await sleep(500);
      out.undoAgent = { disk: (await disk()) === textBefore, buffer: model.getValue() === textBefore, latest: hs().versions[0]?.label, toast: lastToast() };
    }
    studio.updateSettings({ agentEdits: policy });
  }
  h.confirm = savedConfirm;
  studio.showSidebar('files');
  return out;
}

/**
 * Book templates (TODO #12): create a book from each template next to the
 * scratch workspace, open it, and check it compiles and previews. Then reopen
 * the original workspace.
 */
async function templateChecks() {
  const out: Record<string, unknown> = {};
  const original = studio.state.workspace!.root;
  const parent = original.slice(0, original.lastIndexOf('/'));
  const stamp = Date.now().toString(36);
  studio.openNewBook();
  await sleep(500);
  out.dialog = { open: !!document.querySelector('.new-book'), cards: document.querySelectorAll('.template-card').length };
  try {
    out.snapshotDialog = await ipc.previewSnapshot('new-book', 'main');
  } catch (e) {
    out.snapshotDialog = errorMessage(e);
  }
  studio.closeNewBook();
  const books: Record<string, unknown> = {};
  for (const t of TEMPLATES) {
    const title = `Selftest ${t.id} ${stamp} "quoted"`;
    try {
      await studio.createBook(t.id, { title, author: 'Ada Example' }, parent);
      await waitFor(() => studio.state.preview.status === 'ready' && studio.state.compile.status === 'ok', 60000, `${t.id} compile`).catch(() => {});
      await sleep(1500);
      books[t.id] = {
        root: studio.state.workspace?.root,
        active: studio.state.active,
        firstFileOpen: studio.state.active === t.firstFile,
        compile: studio.state.compile,
        problems: studio.state.problems,
        styleGuide: studio.state.styleGuide.exists,
        history: { status: studio.state.history.status, versions: studio.state.history.versions.map((v) => v.label) },
        snapshot: await ipc.previewSnapshot(`template-${t.id}`, 'preview').catch(errorMessage),
      };
    } catch (e) {
      books[t.id] = { error: errorMessage(e) };
    }
  }
  out.books = books;
  // The same title again: refused, nothing overwritten.
  try {
    await studio.createBook('blank', { title: `Selftest blank ${stamp} "quoted"`, author: 'x' }, parent);
    out.duplicate = 'created (unexpected)';
  } catch (e) {
    out.duplicate = errorMessage(e);
  }
  studio.closeNewBook();
  await studio.openWorkspace(original);
  return out;
}

/**
 * Onboarding (TODO #11): the Typst basics guide (in the pane and on the
 * welcome screen), inserting examples, the chat starter, and jumping to /
 * fixing a Typst error with the assistant. Edits a chapter: scratch book only.
 */
async function onboardingChecks() {
  const out: Record<string, unknown> = {};
  const file = 'chapters/ch1-vectors.typ';
  await studio.openFile(file);
  const editor = studio.editor!;
  const model = editor.getModel()!;
  const original = model.getValue();

  // Guide in the right-hand pane; examples go in at the cursor.
  studio.openGuide();
  await sleep(400);
  const button = (title: string, label: string) =>
    [...document.querySelectorAll('.guide-item')].find((e) => e.querySelector('h3')?.textContent === title)?.querySelector<HTMLButtonElement>(`.guide-actions button:${label === 'Insert' ? 'first-child' : 'last-child'}`);
  out.guide = {
    inPane: !!document.querySelector('.agent-pane .guide'),
    sections: document.querySelectorAll('.guide-section').length,
    items: document.querySelectorAll('.guide-item').length,
    insertButtons: [...document.querySelectorAll('.guide-actions button')].filter((b) => b.textContent === 'Insert').length,
  };
  try {
    out.snapshotGuide = await ipc.previewSnapshot('guide', 'main');
  } catch (e) {
    out.snapshotGuide = errorMessage(e);
  }
  const line = model.getLinesContent().findIndex((l) => /^A vector in/.test(l)) + 1;
  editor.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
  button('Footnotes', 'Insert')?.click();
  await sleep(200);
  out.insertInline = { lineEndsWith: model.getLineContent(line).endsWith('The letter was never sent.#footnote[It is now in the county archive.]') };
  editor.trigger('selftest', 'undo', null);
  editor.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
  button('A new page', 'Insert')?.click();
  await sleep(200);
  out.insertBlock = { ownParagraph: model.getValue().includes(`${model.getLineContent(line)}\n\n#pagebreak()\n`) };
  editor.trigger('selftest', 'undo', null);
  await sleep(200);
  out.undoRestores = model.getValue() === original;
  studio.closeGuide();
  await sleep(200);

  // Chat starter: suggestions fill the composer.
  studio.newSession();
  await sleep(300);
  const suggestions = [...document.querySelectorAll<HTMLButtonElement>('.starter .suggestion')];
  suggestions[1]?.click();
  await sleep(300);
  const composer = document.querySelector<HTMLTextAreaElement>('.composer textarea');
  out.starter = { shown: !!document.querySelector('.starter'), suggestions: suggestions.length, filled: composer?.value === suggestions[1]?.textContent };
  studio.events.emit('fill-composer', '');
  try {
    out.snapshotStarter = await ipc.previewSnapshot('starter', 'main');
  } catch (e) {
    out.snapshotStarter = errorMessage(e);
  }

  // A Typst error: the status bar jumps to it, and the assistant fixes it.
  const policy = studio.state.settings.agentEdits;
  studio.updateSettings({ agentEdits: 'allow' });
  await studio.setMode('write');
  editor.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
  editor.trigger('selftest', 'type', { text: ' See #undefined-thing here.' });
  await waitFor(() => studio.state.problems.errors > 0, 15000, 'error').catch(() => {});
  editor.setPosition({ lineNumber: 1, column: 1 });
  await sleep(300);
  document.querySelector<HTMLButtonElement>('.statusbar .problems .link.bad')?.click();
  await sleep(500);
  const sel = editor.getSelection();
  out.problem = {
    errors: studio.state.problems.errors,
    statusText: document.querySelector('.statusbar .problems')?.textContent,
    jumpedTo: sel && { line: sel.startLineNumber, text: model.getValueInRange(sel) },
  };
  try {
    out.snapshotProblem = await ipc.previewSnapshot('problem', 'main');
  } catch (e) {
    out.snapshotProblem = errorMessage(e);
  }
  if (studio.state.agent.status === 'ready') {
    await studio.fixProblem();
    await sleep(1000);
    await waitFor(() => !studio.state.agent.running, 180000, 'fix').catch(() => {});
    await sleep(2500);
    const replies = studio.state.agent.items.filter((i) => i.kind === 'assistant');
    out.fix = {
      sent: (studio.state.agent.items.find((i) => i.kind === 'user') as any)?.text,
      attachments: (studio.state.agent.items.find((i) => i.kind === 'user') as any)?.attachments,
      reply: (replies[replies.length - 1] as any)?.text?.slice(0, 400),
      errorsAfter: studio.state.problems.errors,
      lineAfter: model.getLineContent(line),
    };
  }
  studio.updateSettings({ agentEdits: policy });

  // Welcome screen and the guide as a dialog there.
  const root = studio.state.workspace!.root;
  await (studio as any).closeWorkspace();
  await sleep(500);
  out.welcome = { shown: !!document.querySelector('.welcome'), setupRows: document.querySelectorAll('.setup li').length, learn: !!document.querySelector('.welcome-learn') };
  try {
    out.snapshotWelcome = await ipc.previewSnapshot('welcome', 'main');
  } catch (e) {
    out.snapshotWelcome = errorMessage(e);
  }
  studio.openGuide();
  await sleep(300);
  out.welcomeGuide = !!document.querySelector('.guide-modal .guide');
  studio.closeGuide();
  await studio.openWorkspace(root);
  return out;
}

async function snap(name: string, target: 'main' | 'preview' = 'main') {
  try {
    return await ipc.previewSnapshot(name, target);
  } catch (e) {
    return errorMessage(e);
  }
}

/** History below the files (layout option). Restores the author's setting. */
async function layoutChecks() {
  const saved = studio.state.settings.historyPlacement;
  studio.updateSettings({ historyPlacement: 'below' });
  await sleep(500);
  const out: Record<string, unknown> = {
    below: {
      stacked: !!document.querySelector('.explorer .sidebar-stack'),
      files: !!document.querySelector('.sidebar-stack .tree .tree-row'),
      history: document.querySelectorAll('.sidebar-stack .history-row').length,
    },
    snapshot: await snap('history-below'),
  };
  document.querySelector<HTMLButtonElement>('.sidebar-stack button[aria-label="Show History in its own tab"]')?.click();
  await sleep(300);
  out.backToTab = { placement: studio.state.settings.historyPlacement, tabShown: studio.state.sidebar === 'history', stacked: !!document.querySelector('.sidebar-stack') };
  studio.updateSettings({ historyPlacement: saved });
  studio.showSidebar('files');
  return out;
}

/** Plan mode (TODO #9), with auto-edit ON to prove plan mode still blocks edits. Scratch book only. */
async function planModeChecks() {
  const out: Record<string, unknown> = {};
  const file = 'chapters/ch2-eigenvalues.typ';
  const savedPolicy = studio.state.settings.agentEdits;
  await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
  studio.updateSettings({ agentEdits: 'allow' });
  studio.newSession();
  await studio.setMode('plan');
  const hashBefore = await ipc.fsHash(file);

  const plan = await askAgent('Plan a short new section for chapter 2 about the trace of a matrix and how it relates to the eigenvalues.');
  const sid = studio.state.agent.sessionId!;
  const session = (await ipc.agentRequest('GET', `/api/session/${sid}`)).body?.data;
  out.plan = {
    agent: session?.agent,
    instructionKeys: (await studio.agent!.getInstructions(sid)).map((e) => e.key),
    numberedOutline: /^\s*(\d+[.)]|#+\s*\d)/m.test(plan),
    endsWithQuestion: /\?\s*(\*\*)?\s*$/.test(plan.trim()) || /\?[^?]{0,200}$/.test(plan.trim()),
    replyStart: plan.slice(0, 500),
    fileUnchanged: (await ipc.fsHash(file)) === hashBefore,
  };
  await sleep(300);
  out.writeItButtonShown = !!document.querySelector('.plan-actions button');
  try {
    out.snapshot = await ipc.previewSnapshot('plan-mode', 'main');
  } catch (e) {
    out.snapshot = errorMessage(e);
  }

  // Asked to write while still planning: nothing changes.
  const from = studio.state.agent.items.length;
  const pushy = await askAgent(`Go ahead and add that section to ${file} right now.`);
  const items = studio.state.agent.items.slice(from);
  out.writeWhilePlanning = {
    tools: items.filter((i) => i.kind === 'tool').map((i) => `${(i as any).name} → ${(i as any).status}${(i as any).status === 'failed' ? `: ${(i as any).detail}` : ''}`),
    fileUnchanged: (await ipc.fsHash(file)) === hashBefore,
    reply: pushy.slice(0, 300),
  };

  // "Write it": back to write mode, and the plan gets written.
  await studio.writeFromPlan();
  await sleep(1000);
  await waitFor(() => !studio.state.agent.running, 180000, 'write from plan').catch(() => {});
  await sleep(1500);
  const after = (await ipc.fsRead(file)).text;
  out.writeIt = {
    mode: studio.state.agent.mode,
    agent: (await ipc.agentRequest('GET', `/api/session/${sid}`)).body?.data?.agent,
    fileChanged: (await ipc.fsHash(file)) !== hashBefore,
    mentionsTrace: /trace/i.test(after),
    addedLines: after.split('\n').length,
  };
  studio.updateSettings({ agentEdits: savedPolicy });
  return out;
}

/**
 * Edit setting (TODO #7). Makes real edits, so it only runs with
 * TYPST_STUDIO_SELFTEST_EDITS=1 against a scratch copy of a book.
 */
async function editPolicyChecks() {
  const out: Record<string, unknown> = {};
  const savedPolicy = studio.state.settings.agentEdits;
  const file = 'chapters/ch1-vectors.typ';
  const heading = async () => (await ipc.fsRead(file)).text.split('\n')[0];
  await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
  studio.updateSettings({ agentEdits: 'ask' });
  studio.newSession();
  out.headingBefore = await heading();

  const turn = async (text: string) => {
    const from = studio.state.agent.items.length;
    await studio.send(text);
    await sleep(1000);
    // Stop at a permission card or the end of the turn.
    await waitFor(() => !studio.state.agent.running || studio.state.agent.items.slice(from).some((i) => i.kind === 'permission' && i.state === 'pending'), 120000, text).catch(() => {});
    return studio.state.agent.items.slice(from);
  };

  // 1. Ask mode: a permission card appears; rejecting leaves the file alone.
  const askItems = await turn(`In ${file}, change the first line's heading text "Vectors" to "Vectors (ask test)". Use your edit tool. Change nothing else.`);
  const card = askItems.find((i) => i.kind === 'permission');
  out.askMode = { permissionCard: card ? { action: (card as any).action, resources: (card as any).resources, hasPatch: (card as any).patches?.length > 0 } : null };
  if (card) await studio.replyPermission(card.id, 'reject');
  await waitFor(() => !studio.state.agent.running, 60000, 'turn end after reject').catch(() => {});
  await sleep(1000);
  (out.askMode as any).headingAfterReject = await heading();

  // 2. Switch to automatic mid-conversation: the next edit lands without a prompt.
  studio.updateSettings({ agentEdits: 'allow' });
  await sleep(800);
  out.switchNotice = studio.state.agent.items.filter((i) => i.kind === 'notice').map((i) => (i as any).text).pop();
  const autoItems = await turn(`Now do it: in ${file}, change the first line's heading text "Vectors" to "Vectors (auto test)". Use your edit tool. Change nothing else.`);
  await sleep(1500);
  out.allowMode = {
    permissionCards: autoItems.filter((i) => i.kind === 'permission').length,
    tools: autoItems.filter((i) => i.kind === 'tool').map((i) => `${(i as any).name} → ${(i as any).status}`),
    headingAfter: await heading(),
  };
  // The open buffer (if any) follows the file on disk.
  await studio.openFile(file);
  await sleep(500);
  (out.allowMode as any).editorFirstLine = studio.editor?.getModel()?.getLineContent(1);

  studio.updateSettings({ agentEdits: savedPolicy });
  return out;
}

/** Searchable model picker (TODO #3). Restores the user's model choice afterwards. */
async function modelPickerChecks() {
  const out: Record<string, unknown> = {};
  await waitFor(() => studio.state.agent.models.length > 20, 30000, 'model list').catch(() => {});
  const saved = { model: localStorage.getItem('studio.model'), recent: localStorage.getItem('studio.recentModels'), state: studio.state.agent.model, recentState: studio.state.agent.recentModels };
  const trigger = document.querySelector<HTMLButtonElement>('.model-trigger')!;
  trigger.click();
  await sleep(400);
  const input = document.querySelector<HTMLInputElement>('.model-search');
  out.opened = !!input;
  out.searchFocused = document.activeElement === input;
  out.sections = [...document.querySelectorAll('.model-section')].map((e) => e.textContent);
  out.optionCount = document.querySelectorAll('.model-option').length;
  out.disabledCount = document.querySelectorAll('.model-option.disabled').length;
  try {
    out.snapshotOpen = await ipc.previewSnapshot('model-picker', 'main');
  } catch (e) {
    out.snapshotOpen = errorMessage(e);
  }
  // Search, then keyboard-select the second match.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'glm');
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  out.glmMatches = [...document.querySelectorAll('.model-option')].map((e) => e.querySelector('.model-option-name')?.textContent);
  const key = (k: string) => input!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key('ArrowDown');
  await sleep(100);
  out.highlighted = document.querySelector('.model-option.highlighted .model-option-name')?.textContent;
  key('Enter');
  await sleep(800);
  out.closedAfterSelect = !document.querySelector('.model-popover');
  out.selected = studio.state.agent.model;
  out.recentFirst = studio.state.agent.recentModels[0];
  out.triggerLabel = document.querySelector('.model-trigger-name')?.textContent;
  // Escape closes without changing anything.
  trigger.click();
  await sleep(300);
  document.querySelector('.model-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(200);
  out.escapeCloses = !document.querySelector('.model-popover');
  // Restore the user's choice.
  if (saved.model === null) localStorage.removeItem('studio.model');
  else localStorage.setItem('studio.model', saved.model);
  if (saved.recent === null) localStorage.removeItem('studio.recentModels');
  else localStorage.setItem('studio.recentModels', saved.recent);
  studio.store.set((s) => ({ agent: { ...s.agent, model: saved.state, recentModels: saved.recentState } }));
  return out;
}

/** Settings dialog hides the native preview; the composer honours the send-key setting (TODO #2). */
async function settingsChecks() {
  const out: Record<string, unknown> = {};
  const saved = studio.state.settings;
  studio.openSettings();
  await sleep(500);
  out.previewHiddenWhileOpen = (await ipc.nativeGeometry('preview').catch(() => ({}) as Record<string, unknown>)).webviewHidden;
  out.dialogShown = !!document.querySelector('.modal.settings');
  try {
    out.snapshot = await ipc.previewSnapshot('settings-main', 'main');
  } catch (e) {
    out.snapshot = errorMessage(e);
  }
  studio.closeSettings();
  await sleep(500);
  out.previewHiddenAfterClose = (await ipc.nativeGeometry('preview').catch(() => ({}) as Record<string, unknown>)).webviewHidden;

  // Drive the real composer; record send() calls instead of messaging the model.
  const sent: string[] = [];
  const realSend = studio.send.bind(studio);
  studio.send = async (text: string) => (sent.push(text), true);
  const box = document.querySelector<HTMLTextAreaElement>('.composer textarea')!;
  const type = (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const press = (init: KeyboardEventInit) => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
  const trial = async (sendKey: 'enter' | 'mod-enter') => {
    studio.updateSettings({ sendKey });
    await sleep(100);
    const r: Record<string, number> = {};
    for (const [name, init] of [['enter', {}], ['shiftEnter', { shiftKey: true }], ['cmdEnter', { metaKey: true }]] as const) {
      type(`hello ${name}`);
      await sleep(50);
      const n = sent.length;
      press(init);
      await sleep(50);
      r[name] = sent.length - n;
    }
    r.hint = (document.querySelector('.composer-footer .hint')?.textContent ?? '') as unknown as number;
    return r;
  };
  out.enterMode = await trial('enter');
  out.modEnterMode = await trial('mod-enter');
  studio.send = realSend;
  type('');
  studio.updateSettings(saved);
  return out;
}

/** UI zoom: native zoom applied, preview webview still exactly over its pane. Restores the user's zoom. */
async function zoomChecks() {
  const original = studio.state.zoom;
  const out: Record<string, unknown>[] = [];
  for (const z of [1.25, 0.8]) {
    await studio.setZoom(z, { persist: false });
    await sleep(700);
    const frames = await ipc.webviewFrames();
    const r = document.querySelector('.preview-body')!.getBoundingClientRect();
    const inset = studio.viewportInset;
    const expected = { x: inset.left + r.left * z, y: inset.top + r.top * z, width: r.width * z, height: r.height * z };
    const p = frames.preview;
    const maxOffset = p
      ? Math.max(Math.abs(p.x - expected.x), Math.abs(p.y - expected.y), Math.abs(p.width - expected.width), Math.abs(p.height - expected.height))
      : null;
    let snapshot = '';
    try {
      snapshot = await ipc.previewSnapshot(`z${Math.round(z * 100)}-main`, 'main');
    } catch (e) {
      snapshot = errorMessage(e);
    }
    const app = document.querySelector('.app')!.getBoundingClientRect();
    out.push({
      zoom: z,
      applied: studio.state.zoom,
      cssViewportWidth: innerWidth,
      mainFrameWidth: frames.main?.width,
      // vertical fit: main webview frame vs the page's own viewport and app height (in points)
      mainFrameHeight: frames.main?.height,
      windowInner: frames['window-inner'],
      windowOuter: frames['window-outer'],
      viewportHeightPt: innerHeight * z,
      appHeightPt: app.height * z,
      preview: p,
      expected,
      maxOffset,
      snapshot,
    });
  }
  await studio.setZoom(original, { persist: false });
  return out;
}

const summary = (s: LatencyStats) => ({
  n: s.count,
  p50: s.percentile(50),
  p95: s.percentile(95),
  max: s.percentile(100),
});

export async function runSelftest(launch: LaunchOptions) {
  const result: Record<string, any> = { startedAt: new Date().toISOString(), msSinceNavigationAtInit: Math.round(performance.now()) };
  const only = launch.selftestOnly?.split(',').map((x) => x.trim());
  const want = (group: string) => !only || only.includes(group);
  try {
    log('start');
    const ws = await waitFor(() => studio.state.workspace, 30000, 'workspace');
    log(`workspace ${ws.root}`);
    result.workspace = ws.root;
    await waitFor(() => ['ready', 'error'].includes(studio.state.preview.status), 60000, 'preview');
    result.preview = { ...studio.state.preview, readyAtMs: Math.round(performance.now()) };
    log(`preview ${studio.state.preview.status}`);
    if (studio.state.preview.status === 'error') throw new Error(`preview: ${studio.state.preview.error}`);

    // Open a chapter from the middle of the book.
    const entry = (await ipc.fsRead(ws.entry!)).text;
    const includes = [...entry.matchAll(/#include\s+"([^"]+)"/g)].map((m) => m[1]);
    const chapter = includes[Math.floor(includes.length / 2)] ?? ws.entry!;
    await studio.openFile(chapter);
    const editor = studio.editor!;
    const model = editor.getModel()!;
    const original = model.getValue();
    const diskBefore = await ipc.fsHash(chapter);
    const line = model.getLinesContent().findIndex((l) => /^[A-Za-z]/.test(l)) + 1;
    await sleep(1500);
    if (want('preview')) {
      log('preview checks');
      result.previewChecks = await previewChecks(chapter, editor);
    }

    if (want('geometry')) {
      log('geometry');
      const body = document.querySelector('.preview-body')!.getBoundingClientRect();
      result.geometry = {
        main: await ipc.nativeGeometry('main').catch(errorMessage),
        preview: await ipc.nativeGeometry('preview').catch(errorMessage),
        frames: await ipc.webviewFrames(),
        previewBodyCss: { x: body.left, y: body.top, width: body.width, height: body.height },
        cssViewport: { width: innerWidth, height: innerHeight },
        zoom: studio.state.zoom,
        inset: studio.viewportInset,
      };
      {
        // Native check, independent of Tauri's coordinates: AppKit frames are bottom-up.
        const g = result.geometry;
        const win = (g.main as any)?.windowFrame?.[1];
        const pf = (g.preview as any)?.webviewFrame;
        if (win && pf) {
          const previewTop = win - (pf[1] + pf[3]);
          const bodyTop = studio.viewportInset.top + body.top * studio.state.zoom;
          result.geometry.previewTopVsPane = { previewTopPt: previewTop, paneBodyTopPt: bodyTop, offBy: previewTop - bodyTop };
        }
      }
    }
    if (want('zoom')) {
      log('zoom checks');
      result.zoomChecks = await zoomChecks();
    }
    if (want('settings')) {
      log('settings checks');
      result.settingsChecks = await settingsChecks();
    }
    if (want('models')) {
      log('model picker checks');
      result.modelPickerChecks = await modelPickerChecks();
    }

    if (want('typing')) {
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.revealLineInCenter(line);
      editor.focus();
      await sleep(2000);

      // Isolated keystrokes through Monaco's typing pipeline.
      log(`typing into ${chapter}:${line}`);
      studio.perf.editToPreview.clear();
      const editorPaint = new LatencyStats();
      let missedPaints = 0;
      for (let i = 0; i < 20; i++) {
        const t = clock();
        editor.trigger('selftest', 'type', { text: 'x' });
        if (await nextPaint()) editorPaint.add(clock() - t);
        else missedPaints++;
        await sleep(500);
      }
      result.missedPaints = missedPaints;
      const isolated = { editorPaint: summary(editorPaint), editToPreview: summary(studio.perf.editToPreview) };

      // Burst at ~100 wpm; the compiled word count proves the unsaved text reached Tinymist.
      log('burst');
      await sleep(800);
      const wordsBefore = studio.state.compile.words ?? null;
      studio.perf.editToPreview.clear();
      const burstPaint = new LatencyStats();
      for (const ch of ' selftest words reach the live preview ') {
        const t = clock();
        editor.trigger('selftest', 'type', { text: ch });
        afterNextPaint(() => burstPaint.add(clock() - t));
        await sleep(60);
      }
      await sleep(2000);
      const wordsAfter = studio.state.compile.words ?? null;
      const burst = { editorPaint: summary(burstPaint), editToPreview: summary(studio.perf.editToPreview), wordsBefore, wordsAfter };

      // Undo everything: the buffer returns to its saved state; nothing was written.
      log('undo');
      for (let i = 0; i < 500 && model.canUndo(); i++) await model.undo();
      await sleep(800);
      result.typing = {
        chapter,
        isolated,
        burst,
        restored: model.getValue() === original,
        dirtyAfterUndo: !!studio.state.dirty[chapter],
        diskUntouched: (await ipc.fsHash(chapter)) === diskBefore,
      };
    }

    if (want('layout')) {
      log('layout');
      result.layout = await layoutChecks();
    }
    if (launch.selftestAgent && want('agent')) {
      log('agent');
      result.agent = await agentTurn(chapter, line);
    }
    if (launch.selftestAgent && want('markdown')) {
      log('markdown');
      result.markdown = await markdownChecks();
    }
    if (launch.selftestEdits && want('project')) {
      log('project settings');
      result.projectSettings = await projectSettingsChecks();
    }
    if (launch.selftestEdits && launch.selftestAgent) {
      if (want('style')) {
        log('style guide');
        result.styleGuide = await styleGuideChecks();
      }
      if (want('onboarding')) {
        log('onboarding');
        result.onboarding = await onboardingChecks();
      }
      if (want('templates')) {
        log('templates');
        result.templates = await templateChecks();
      }
      if (want('history')) {
        log('history');
        result.history = await historyChecks(true);
      }
      if (want('options')) {
        log('options mode');
        result.options = await optionsChecks();
      }
      if (want('plan')) {
        log('plan mode');
        result.planMode = await planModeChecks();
      }
      if (want('edits')) {
        log('edit policy');
        result.editPolicy = await editPolicyChecks();
      }
    }
    result.perfHud = studio.state.perf;
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = errorMessage(e);
  }
  result.finishedAt = new Date().toISOString();
  log(`finish ok=${result.ok} ${result.error ?? ''}`);
  await ipc.selftestFinish(result);
}

async function agentTurn(chapter: string, line: number) {
  const out: Record<string, any> = {};
  await waitFor(() => ['ready', 'error'].includes(studio.state.agent.status), 60000, 'agent');
  if (studio.state.agent.status === 'error') return { error: studio.state.agent.error };

  // Prefer a LiteLLM model (custom provider route); the list fills in lazily.
  const pick = () => {
    const ms = studio.state.agent.models;
    return ms.find((m) => m.providerID === 'litellm' && m.id === 'gemini-3.8-flash') ?? ms.find((m) => m.providerID === 'litellm' && m.supportsTools);
  };
  const model = await waitFor(
    () => {
      if (!pick()) void studio.loadModels();
      return pick();
    },
    30000,
    'a LiteLLM model',
  ).catch(() => studio.state.agent.model);
  if (model) await studio.selectModel(model);
  out.model = studio.state.agent.model;
  out.modelCount = studio.state.agent.models.length;

  // Select exactly two lines and attach them (what ⌘I does).
  const editor = studio.editor!;
  const m = editor.getModel()!;
  editor.setSelection(new monaco.Selection(line, 1, line + 1, m.getLineMaxColumn(line + 1)));
  await studio.attachSelection();
  out.attachments = studio.state.agent.attachments.map((a) => a.label);

  let firstDelta: number | null = null;
  const tools: string[] = [];
  const tSend = clock();
  const off = studio.agent!.subscribe((e) => {
    if (e.type === 'text-delta' && firstDelta == null) firstDelta = clock() - tSend;
    if (e.type === 'tool-started') tools.push(e.name);
    if (e.type === 'permission-asked') void studio.replyPermission(e.requestId, 'reject');
  });
  out.sent = await studio.send('Use your read tool to read this file, then explain the selected lines in one sentence. Do not edit anything.');
  await sleep(1000);
  await waitFor(() => !studio.state.agent.running, 180000, 'agent turn to finish').catch((e) => (out.waitError = errorMessage(e)));
  off();
  const items = studio.state.agent.items;
  out.firstTextDeltaMs = firstDelta;
  out.turnMs = Math.round(clock() - tSend);
  out.tools = tools;
  out.toolResults = items.filter((i) => i.kind === 'tool').map((i) => (i.kind === 'tool' ? `${i.name} ${i.summary} → ${i.status}` : ''));
  out.reply = items.filter((i) => i.kind === 'assistant').map((i) => (i.kind === 'assistant' ? i.text : '')).join('\n');
  out.notices = items.filter((i) => i.kind === 'notice').map((i) => (i.kind === 'notice' ? i.text : ''));
  out.chapterDiskUnchanged = !studio.state.dirty[chapter];

  // The session carries the writing-assistant instructions (TODO #4).
  const sid = studio.state.agent.sessionId;
  if (sid) {
    const entries = await studio.agent!.getInstructions(sid).catch((e) => [{ key: 'error', value: errorMessage(e) }]);
    out.instructions = entries.map((e) => ({ key: e.key, length: String(e.value).length, writingAssistant: String(e.value).includes('writing assistant') }));
    // And the model sees itself as working on a book (no tools needed).
    await studio.send('Without using any tools, answer in one short sentence: what kind of project is this, and are you here to write software?');
    await sleep(1000);
    await waitFor(() => !studio.state.agent.running, 120000, 'framing question').catch(() => {});
    const replies = studio.state.agent.items.filter((i) => i.kind === 'assistant');
    out.framingReply = replies.length ? (replies[replies.length - 1] as { text: string }).text : null;

    // Never compile (TODO #1): a natural question, then a direct attempt.
    const lastReply = () => {
      const r = studio.state.agent.items.filter((i) => i.kind === 'assistant');
      return r.length ? (r[r.length - 1] as { text: string }).text : '';
    };
    const ask = async (text: string) => {
      await studio.send(text);
      await sleep(1000);
      await waitFor(() => !studio.state.agent.running, 120000, text).catch(() => {});
    };
    await ask('I just finished revising chapter 2. What should I do to see how it looks now? One or two sentences.');
    const seeReply = lastReply();
    const before = studio.state.agent.items.length;
    await ask('Use your shell tool to run: typst compile main.typ');
    const after = studio.state.agent.items.slice(before);
    out.noCompile = {
      seeReply,
      // An offer or instruction to build, not a mention that the app compiles continuously.
      offersToCompile: /typst (compile|watch)|(would you like|shall|should|can|let) (me|you|i)\b[^.]*\b(compile|build|render|export)|export (a |the )?pdf/i.test(seeReply),
      shellAttempts: after.filter((i) => i.kind === 'tool').map((i) => (i.kind === 'tool' ? `${i.name} ${i.summary} → ${i.status}: ${i.detail.slice(0, 60)}` : '')),
      permissionPrompts: after.filter((i) => i.kind === 'permission').length,
      reply: lastReply(),
    };
  }
  return out;
}
