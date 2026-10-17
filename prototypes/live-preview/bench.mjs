#!/usr/bin/env node
// Headless check that *unsaved* edits in an included chapter reach Tinymist's
// live preview through a single Tinymist LSP process, and how fast.
//
//   node bench.mjs [--root DIR] [--chapter chapters/x.typ] [--samples 20]
//
// Measures time from LSP didChange to (a) Tinymist's compileSuccess and (b) the
// preview's WebSocket diff message. Browser decode/paint is measured separately
// (see browser-bench.mjs).
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { TypstSession } from './tinymist.mjs';

const { values: opt } = parseArgs({
  options: {
    root: { type: 'string', default: resolve(import.meta.dirname, '../../fixtures/sample-book') },
    entry: { type: 'string', default: 'main.typ' },
    chapter: { type: 'string' },
    samples: { type: 'string', default: '20' },
    burst: { type: 'string', default: '40' },
    interval: { type: 'string', default: '60' },
  },
});
const root = resolve(opt.root);
const chapter = opt.chapter ?? pickChapter(root, opt.entry);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const sha = (p) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex');

function pickChapter(root, entry) {
  const includes = [...readFileSync(join(root, entry), 'utf8').matchAll(/#include\s+"([^"]+)"/g)].map((m) => m[1]);
  if (!includes.length) throw new Error(`no #include in ${entry}; pass --chapter`);
  return includes[Math.floor(includes.length / 2)]; // a chapter in the middle of the book
}

// ---- event plumbing -------------------------------------------------------
const bus = new EventEmitter();
function next(kind, pred = () => true, timeout = 10000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => (bus.off(kind, on), resolve(null)), timeout);
    function on(ev) {
      if (!pred(ev)) return;
      clearTimeout(timer);
      bus.off(kind, on);
      resolve(ev);
    }
    bus.on(kind, on);
  });
}

const t0 = now();
const session = new TypstSession(root);
const chapterUri = session.uri(chapter);
session.lsp.on('notification', (method, params) => {
  if (method === 'tinymist/compileStatus') bus.emit('compile', { t: now(), ...params });
  if (method === 'textDocument/publishDiagnostics') bus.emit('diag', { t: now(), ...params });
});
session.lsp.on('server-exit', (code, sig) => bus.emit('server-exit', { code, sig }));

const diskBefore = { entry: sha(opt.entry), chapter: sha(chapter) };
await session.initialize();
session.open(opt.entry);
session.open(chapter);
await session.pinMain(opt.entry);
const firstCompile = next('compile', (e) => e.status === 'compileSuccess' && e.wordsCount, 120000);
const preview = await session.startPreview(opt.entry);

const ws = new WebSocket(`ws://127.0.0.1:${preview.dataPlanePort}`);
ws.binaryType = 'arraybuffer';
ws.onmessage = (e) => {
  const bytes = new Uint8Array(e.data);
  const head = new TextDecoder().decode(bytes.subarray(0, 32));
  bus.emit('ws', { t: now(), kind: head.slice(0, head.indexOf(',')), size: bytes.length });
};
const firstDiff = await next('ws', (e) => e.kind === 'diff-v1', 120000);
const compiled = await firstCompile;
if (!firstDiff || !compiled) throw new Error('preview never produced a first render');
const startupMs = firstDiff.t - t0;
const pages = compiled.pageCount;
const words0 = compiled.wordsCount.words;
await sleep(500);

// ---- edit helpers (positions are 0-based, LSP style) ----------------------
const doc = () => session.docs.get(chapterUri).text;
const paraLine = doc().split('\n').findIndex((l) => /^[A-Za-z]/.test(l));
let col = 0;
function insert(text) {
  const pos = { line: paraLine, character: col };
  col += text.length;
  return session.change(chapterUri, [{ range: { start: pos, end: pos }, text }]);
}
function remove(len) {
  col -= len;
  const start = { line: paraLine, character: col };
  return session.change(chapterUri, [{ range: { start, end: { line: paraLine, character: col + len } }, text: '' }]);
}

// ---- 1. proof: unsaved chapter edit recompiles the whole book -------------
let tEdit = now();
// Tinymist reports compileSuccess first with the previous word count, then again
// once the count is recomputed, so wait for the count to actually change.
const wordsAfter = next('compile', (e) => e.status === 'compileSuccess' && e.wordsCount && e.wordsCount.words !== words0, 5000);
const diffAfter = next('ws', (e) => e.kind === 'diff-v1');
insert('Unsaved words reach the preview. ');
const proofCompile = await wordsAfter;
const proofDiff = await diffAfter;
const proof = {
  wordsBefore: words0,
  wordsAfter: proofCompile?.wordsCount.words,
  diffMs: proofDiff && proofDiff.t - tEdit,
};
await sleep(400);

