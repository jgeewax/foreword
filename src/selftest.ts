import { listen } from '@tauri-apps/api/event';
// Scripted end-to-end check run inside the real app (WKWebView, Tinymist,
// OpenCode) when TYPST_STUDIO_SELFTEST=<out.json> is set. Never saves files;
// agent edit requests are rejected.
import { studio } from './app/studio';
import { monaco } from './editor/monaco';
import { errorMessage, ipc, type LaunchOptions } from './lib/ipc';
import { afterNextPaint, clock, LatencyStats } from './lib/perf';
import { menuRecorder, type MenuEntry } from './lib/context-menu';
import { parseOptions } from './services/agent/options-mode';
import { PRESETS } from './services/agent/permissions';
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
    const policy = studio.state.settings.permissions;
    studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'allow' } });
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
    studio.updateSettings({ permissions: policy });
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

  // Chat starter: a suggestion starts the conversation right away.
  studio.newSession();
  await sleep(300);
  const suggestions = [...document.querySelectorAll<HTMLButtonElement>('.starter .suggestion')];
  out.starter = { shown: !!document.querySelector('.starter'), suggestions: suggestions.length, labels: suggestions.map((b) => b.textContent) };
  if (studio.state.agent.status === 'ready') {
    suggestions[3]?.click();
    await sleep(800);
    await waitFor(() => !studio.state.agent.running, 120000, 'suggestion turn').catch(() => {});
    const items = studio.state.agent.items;
    (out.starter as any).sent = (items.find((i) => i.kind === 'user') as any)?.text;
    (out.starter as any).reply = ((items.filter((i) => i.kind === 'assistant').pop() as any)?.text ?? '').slice(0, 200);
    studio.newSession();
  }
  try {
    out.snapshotStarter = await ipc.previewSnapshot('starter', 'main');
  } catch (e) {
    out.snapshotStarter = errorMessage(e);
  }

  // A Typst error: the status bar jumps to it, and the assistant fixes it.
  const policy = studio.state.settings.permissions;
  studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'allow' } });
  await studio.setMode('write');
  editor.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
  editor.trigger('selftest', 'type', { text: ' See #undefined-thing here.' });
  await waitFor(() => studio.state.problems.errors > 0, 15000, 'error').catch(() => {});
  editor.setPosition({ lineNumber: 1, column: 1 });
  await sleep(300);
  document.querySelector<HTMLButtonElement>('.statusbar .problems .indicator.bad')?.click();
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
  studio.updateSettings({ permissions: policy });

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

/**
 * New-book journey: dialog with a custom page size, create a novel, add
 * chapters (directly and through the prompt dialog). Works next to the
 * scratch book, then reopens it.
 */
async function journeyChecks() {
  const out: Record<string, unknown> = {};
  const original = studio.state.workspace!.root;
  const parent = original.slice(0, original.lastIndexOf('/'));
  const stamp = Date.now().toString(36);

  studio.openNewBook();
  await sleep(400);
  const sizeSelect = document.querySelector<HTMLSelectElement>('.new-book select[aria-label="Page size"]');
  out.sizeOptions = [...(sizeSelect?.options ?? [])].map((o) => o.textContent);
  if (sizeSelect) {
    sizeSelect.value = '-1';
    sizeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await sleep(300);
  out.customFields = document.querySelectorAll('.custom-size input').length;
  out.snapshotDialog = await snap('journey-dialog');
  studio.closeNewBook();

  await studio.createBook('novel', { title: `Journey ${stamp}`, author: 'Ada Example', size: { width: '5.5in', height: '8.5in' } }, parent);
  await waitFor(() => studio.state.compile.status === 'ok', 60000, 'compile').catch(() => {});
  const pagesBefore = studio.state.compile.pages;
  const main0 = (await ipc.fsRead('main.typ')).text;
  out.size = /width: 5\.5in, height: 8\.5in/.test(main0);

  const added = await studio.addChapter('The Storm’s *Eye* #2');
  await sleep(1500);
  const main1 = (await ipc.fsRead('main.typ')).text;
  out.addChapter = {
    path: added,
    text: added ? (await ipc.fsRead(added)).text : null,
    includes: main1.split('\n').filter((l) => l.startsWith('#include')),
    mainDirty: !!studio.state.dirty['main.typ'],
    active: studio.state.active,
  };

  // Through the prompt dialog, as the menu and the + button do.
  const pending = studio.newChapter();
  await sleep(300);
  const input = document.querySelector<HTMLInputElement>('.prompt input');
  out.promptShown = !!input;
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'Morning After');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    out.snapshotPrompt = await snap('journey-prompt');
    document.querySelector<HTMLFormElement>('.prompt')?.requestSubmit();
  }
  await pending;
  await waitFor(() => studio.state.compile.status === 'ok' && (studio.state.compile.pages ?? 0) > (pagesBefore ?? 0), 30000, 'pages').catch(() => {});
  await sleep(1000);
  out.afterPrompt = {
    files: studio.state.workspace?.files.filter((f) => f.startsWith('chapters/')),
    includes: (await ipc.fsRead('main.typ')).text.split('\n').filter((l) => l.startsWith('#include')),
    errors: studio.state.problems.errors,
    pages: { before: pagesBefore, after: studio.state.compile.pages },
  };
  out.snapshotPreview = await snap('journey-preview', 'preview');
  out.book = studio.state.workspace?.root;
  await studio.openWorkspace(original);
  return out;
}

