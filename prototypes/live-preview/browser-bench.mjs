#!/usr/bin/env node
// Drives the spike page in a real browser engine with real key events and
// measures, end to end:
//   - key → Monaco paint
//   - key → embedded Tinymist preview DOM updated and painted
// WebKit is the engine behind Tauri's WKWebView on macOS; Chromium is there for
// comparison.
//
//   node browser-bench.mjs [--root DIR] [--engine webkit|chromium] [--partial on|off]
//                          [--headed] [--shots DIR]
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import * as playwright from 'playwright';

const { values: opt } = parseArgs({
  options: {
    root: { type: 'string', default: resolve(import.meta.dirname, '../../fixtures/sample-book') },
    engine: { type: 'string', default: 'webkit' },
    partial: { type: 'string', default: 'on' },
    headed: { type: 'boolean', default: false },
    samples: { type: 'string', default: '15' },
    shots: { type: 'string' },
  },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- start the spike server ---------------------------------------------------
const server = spawn(process.execPath, [resolve(import.meta.dirname, 'serve.mjs'), '--root', opt.root, '--port', '0'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, TINYMIST_PARTIAL_RENDERING: opt.partial === 'on' ? '1' : '0' },
});
const url = await new Promise((resolve, reject) => {
  createInterface({ input: server.stdout }).on('line', (l) => {
    const m = /^LISTENING (\S+)/.exec(l);
    if (m) resolve(m[1]);
  });
  server.on('exit', (code) => reject(new Error(`serve.mjs exited ${code}`)));
});

const browser = await playwright[opt.engine].launch({ headless: !opt.headed });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const tLoad = Date.now();
  await page.goto(url); // tinymist.scrollPreview is unreliable here, so the bench scrolls the frame directly
  await page.waitForFunction(() => window.__spike?.ready, null, { timeout: 120000 });
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForFunction(() => document.querySelectorAll('rect.typst-page-inner').length > 0, null, { timeout: 120000 });
  const readyMs = Date.now() - tLoad;

  // Scroll the preview to the edited chapter's heading using Tinymist's outline.
  const heading = await page.evaluate(() => window.__spike.editor.getModel().getLineContent(1));
  const title = heading.replace(/^=\s*/, '').replace(/\s*<[^>]+>\s*$/, '');
  const outline = await page.evaluate(() => fetch('/api/outline').then((r) => r.json()));
  const flat = (items) => items.flatMap((i) => [i, ...flat(i.children ?? [])]);
  const target = flat(outline).find((i) => i.title === title)?.position;
  if (!target) throw new Error(`heading "${title}" not found in preview outline`);
  await frame.evaluate(({ page_no, y }) => {
    const c = document.getElementById('typst-container-main');
    const svg = document.querySelector('svg.typst-doc');
    const scale = Number(svg.getAttribute('data-applied-width')) / Number(svg.getAttribute('data-width'));
    const r = document.querySelector(`rect.typst-page-inner[data-page-number="${page_no - 1}"]`);
    c.scrollTop += r.getBoundingClientRect().top - c.getBoundingClientRect().top + y * scale - 40;
  }, target);
  await sleep(1500);
  const dom = await frame.evaluate(() => ({ pages: document.querySelectorAll('rect.typst-page-inner').length, nodes: document.querySelectorAll('*').length }));
  await page.evaluate(() => window.__spike.editor.focus());
  if (opt.shots) await page.screenshot({ path: join(opt.shots, `${opt.engine}-partial-${opt.partial}-before.png`) });

  // Record every preview DOM mutation burst and the frame it painted in.
  await frame.evaluate(() => {
    const clock = () => performance.timeOrigin + performance.now();
    window.__mut = [];
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      const tMut = clock();
      requestAnimationFrame(() => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => {
          window.__mut.push({ tMut, tPaint: clock() });
          scheduled = false;
        };
        ch.port2.postMessage(0);
      });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  });

  // Idle baseline: the preview should not churn when nothing changes.
  await sleep(1000);
  const idleMutations = await frame.evaluate(() => window.__mut.length);

  // ---- isolated keystrokes ----------------------------------------------------
  await page.evaluate(() => ((window.__spike.keys.length = 0), (window.__spike.inputToPaint.length = 0)));
  await frame.evaluate(() => (window.__mut.length = 0));
  for (let i = 0; i < Number(opt.samples); i++) {
    await page.keyboard.type('x');
    await sleep(600);
  }
  const iso = await collect(page, frame);

  // ---- burst typing (≈ 100 wpm) -----------------------------------------------
  await page.evaluate(() => (window.__spike.keys.length = 0));
  await frame.evaluate(() => (window.__mut.length = 0));
  await page.keyboard.type(' LIVE EDIT WORKS while typing fast ', { delay: 60 });
  await sleep(1500);
  const burstKeys = await page.evaluate(() => [...window.__spike.keys]);
  const burstMuts = await frame.evaluate(() => [...window.__mut]);
  const lastKey = burstKeys.at(-1);
  const during = burstMuts.filter((m) => m.tPaint <= lastKey);
  const after = burstMuts.filter((m) => m.tPaint > lastKey);

  if (opt.shots) await page.screenshot({ path: join(opt.shots, `${opt.engine}-partial-${opt.partial}-after.png`) });
  const status = await page.evaluate(() => document.querySelector('#compile').textContent);
  const editorPaint = await page.evaluate(() => [...window.__spike.inputToPaint]);

  const f = (x) => (x == null ? 'n/a' : `${x.toFixed(1)} ms`);
  const row = (xs) => [50, 95, 100].map((p) => f(pct(xs, p)).padEnd(10)).join(' ');
  console.log(`
${opt.engine} ${browser.version()} (${opt.headed ? 'headed' : 'headless'}), partial rendering ${opt.partial}
  book: ${opt.root}  (${status})
  edited: ${await page.evaluate(() => window.__spike.path)}, preview scrolled to page ${target.page_no}
  page load → preview rendered: ${readyMs} ms; preview DOM ${dom.pages} pages, ${dom.nodes} nodes
  idle preview mutations in 1 s: ${idleMutations}

Isolated keystrokes (n=${iso.firstPaint.length}/${opt.samples})       p50        p95        max
  key → editor paint                  ${row(editorPaint)}
  key → preview first paint           ${row(iso.firstPaint)}
  key → preview settled               ${row(iso.lastPaint)}
  keys with no preview update: ${iso.missed}

Burst: ${burstKeys.length} keys at 60 ms intervals (${f(lastKey - burstKeys[0])})
  preview repaints while typing       ${during.length}
  last key → next preview paint       ${f(after.length ? after[0].tPaint - lastKey : null)}
  last key → final preview paint      ${f(after.length ? after.at(-1).tPaint - lastKey : null)}
  repaints after last key at          ${after.map((m) => `${(m.tPaint - lastKey).toFixed(0)}`).join(', ')} ms
`);
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

async function collect(page, frame) {
  const keys = await page.evaluate(() => [...window.__spike.keys]);
  const muts = await frame.evaluate(() => [...window.__mut]);
  const firstPaint = [];
  const lastPaint = [];
  let missed = 0;
  keys.forEach((k, i) => {
    const end = keys[i + 1] ?? Infinity;
    const inWindow = muts.filter((m) => m.tMut >= k && m.tMut < end);
    if (!inWindow.length) return void missed++;
    firstPaint.push(inWindow[0].tPaint - k);
    lastPaint.push(inWindow.at(-1).tPaint - k);
  });
  return { firstPaint, lastPaint, missed };
}

function pct(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}