// ---- 2. isolated edits: one word at a time, spaced out ---------------------
const iso = { compile: [], diff: [], diffBytes: [] };
for (let i = 0; i < Number(opt.samples); i++) {
  const c = next('compile', (e) => e.status === 'compileSuccess');
  const d = next('ws', (e) => e.kind === 'diff-v1');
  tEdit = now();
  insert(`w${i} `);
  const [ce, de] = await Promise.all([c, d]);
  if (ce) iso.compile.push(ce.t - tEdit);
  if (de) iso.diff.push(de.t - tEdit), iso.diffBytes.push(de.size);
  await sleep(350);
}

// ---- 3. burst typing: one character every --interval ms --------------------
const text = 'the quick brown fox jumps over the lazy dog and keeps typing ';
const burstDiffs = [];
const onBurst = (e) => e.kind === 'diff-v1' && burstDiffs.push(e.t);
bus.on('ws', onBurst);
const tBurst = now();
let tLast = 0;
for (let i = 0; i < Number(opt.burst); i++) {
  tLast = now();
  insert(text[i % text.length]);
  await sleep(Number(opt.interval));
}
await sleep(1500);
bus.off('ws', onBurst);
const during = burstDiffs.filter((t) => t <= tLast);
const gaps = during.slice(1).map((t, i) => t - during[i]);
const settle = burstDiffs.filter((t) => t > tLast);
const burst = {
  keystrokes: Number(opt.burst),
  typingMs: tLast - tBurst,
  updatesWhileTyping: during.length,
  medianGapMs: median(gaps),
  lastKeyToFinalUpdateMs: settle.length ? settle.at(-1) - tLast : null,
};

// ---- 4. syntax error: diagnostics appear, preview keeps last good render ----
const errDiag = next('diag', (e) => e.uri === chapterUri && e.diagnostics.some((d) => d.severity === 1));
let diffDuringError = false;
const onErrDiff = (e) => e.kind === 'diff-v1' && (diffDuringError = true);
bus.on('ws', onErrDiff);
tEdit = now();
insert('#broken(');
const errEv = await errDiag;
await sleep(800);
bus.off('ws', onErrDiff);
const fixDiag = next('diag', (e) => e.uri === chapterUri && !e.diagnostics.some((d) => d.severity === 1));
const fixDiff = next('ws', (e) => e.kind === 'diff-v1');
const tFix = now();
remove('#broken('.length);
const [fixD, fixW] = await Promise.all([fixDiag, fixDiff]);
const errors = {
  diagnosticMs: errEv && errEv.t - tEdit,
  message: errEv?.diagnostics.find((d) => d.severity === 1)?.message,
  previewUpdatedWhileBroken: diffDuringError,
  fixDiagnosticsClearedMs: fixD && fixD.t - tFix,
  fixPreviewUpdatedMs: fixW && fixW.t - tFix,
};

// ---- 5. nothing was written to disk ----------------------------------------
const diskUnchanged = sha(opt.entry) === diskBefore.entry && sha(chapter) === diskBefore.chapter;

ws.close();
await session.shutdown();

// ---- report -----------------------------------------------------------------
function median(xs) {
  return pct(xs, 50);
}
function pct(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}
const f = (x) => (x == null ? 'n/a' : `${x.toFixed(1)} ms`);
const ok = (b) => (b ? 'PASS' : 'FAIL');

console.log(`
Typst live-preview bench
  tinymist:   ${session.bin}
  book:       ${root}  (entry ${opt.entry}, ${pages} pages, ${words0} words)
  edited:     ${chapter}  (in memory only)

Startup: spawn → first preview frame data      ${f(startupMs)}

1. Unsaved edit in included chapter reaches preview      ${ok(proof.wordsAfter > proof.wordsBefore && proof.diffMs != null)}
     word count ${proof.wordsBefore} → ${proof.wordsAfter}; preview diff after ${f(proof.diffMs)}

2. Isolated edits (n=${iso.diff.length})               p50        p95        max
     didChange → compileSuccess         ${[50, 95, 100].map((p) => f(pct(iso.compile, p)).padEnd(10)).join(' ')}
     didChange → preview diff on WS     ${[50, 95, 100].map((p) => f(pct(iso.diff, p)).padEnd(10)).join(' ')}
     diff size p50 ${pct(iso.diffBytes, 50)} bytes

3. Burst typing: ${burst.keystrokes} keys, one every ${opt.interval} ms (${f(burst.typingMs)})
     preview updates while typing       ${burst.updatesWhileTyping}  (median gap ${f(burst.medianGapMs)})
     last key → final preview update    ${f(burst.lastKeyToFinalUpdateMs)}

4. Syntax error in unsaved buffer                         ${ok(errors.diagnosticMs != null && !errors.previewUpdatedWhileBroken && errors.fixPreviewUpdatedMs != null)}
     error diagnostic after ${f(errors.diagnosticMs)}: ${JSON.stringify(errors.message)}
     preview kept last good render: ${!errors.previewUpdatedWhileBroken}
     after fix: diagnostics cleared ${f(errors.fixDiagnosticsClearedMs)}, preview updated ${f(errors.fixPreviewUpdatedMs)}

5. Files on disk untouched                                ${ok(diskUnchanged)}
`);
process.exit(0);