/** Runnable code examples: run, outdated, and the assistant fix loop (a fresh programming book). */
async function codeChecks(withAgent: boolean) {
  const out: Record<string, unknown> = {};
  const original = studio.state.workspace!.root;
  const parent = original.slice(0, original.lastIndexOf('/'));
  await studio.createBook('programming', { title: `Code ${Date.now().toString(36)}`, author: 'Test' }, parent);
  await waitFor(() => studio.state.compile.status === 'ok', 60000, 'compile').catch(() => {});
  await waitFor(() => studio.state.code.cells.length > 0, 10000, 'cells').catch(() => {});
  const statuses = () => Object.fromEntries(studio.state.code.cells.map((c) => [c.name, studio.code.status(c)]));
  out.start = { cells: studio.state.code.cells.map((c) => `${c.name} (${c.lang}) ${c.path}:${c.line}`), setUp: studio.state.code.setUp, trusted: studio.state.code.trusted, statuses: statuses() };
  const savedConfirm = studio.confirmAction;
  studio.confirmAction = async () => true;

  await studio.code.runAll();
  await sleep(2500);
  const outputs = JSON.parse((await ipc.fsRead('code-output/outputs.json')).text);
  out.runAll = {
    statuses: statuses(),
    stored: Object.fromEntries(Object.entries(outputs).map(([k, v]: [string, any]) => [k, v.stdout.trim()])),
    trusted: studio.state.code.trusted,
    compile: studio.state.compile.status,
  };
  studio.showSidebar('code');
  await studio.openFile('chapters/01-first-steps.typ');
  {
    const m = studio.editor!.getModel()!;
    const l = m.getLinesContent().findIndex((x) => x.includes('for n in range')) + 1;
    studio.editor!.setPosition({ lineNumber: l, column: 5 });
    await studio.syncPreviewToCursor().catch(() => {});
  }
  await sleep(1500);
  out.snapshotPanel = await snap('code-panel');
  out.snapshotPreview = await snap('code-preview', 'preview');
  out.lenses = [...document.querySelectorAll('.codelens-decoration a, .codelens-decoration span')].map((e) => e.textContent).filter(Boolean).slice(0, 6);

  // Editing an example marks it out of date (in the app and in the book).
  const editor = studio.editor!;
  const model = editor.getModel()!;
  const line = model.getLinesContent().findIndex((l) => l.includes('print("Hello, reader!")')) + 1;
  editor.executeEdits('selftest', [{ range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)), text: 'print("Hello, world!")' }]);
  await sleep(900);
  out.afterEdit = { hello: statuses().hello };
  await studio.code.run(['hello']);
  await sleep(500);
  out.afterRerun = { hello: statuses().hello, problems: studio.code.problems() };
  editor.trigger('selftest', 'undo', null);
  await studio.save();
  await studio.code.run(['hello']);

  if (withAgent) {
    await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
    const policy = studio.state.settings.permissions;
    studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'allow' } });
    studio.newSession();
    // Plant a bug, then let the assistant work: the changed examples are re-run after its turn.
    await studio.openFile('chapters/02-functions.typ');
    const m2 = studio.editor!.getModel()!;
    const bugLine = m2.getLinesContent().findIndex((l) => l.includes('return n if n < 2')) + 1;
    studio.editor!.executeEdits('selftest', [{ range: new monaco.Range(bugLine, 1, bugLine, m2.getLineMaxColumn(bugLine)), text: '    return n if n < 2 else fib(n - 1) + fib(n - 3)' }]);
    await studio.save();
    await askAgent('In chapters/01-first-steps.typ, add one more example called "sum" at the end of the Loops section that prints the sum of the numbers 1 to 100, with expect: "5050".');
    await waitFor(() => studio.state.code.running.length === 0 && studio.state.agent.items.some((i) => i.kind === 'notice' && /code example/.test((i as any).text)), 60000, 'auto-run').catch(() => {});
    const notice = [...studio.state.agent.items].reverse().find((i) => i.kind === 'notice' && /code example/.test((i as any).text)) as any;
    out.agentTurn = { statuses: statuses(), notice: notice?.text, action: notice?.action?.label };
    out.snapshotNotice = await snap('code-notice');
    if (notice?.action) {
      await askAgent(notice.action.prompt);
      await waitFor(() => studio.state.code.running.length === 0, 60000, 'rerun').catch(() => {});
      await sleep(3000);
      const last = [...studio.state.agent.items].reverse().find((i) => i.kind === 'notice') as any;
      out.fixTurn = { statuses: statuses(), notice: last?.text, fibLine: (await ipc.fsRead('chapters/02-functions.typ')).text.split('\n').find((l) => l.includes('return n if')) };
    }
    studio.updateSettings({ permissions: policy });
  }
  studio.code.revokeTrust();
  studio.confirmAction = savedConfirm;
  out.book = studio.state.workspace?.root;
  studio.showSidebar('files');
  await studio.openWorkspace(original);
  return out;
}

/** Answer the next text prompt (New File, Rename…) as the author would. */
async function answerPrompt(value: string) {
  await waitFor(() => !!studio.state.prompt, 5000, 'prompt');
  studio.answerPrompt(value);
}

/** Create, rename (file, folder, main file), duplicate and trash, on a fresh novel. */
async function fileChecks() {
  const out: Record<string, unknown> = {};
  const original = studio.state.workspace!.root;
  const parent = original.slice(0, original.lastIndexOf('/'));
  await studio.createBook('novel', { title: `Files ${Date.now().toString(36)}`, author: 'Test' }, parent);
  await waitFor(() => studio.state.compile.status === 'ok', 60000, 'compile').catch(() => {});
  const savedConfirm = studio.confirmAction;
  studio.confirmAction = async () => true;
  const includes = async (main = 'main.typ') => (await ipc.fsRead(main)).text.split('\n').filter((l) => l.startsWith('#include'));
  const settled = async () => {
    await sleep(1200);
    await waitFor(() => studio.state.compile.status !== 'compiling', 20000, 'compile').catch(() => {});
  };

  let p: Promise<unknown> = studio.newFile('');
  await answerPrompt('notes/ideas.md');
  await p;
  out.newFile = { exists: studio.state.workspace!.files.includes('notes/ideas.md'), active: studio.state.active };

  await studio.openFile('chapters/01-chapter-one.typ');
  p = studio.renamePath('chapters/01-chapter-one.typ');
  await answerPrompt('01-the-lighthouse.typ');
  await p;
  await settled();
  out.renameFile = { includes: await includes(), active: studio.state.active, tabs: studio.state.tabs, errors: studio.state.problems.errors, toast: studio.state.toast?.text };

  p = studio.renamePath('chapters');
  await answerPrompt('parts');
  await p;
  await settled();
  out.renameFolder = {
    includes: await includes(),
    files: studio.state.workspace!.files.filter((f) => f.startsWith('parts/') || f.startsWith('chapters/')),
    tabs: studio.state.tabs,
    errors: studio.state.problems.errors,
    compile: studio.state.compile.status,
  };

  // Unsaved edits block a rename.
  await studio.openFile('parts/02-chapter-two.typ');
  studio.editor!.trigger('selftest', 'type', { text: 'x' });
  p = studio.renamePath('parts/02-chapter-two.typ');
  await answerPrompt('02-other.typ');
  await p;
  out.renameDirty = { stillThere: studio.state.workspace!.files.includes('parts/02-chapter-two.typ'), toast: studio.state.toast?.text };
  studio.editor!.trigger('selftest', 'undo', null);
  await sleep(200);

  await studio.duplicate('parts/02-chapter-two.typ');
  out.duplicate = { files: studio.state.workspace!.files.filter((f) => f.startsWith('parts/')), active: studio.state.active };

  await studio.trashPath('parts/02-chapter-two.typ');
  await settled();
  out.trash = {
    gone: !studio.state.workspace!.files.includes('parts/02-chapter-two.typ'),
    includes: await includes(),
    errors: studio.state.problems.errors,
    compile: studio.state.compile.status,
    toast: studio.state.toast?.text,
  };

  p = studio.renamePath('main.typ');
  await answerPrompt('book.typ');
  await p;
  await sleep(3000);
  await waitFor(() => studio.state.preview.status === 'ready' && studio.state.compile.status === 'ok', 30000, 'restart').catch(() => {});
  out.renameMain = {
    entry: studio.state.workspace?.entry,
    settings: (await ipc.fsRead('.typst-studio.json')).text.trim(),
    compile: studio.state.compile,
    errors: studio.state.problems.errors,
  };
  out.snapshot = await snap('files-after');
  out.book = studio.state.workspace?.root;
  studio.confirmAction = savedConfirm;
  await studio.openWorkspace(original);
  return out;
}

/** Research papers from Typst Universe templates (downloads packages; agent fills in the title). */
async function paperChecks(withAgent: boolean) {
  const out: Record<string, unknown> = {};
  const original = studio.state.workspace!.root;
  const parent = original.slice(0, original.lastIndexOf('/'));
  const stamp = Date.now().toString(36);
  studio.openNewBook();
  await sleep(300);
  [...document.querySelectorAll<HTMLButtonElement>('.kind-switch button')].find((b) => b.textContent?.includes('Research'))?.click();
  await sleep(300);
  out.dialog = { title: document.querySelector('.new-book h1')?.textContent, cards: document.querySelectorAll('.template-grid.papers .template-card').length };
  out.snapshotDialog = await snap('papers-dialog');
  studio.closeNewBook();

  const papers: Record<string, unknown> = {};
  for (const id of ['neurips', 'ieee']) {
    const title = `Sparse Attention ${id} ${stamp}`;
    try {
      await studio.createBook(id, { title, author: 'Ada Example and Bo Sample' }, parent);
      await waitFor(() => studio.state.preview.status === 'ready' && ['ok', 'error'].includes(studio.state.compile.status), 120000, `${id} compile`).catch(() => {});
      await sleep(2000);
      const composer = document.querySelector<HTMLTextAreaElement>('.composer textarea')?.value ?? '';
      papers[id] = {
        files: studio.state.workspace?.files,
        active: studio.state.active,
        compile: studio.state.compile,
        problems: studio.state.problems,
        composerFilled: composer.includes(title),
        notices: studio.state.agent.items.filter((i) => i.kind === 'notice').map((i) => (i as any).text),
        snapshot: await snap(`paper-${id}`, 'preview'),
      };
      if (withAgent && id === 'ieee') {
        await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
        const policy = studio.state.settings.permissions;
        studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'allow' } });
        await askAgent(composer);
        await sleep(2500);
        const main = (await ipc.fsRead('main.typ')).text;
        (papers[id] as any).afterAgent = { hasTitle: main.includes(`Sparse Attention ${id}`), hasAuthor: main.includes('Ada Example'), errors: studio.state.problems.errors, compile: studio.state.compile.status };
        (papers[id] as any).snapshotAfter = await snap('paper-ieee-after', 'preview');
        studio.updateSettings({ permissions: policy });
      }
    } catch (e) {
      papers[id] = { error: errorMessage(e) };
    }
  }
  out.papers = papers;
  await studio.openWorkspace(original);
  return out;
}

/**
 * Right-click menus in every pane. Native popups are modal, so the menus are
 * recorded (not shown) and their actions run directly.
 */
async function menuChecks() {
  const out: Record<string, unknown> = {};
  let last: Exclude<MenuEntry, null | false | undefined>[] = [];
  menuRecorder.record = (entries) => (last = entries);
  const labels = () => last.map((e) => (typeof e === 'string' ? `[${e}]` : `${e.label}${e.enabled === false ? ' (disabled)' : ''}`));
  const right = async (el: Element | null, x?: number, y?: number) => {
    last = [];
    if (!el) return ['(no element)'];
    const r = el.getBoundingClientRect();
    const cx = x ?? r.left + Math.min(20, r.width / 2);
    const cy = y ?? r.top + r.height / 2;
    (document.elementFromPoint(cx, cy) ?? el).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2 }));
    await sleep(250);
    return labels();
  };
  const action = (label: string) => last.find((e): e is Extract<MenuEntry, { label: string }> => typeof e === 'object' && !!e && e.label === label)?.action;

  await studio.openFile('chapters/ch1-vectors.typ');
  const editor = studio.editor!;
  const model = editor.getModel()!;
  const line = model.getLinesContent().findIndex((l) => /^A vector in/.test(l)) + 1;
  editor.setSelection(new monaco.Range(line, 1, line, 9));
  editor.revealLineInCenter(line);
  await sleep(300);
  const p = editor.getScrolledVisiblePosition({ lineNumber: line, column: 4 })!;
  const host = editor.getDomNode()!.getBoundingClientRect();
  out.editor = await right(editor.getDomNode()!.querySelector('.view-lines'), host.left + p.left, host.top + p.top + 5);
  out.monacoMenuShown = !!document.querySelector('.monaco-menu-container, .context-view .monaco-menu');
  action('Get Three Versions…')?.();
  await sleep(500);
  out.threeVersions = { mode: studio.state.agent.mode, attachments: studio.state.agent.attachments.map((a) => a.label) };
  await studio.setMode('write');
  studio.store.set((st) => ({ agent: { ...st.agent, attachments: [] } }));

  out.tab = await right(document.querySelector('.tab.active'));
  out.explorerFile = await right([...document.querySelectorAll('.tree-row')].find((e) => e.textContent?.includes('ch1-vectors.typ')) ?? null);
  out.explorerBackground = await right(document.querySelector('.tree'), undefined, document.querySelector('.tree')!.getBoundingClientRect().bottom - 10);
  out.composer = await right(document.querySelector('.composer textarea'));
  studio.showSidebar('history');
  await sleep(300);
  out.historyRow = await right(document.querySelector('.history-row'));
  studio.showSidebar('files');

  // Preview: the preview webview reports the right-click; "Show the Text Here" jumps to the source.
  last = [];
  editor.setPosition({ lineNumber: 1, column: 1 });
  const before = { active: studio.state.active, line: editor.getPosition()?.lineNumber };
  const pv = document.querySelector('.preview-body')!.getBoundingClientRect();
  await ipc.previewEval(
    `(() => { const texts = [...document.querySelectorAll('.typst-text')].filter((t) => { const r = t.getBoundingClientRect(); return r.top > innerHeight * 0.3 && r.bottom < innerHeight * 0.9 && r.width > 20; }); const t = texts[Math.floor(texts.length / 2)]; const r = t ? t.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 }; const x = r.left + r.width / 2, y = r.top + r.height / 2; (document.elementFromPoint(x, y) || document.body).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); })()`,
  );
  await waitFor(() => last.length > 0, 5000, 'preview menu').catch(() => {});
  out.preview = labels();
  action('Show the Text Here')?.();
  await sleep(1500);
  out.previewJump = { before, after: { active: studio.state.active, line: editor.getPosition()?.lineNumber } };
  out.previewBodyWidth = pv.width;

  menuRecorder.record = undefined;
  return out;
}

/** Task-based conversations: goal, done check, finish, switch back, compact. */
async function taskChecks() {
  const out: Record<string, unknown> = {};
  const file = 'chapters/ch1-vectors.typ';
  const original = (await ipc.fsRead(file)).text;
  await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
  const policy = studio.state.settings.permissions;
  studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'allow' } });
  studio.newSession();
  const heading = original.split('\n')[0];
  const reply = await askAgent(`In ${file}, change the chapter heading on the first line to exactly: = Vectors and Spaces <ch-vectors>`);
  await sleep(1500);
  const last = [...studio.state.agent.items].reverse().find((i) => i.kind === 'assistant') as any;
  const sessionId = studio.state.agent.sessionId;
  out.turn = {
    replyEnd: reply.slice(-160),
    taskCheck: last?.taskCheck,
    checkShown: !!document.querySelector('.task-check'),
    contextTokens: studio.state.agent.contextTokens,
    meter: document.querySelector('.agent-pane .pane-header .context-meter')?.textContent,
    headingNow: (await ipc.fsRead(file)).text.split('\n')[0],
    instructionKeys: sessionId ? (await studio.agent!.getInstructions(sessionId)).map((e) => e.key) : [],
  };
  out.snapshotCheck = await snap('task-check');

  document.querySelector<HTMLButtonElement>('.task-check .primary')?.click();
  await sleep(1500);
  out.finished = {
    sessionCleared: studio.state.agent.sessionId === null,
    items: studio.state.agent.items.length,
    record: studio.state.agent.tasks.find((t) => t.sessionId === sessionId),
    historyLatest: studio.state.history.versions[0]?.label,
  };

  document.querySelector<HTMLButtonElement>('.task-trigger')?.click();
  await sleep(1200);
  out.menu = [...document.querySelectorAll('.task-row')].slice(0, 5).map((e) => e.textContent);
  out.snapshotMenu = await snap('task-menu');
  document.querySelector<HTMLButtonElement>('.task-trigger')?.click();

  if (sessionId) {
    await studio.switchTask(sessionId);
    await sleep(500);
    out.switched = {
      sessionId: studio.state.agent.sessionId === sessionId,
      title: studio.state.agent.title,
      items: studio.state.agent.items.map((i) => `${i.kind}${i.kind === 'user' || i.kind === 'assistant' ? `: ${i.text.slice(0, 60)}` : ''}`),
      contextTokens: studio.state.agent.contextTokens,
    };
    const before = studio.state.agent.contextTokens;
    await studio.compactTask();
    out.compacted = { before, after: studio.state.agent.contextTokens, notice: (studio.state.agent.items.filter((i) => i.kind === 'notice').pop() as any)?.text, items: studio.state.agent.items.length };
    out.compactedItems = studio.state.agent.items.map((i) => `${i.kind}: ${'text' in i ? i.text.slice(0, 60) : ''}`);
  }
  studio.updateSettings({ permissions: policy });
  await ipc.fsWrite(file, original, await ipc.fsHash(file));
  void heading;
  studio.newSession();
  return out;
}

/** TODOs: found as you type, listed, offered as suggestions, done, and handed to the assistant. */
async function todoChecks(withAgent: boolean) {
  const out: Record<string, unknown> = {};
  const file = 'chapters/ch1-vectors.typ';
  const original = (await ipc.fsRead(file)).text;
  await studio.openFile(file);
  const editor = studio.editor!;
  const model = editor.getModel()!;
  const line = model.getLinesContent().findIndex((l) => l.startsWith('stated otherwise.')) + 1;
  const end = { lineNumber: line, column: model.getLineMaxColumn(line) };
  editor.executeEdits('selftest', [{ range: monaco.Range.fromPositions(end), text: '\n// TODO: add one sentence saying a vector with length one is called a unit vector\n// FIXME tidy this paragraph' }]);
  await sleep(800);
  out.fromBuffer = studio.state.todos.map((t) => `${t.path}:${t.line} ${t.kind} ${t.text}`);
  await studio.save();
  out.status = document.querySelector('.statusbar .indicator[title="TODOs left in the book"]')?.textContent;
  studio.showSidebar('todos');
  studio.newSession();
  await sleep(400);
  out.tab = [...document.querySelectorAll('.sidebar-tabs button')].map((b) => b.textContent);
  out.panel = [...document.querySelectorAll('.todo-row .todo-text')].map((e) => e.textContent);
  out.suggestions = [...document.querySelectorAll('.suggestion.todo')].map((e) => e.textContent);
  out.snapshot = await snap('todos');

  const fixme = studio.state.todos.find((t) => t.text.startsWith('tidy'));
  if (fixme) await studio.todoDone(fixme);
  await sleep(300);
  out.afterDone = { todos: studio.state.todos.map((t) => t.text), fileHasFixme: (await ipc.fsRead(file)).text.includes('FIXME') };

  if (withAgent) {
    await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
    const policy = studio.state.settings.permissions;
    studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'allow' } });
    const todo = studio.state.todos.find((t) => t.text.includes('unit vector'));
    if (todo) {
      await studio.askTodo(todo);
      await sleep(1000);
      await waitFor(() => !studio.state.agent.running, 120000, 'todo turn').catch(() => {});
      await sleep(2000);
      const text = (await ipc.fsRead(file)).text;
      out.agent = { sent: (studio.state.agent.items.find((i) => i.kind === 'user') as any)?.text, todoGone: !text.includes('TODO'), mentionsUnit: /unit vector/i.test(text), todos: studio.state.todos.length };
    }
    studio.updateSettings({ permissions: policy });
  }
  await ipc.fsWrite(file, original, await ipc.fsHash(file));
  await sleep(500);
  studio.showSidebar('files');
  return out;
}

/** The selection goes with chat messages; text selected in the preview maps to the source. */
async function selectionChecks(withAgent: boolean) {
  const out: Record<string, unknown> = {};
  await studio.openFile('chapters/ch2-eigenvalues.typ');
  const editor = studio.editor!;
  const model = editor.getModel()!;
  const line = model.getLinesContent().findIndex((l) => l.startsWith('The eigenvalues of')) + 1;
  editor.setSelection(new monaco.Range(line, 1, line, model.getLineMaxColumn(line)));
  await sleep(500);
  out.editor = { selection: studio.state.agent.selection?.attachment.label, from: studio.state.agent.selection?.from, chip: document.querySelector('.chip.live')?.textContent };
  document.querySelector<HTMLButtonElement>('.chip.live .chip-main')?.click();
  await sleep(200);
  out.previewBox = document.querySelector('.selection-preview')?.textContent;
  out.snapshotChip = await snap('selection-chip');
  document.querySelector<HTMLButtonElement>('.chip.live .chip-main')?.click();
  document.querySelector<HTMLButtonElement>('.chip.live button[aria-label="Leave the selection out"]')?.click();
  await sleep(200);
  out.dismissed = { chip: !!document.querySelector('.chip.live') };
  editor.setSelection(new monaco.Range(line, 1, line, 20));
  await sleep(400);
  out.backAfterChange = !!document.querySelector('.chip.live');

  if (withAgent) {
    await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
    studio.newSession();
    editor.setSelection(new monaco.Range(line, 1, line, model.getLineMaxColumn(line)));
    await sleep(400);
    const reply = await askAgent('Repeat the selected sentence back to me, word for word, and nothing else.');
    const user = studio.state.agent.items.find((i) => i.kind === 'user') as any;
    out.sent = { attachments: user?.attachments, reply: reply.slice(0, 200) };
  }

  // Select two text runs in the preview, as a drag would.
  editor.setPosition({ lineNumber: line, column: 5 });
  await studio.syncPreviewToCursor().catch(() => {});
  await sleep(1200);
  editor.setPosition({ lineNumber: 1, column: 1 });
  await sleep(300);
  await ipc.previewEval(`(() => {
    const runs = [...document.querySelectorAll('.typst-text')].filter((e) => { const r = e.getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight && (e.textContent || '').includes('roots'); });
    const t = runs[0];
    if (!t) return;
    const all = [...document.querySelectorAll('.typst-text')];
    const next = all[all.indexOf(t) + 1] || t;
    const range = document.createRange();
    range.setStart(t, 0);
    range.setEnd(next, next.childNodes.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  })()`);
  await waitFor(() => studio.state.agent.selection?.from === 'preview', 8000, 'preview selection').catch(() => {});
  await sleep(300);
  const sel = studio.state.agent.selection;
  out.preview = { from: sel?.from, label: sel?.attachment.label, text: sel?.attachment.selection.selectedText, active: studio.state.active, chip: document.querySelector('.chip.live')?.textContent };
  out.snapshotPreviewSel = await snap('selection-from-preview');
  await ipc.previewEval('window.getSelection().removeAllRanges()');
  return out;
}

/** Probe: OpenCode sessions and message shapes (for task switching). */
async function sessionProbe() {
  await waitFor(() => studio.state.agent.status === 'ready', 60000, 'agent');
  const root = studio.state.workspace!.root;
  const list = (await ipc.agentRequest('GET', `/api/session?directory=${encodeURIComponent(root)}&limit=5`)).body;
  const sessions = list?.data ?? list;
  const first = Array.isArray(sessions) ? sessions[0] : null;
  const messages = first ? (await ipc.agentRequest('GET', `/api/session/${first.id}/message?limit=6`)).body : null;
  const context = first ? (await ipc.agentRequest('GET', `/api/session/${first.id}/context`)).body : null;
  const shape = (v: any, depth = 0): any =>
    depth > 4 ? '…' : Array.isArray(v) ? [v.length ? shape(v[0], depth + 1) : null, `len ${v.length}`] : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)])) : typeof v === 'string' ? `str(${v.length}): ${v.slice(0, 50)}` : v;
  const ctx = (context as any)?.data ?? [];
  return {
    listKeys: list && Object.keys(list),
    count: Array.isArray(sessions) ? sessions.length : null,
    sessionKeys: first && Object.keys(first),
    title: first?.title,
    time: first?.time,
    contextItems: ctx.map((m: any) => ({ type: m.type, keys: Object.keys(m), content: (m.content ?? []).map((c: any) => ({ keys: Object.keys(c), type: c.type, name: c.name, state: c.state && Object.keys(c.state) })) })).slice(0, 8),
    assistantSample: shape(ctx.find((m: any) => m.type !== 'user')),
    messagesShape: shape((messages as any)?.data?.[0]),
  };
}

/** Probe: what the preview's text elements contain (is the rendered text selectable?). */
async function previewProbe() {
  let report: any = null;
  const off = await listen<any>('preview:report', (e) => {
    if (e.payload?.tag === 'probe') report = e.payload;
  });
  await ipc.previewEval(`(() => {
    const t = [...document.querySelectorAll('.typst-text')].find((e) => e.getBoundingClientRect().top > 100);
    const sel = window.getSelection();
    let selected = '';
    if (t) { const r = document.createRange(); r.selectNodeContents(t); sel.removeAllRanges(); sel.addRange(r); selected = String(sel); sel.removeAllRanges(); }
    const all = document.querySelectorAll('.typst-text').length;
    const withText = [...document.querySelectorAll('.typst-text')].filter((e) => (e.textContent || '').trim()).length;
    window.__TAURI_INTERNALS__.invoke('preview_report', { report: { tag: 'probe', all, withText, sample: t ? t.outerHTML.slice(0, 600) : null, text: t ? t.textContent : null, selected, userSelect: t ? getComputedStyle(t).userSelect : null, classes: [...new Set([...document.querySelectorAll('[class]')].map((e) => e.getAttribute('class')))].slice(0, 30) } });
  })()`);
  await waitFor(() => !!report, 5000, 'probe').catch(() => {});
  off();
  return report;
}

/** Status bar colours: ready, then with a Typst error (typed, then undone). */
async function statusbarChecks() {
  const out: Record<string, unknown> = {};
  const indicators = () => [...document.querySelectorAll('.statusbar .indicator')].map((e) => `${e.className.replace('indicator ', '')}: ${e.textContent}`);
  await waitFor(() => studio.state.agent.status === 'ready', 60000, 'agent').catch(() => {});
  await sleep(500);
  out.ready = indicators();
  await studio.openFile('chapters/ch1-vectors.typ');
  const editor = studio.editor!;
  const model = editor.getModel()!;
  const original = model.getValue();
  editor.setPosition({ lineNumber: 3, column: 1 });
  editor.trigger('selftest', 'type', { text: '#nope ' });
  await waitFor(() => studio.state.problems.errors > 0, 15000, 'error').catch(() => {});
  await sleep(500);
  out.withError = indicators();
  const bar = document.querySelector('.statusbar')!.getBoundingClientRect();
  out.snapshot = await snap('statusbar-error');
  out.barHeight = bar.height;
  while (model.getValue() !== original && model.canUndo()) await model.undo();
  await sleep(300);
  return out;
}

/** Figures mode (TODO: image/figure modes). Edits a chapter: scratch book only; restores it. */
async function figuresChecks() {
  const out: Record<string, unknown> = {};
  const file = 'chapters/ch1-vectors.typ';
  await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
  const policy = studio.state.settings.permissions;
  studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'allow' } });
  studio.newSession();
  await studio.setMode('write');
  document.querySelector<HTMLButtonElement>('.mode-trigger')?.click();
  await sleep(300);
  out.menu = [...document.querySelectorAll('.mode-option .mode-name')].map((e) => e.textContent);
  out.snapshotMenu = await snap('mode-menu');
  [...document.querySelectorAll<HTMLButtonElement>('.mode-option')].find((b) => b.textContent?.includes('Figures'))?.click();
  await sleep(500);
  out.mode = studio.state.agent.mode;
  const before = (await ipc.fsRead(file)).text;
  const reply = await askAgent(
    `In ${file}, right after the paragraph that ends "stated otherwise.", add a small flowchart figure showing: vectors → linear combinations → span. Give it a caption and a label.`,
  );
  await sleep(2500);
  const after = (await ipc.fsRead(file)).text;
  out.result = {
    reply: reply.slice(0, 300),
    changed: after !== before,
    usesFletcher: after.includes('@preview/fletcher:0.5.8'),
    hasFigure: /#figure\(/.test(after.slice(before.length > 0 ? 0 : 0)),
    hasCaption: /caption:/.test(after),
    hasLabel: /<fig-[\w-]+>/.test(after),
    errors: studio.state.problems.errors,
    compile: studio.state.compile,
    tools: studio.state.agent.items.filter((i) => i.kind === 'tool').map((i) => `${(i as any).name} → ${(i as any).status}`),
  };
  await studio.openFile(file);
  const line = after.split('\n').findIndex((l) => l.includes('#figure') || l.includes('diagram(')) + 1;
  if (line > 0) {
    studio.editor?.setPosition({ lineNumber: line, column: 1 });
    await studio.syncPreviewToCursor().catch(() => {});
    await sleep(1200);
  }
  out.snapshotPreview = await snap('figure-preview', 'preview');
  out.snapshotMain = await snap('figure-main');
  await ipc.fsWrite(file, before, await ipc.fsHash(file));
  await studio.setMode('write');
  studio.updateSettings({ permissions: policy });
  return out;
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
  const savedPolicy = studio.state.settings.permissions;
  await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
  studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'allow' } });
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
  studio.updateSettings({ permissions: savedPolicy });
  return out;
}

/**
 * Edit setting (TODO #7). Makes real edits, so it only runs with
 * TYPST_STUDIO_SELFTEST_EDITS=1 against a scratch copy of a book.
 */
async function editPolicyChecks() {
  const out: Record<string, unknown> = {};
  const savedPolicy = studio.state.settings.permissions;
  const file = 'chapters/ch1-vectors.typ';
  const heading = async () => (await ipc.fsRead(file)).text.split('\n')[0];
  await waitFor(() => studio.state.agent.status === 'ready' && studio.state.agent.model, 60000, 'agent');
  studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'ask' } });
  studio.newSession();
  // Start from a known heading (earlier runs may have changed it).
  {
    const text = (await ipc.fsRead(file)).text.split('\n');
    text[0] = '= Vectors <ch-vectors>';
    await ipc.fsWrite(file, text.join('\n'), await ipc.fsHash(file));
    await sleep(500);
  }
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
  studio.updateSettings({ permissions: { ...studio.state.settings.permissions, edit: 'allow' } });
  await sleep(800);
  out.switchNotice = studio.state.agent.items.filter((i) => i.kind === 'notice').map((i) => (i as any).text).pop();
  const autoItems = await turn(`Now do it: in ${file}, change the first line's heading text "Vectors" to "Vectors (auto test)". Use your edit tool, not a shell command. Change nothing else.`);
  // A model that reaches for the shell instead still has to ask: refuse, and note it.
  for (const i of autoItems) if (i.kind === 'permission' && i.state === 'pending') await studio.replyPermission(i.id, 'reject');
  await waitFor(() => !studio.state.agent.running, 60000, 'auto turn end').catch(() => {});
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

  // 3. Fine-grained: deleting set to Never refuses rm (even though other commands only ask).
  studio.updateSettings({ permissions: { ...PRESETS.ask.permissions, edit: 'allow', delete: 'deny' } });
  await sleep(500);
  document.querySelector<HTMLButtonElement>('.perm-trigger')?.click();
  await sleep(300);
  out.popover = {
    rows: [...document.querySelectorAll('.perm-row .perm-label')].map((e) => e.textContent),
    trigger: document.querySelector('.perm-trigger')?.textContent,
    snapshot: await snap('permissions'),
  };
  document.querySelector<HTMLButtonElement>('.perm-trigger')?.click();
  await ipc.fsWrite('delete-me.typ', '// scratch file for the permissions self-test\n', await ipc.fsHash('delete-me.typ'));
  await waitFor(() => !studio.state.agent.running, 60000, 'idle').catch(() => {});
  studio.newSession();
  const delItems = await turn('Delete the file delete-me.typ in the project root with the shell command `rm delete-me.typ`. Do not use any other method.');
  const pending = delItems.find((i) => i.kind === 'permission' && i.state === 'pending');
  if (pending) await studio.replyPermission(pending.id, 'reject');
  await waitFor(() => !studio.state.agent.running, 60000, 'delete turn').catch(() => {});
  out.deleteNever = {
    stillThere: (await ipc.fsHash('delete-me.typ')) !== null,
    tools: delItems.filter((i) => i.kind === 'tool').map((i) => `${(i as any).name} ${(i as any).summary} → ${(i as any).status}: ${String((i as any).detail).slice(0, 80)}`),
    askedInstead: !!pending,
    notice: studio.state.agent.items.filter((i) => i.kind === 'notice').map((i) => (i as any).text).slice(-3),
  };

  studio.updateSettings({ permissions: savedPolicy });
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
    r.hint = (document.querySelector('.composer-hint')?.textContent ?? '') as unknown as number;
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
  // Earlier self-tests saved their scratch folder and test author as the New Book defaults; undo that.
  for (const [key, bad] of [
    ['studio.newBookParent', (v: string) => v.startsWith('/private/tmp/') || v.includes('/scratchpad')],
    ['studio.author', (v: string) => v === 'Ada Example'],
  ] as const) {
    const v = localStorage.getItem(key);
    if (v && bad(v)) localStorage.removeItem(key);
  }
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

    if (launch.selftestEdits && want('code')) {
      log('code');
      result.code = await codeChecks(launch.selftestAgent);
    }
    if (launch.selftestEdits && want('files')) {
      log('files');
      result.files = await fileChecks();
    }
    if (launch.selftestEdits && want('papers')) {
      log('papers');
      result.papers = await paperChecks(launch.selftestAgent);
    }
    if (want('journey')) {
      log('journey');
      result.journey = await journeyChecks();
    }
    if (want('menus')) {
      log('menus');
      result.menus = await menuChecks();
    }
    if (want('probe')) result.probe = await previewProbe();
    if (want('sessions')) result.sessions = await sessionProbe();
    if (launch.selftestEdits && launch.selftestAgent && want('tasks')) {
      log('tasks');
      result.tasks = await taskChecks();
    }
    if (launch.selftestEdits && want('todos')) {
      log('todos');
      result.todos = await todoChecks(launch.selftestAgent);
    }
    if (want('selection')) {
      log('selection');
      result.selection = await selectionChecks(launch.selftestAgent);
    }
    if (want('statusbar')) {
      log('statusbar');
      result.statusbar = await statusbarChecks();
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
      if (want('figures')) {
        log('figures');
        result.figures = await figuresChecks();
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
