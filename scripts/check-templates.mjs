#!/usr/bin/env node
// Compile every book template in src/templates with the installed `typst`,
// with a title that needs escaping, every cover style in src/cover (thin and
// thick spines, checking the wrap's size), Figures mode's figure style file,
// every example in the Typst basics guide (src/help/typst-basics.json), and
// the sample books in samples/.
// Fails on any error or warning.
// Usage: npm run check-templates [-- --png <dir>]  (also renders page images)
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../src/templates/', import.meta.url).pathname;
const pngDir = process.argv.includes('--png') ? process.argv[process.argv.indexOf('--png') + 1] : null;
// Same escaping as typstString() in src/templates/index.ts.
const str = (v) => v.replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const values = { title: 'The "Quiet" Harbour \\ Part One', author: 'Ada Example', year: '2026' };
// Raw lengths (validated in the app); a size every template should handle.
const raw = { width: '5.5in', height: '8.5in' };

function fill(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) fill(p);
    else if (p.endsWith('.typ')) writeFileSync(p, readFileSync(p, 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => raw[k] ?? str(values[k])));
  }
}

const version = execFileSync('typst', ['--version'], { encoding: 'utf8' }).trim();
let failed = 0;
for (const id of readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory())) {
  const work = mkdtempSync(join(tmpdir(), `typst-template-${id}-`));
  cpSync(join(root, id), work, { recursive: true });
  // Templates with runnable code get the helper and an (empty) outputs file, as in the app.
  const chapters = join(work, 'chapters');
  const sources = readFileSync(join(work, 'main.typ'), 'utf8') + (statSync(chapters, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(chapters).map((f) => readFileSync(join(chapters, f), 'utf8')).join('') : '');
  if (/"\/code\.typ"/.test(sources)) {
    cpSync(new URL('../src/code/code.typ', import.meta.url).pathname, join(work, 'code.typ'));
    mkdirSync(join(work, 'code-output'), { recursive: true });
    writeFileSync(join(work, 'code-output/outputs.json'), '{}\n');
  }
  fill(work);
  try {
    const args = ['compile', '--diagnostic-format', 'short', 'main.typ', 'out.pdf'];
    const run = spawnSync('typst', args, { cwd: work, encoding: 'utf8' });
    const output = `${run.stdout}${run.stderr}`.trim();
    if (run.status !== 0 || /warning/i.test(output)) throw new Error(output || `typst exited with ${run.status}`);
    const pdf = statSync(join(work, 'out.pdf')).size;
    // The Makefile the app adds (same text as src/templates/makefile.ts, for this check).
    writeFileSync(join(work, 'Makefile'), `MAIN := main.typ\nPDF  := export/check.pdf\npdf:\n\t@mkdir -p export\n\ttypst compile --root . $(MAIN) $(PDF)\n`);
    const make = spawnSync('make', ['-s'], { cwd: work, encoding: 'utf8' });
    if (make.status !== 0 || !statSync(join(work, 'export/check.pdf'), { throwIfNoEntry: false })) throw new Error(`make failed: ${make.stderr}`);
    if (pngDir) execFileSync('typst', ['compile', '--format', 'png', '--ppi', '40', 'main.typ', join(pngDir, `${id}-{0p}.png`)], { cwd: work });
    console.log(`ok   ${id} (${Math.round(pdf / 1024)} KB PDF)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${id}\n${e.message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Cover styles: print and preview entries, a thin spine (no spine text), a thick one and an
// exact width. The printed wrap must be 2 × trim + spine + 2 × bleed by trim + 2 × bleed.
const coverRoot = new URL('../src/cover/', import.meta.url).pathname;
for (const style of readdirSync(join(coverRoot, 'styles'))) {
  for (const [pages, spine] of [[24, 'none'], [500, 'none'], [300, '20mm']]) {
    const work = mkdtempSync(join(tmpdir(), 'typst-cover-'));
    for (const f of ['spec.typ', 'guides.typ', 'cover.typ', 'preview.typ', 'front.svg']) cpSync(join(coverRoot, f), join(work, f));
    cpSync(join(coverRoot, 'styles', style), join(work, 'design.typ'));
    const vals = { ...raw, pages: String(pages), paper: '0.0025in', spine };
    for (const f of readdirSync(work).filter((f) => f.endsWith('.typ'))) writeFileSync(join(work, f), readFileSync(join(work, f), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => vals[k] ?? str(values[k])));
    const label = `cover ${style} (${pages} pages, spine ${spine})`;
    try {
      for (const entry of ['cover.typ', 'preview.typ']) {
        const run = spawnSync('typst', ['compile', '--diagnostic-format', 'short', entry, 'out.pdf'], { cwd: work, encoding: 'utf8' });
        const output = `${run.stdout}${run.stderr}`.trim();
        if (run.status !== 0 || /warning/i.test(output)) throw new Error(`${entry}: ${output || `typst exited with ${run.status}`}`);
      }
      execFileSync('typst', ['compile', 'cover.typ', 'out.pdf'], { cwd: work });
      const boxes = [...readFileSync(join(work, 'out.pdf'), 'latin1').matchAll(/\/MediaBox\s*\[([^\]]*)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
      const spinePt = spine === 'none' ? pages * 0.0025 * 72 : (20 / 25.4) * 72;
      const want = [2 * 5.5 * 72 + spinePt + 2 * 0.125 * 72, 8.5 * 72 + 2 * 0.125 * 72];
      if (boxes.length !== 1 || Math.abs(boxes[0][2] - want[0]) > 0.05 || Math.abs(boxes[0][3] - want[1]) > 0.05)
        throw new Error(`wrap is ${JSON.stringify(boxes)}, expected one page of ${want.map((n) => n.toFixed(2)).join(' × ')} pt`);
      console.log(`ok   ${label}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${label}\n${e.message}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

// The figure style file Figures mode gives the assistant, with a figure from each wrapper,
// imported the way the instructions say (FIGURE_STYLE_IMPORT in figures-mode.ts).
{
  const agentDir = new URL('../src/services/agent/', import.meta.url).pathname;
  const mode = readFileSync(join(agentDir, 'figures-mode.ts'), 'utf8');
  const file = /FIGURE_STYLE_FILE = '([^']+)'/.exec(mode)[1];
  const importLine = /FIGURE_STYLE_IMPORT = `(.*)`;/.exec(mode)[1].replace('${FIGURE_STYLE_FILE}', file);
  const work = mkdtempSync(join(tmpdir(), 'typst-figure-style-'));
  mkdirSync(join(work, 'figures'));
  cpSync(join(agentDir, 'figure-style.typ'), join(work, file));
  writeFileSync(
    join(work, 'main.typ'),
    `${importLine}
#figure(figure-canvas({
  import cetz.draw: *
  line((0, 0), (2, 1), mark: (end: ">"), stroke: palette.accent)
  content((2, 1), [$bold(v)$], anchor: "south-west")
}), caption: [A vector.]) <fig-v>
#figure(figure-diagram(node((0, 0), [Draft]), edge("-|>"), node((1, 0), [Revise])), caption: [Steps.]) <fig-d>
#figure(figure-chart(xlabel: [x], lq.plot((1, 2, 3), (1, 4, 9))), caption: [Squares.]) <fig-c>
`,
  );
  const run = spawnSync('typst', ['compile', '--diagnostic-format', 'short', 'main.typ', 'out.pdf'], { cwd: work, encoding: 'utf8' });
  const output = `${run.stdout}${run.stderr}`.trim();
  if (run.status !== 0 || /warning/i.test(output)) {
    failed++;
    console.log(`FAIL figure style\n${output}`);
  } else console.log('ok   figure style (CeTZ, fletcher, Lilaq)');
  if (pngDir) execFileSync('typst', ['compile', '--format', 'png', '--ppi', '80', 'main.typ', join(pngDir, 'figure-style-{0p}.png')], { cwd: work });
  rmSync(work, { recursive: true, force: true });
}

// Guide examples: each compiled on its own, with the files they refer to.
const guide = JSON.parse(readFileSync(new URL('../src/help/typst-basics.json', import.meta.url), 'utf8'));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const work = mkdtempSync(join(tmpdir(), 'typst-guide-'));
mkdirSync(join(work, 'figures'));
writeFileSync(join(work, 'figures/map.png'), Buffer.from(PNG, 'base64'));
writeFileSync(join(work, 'refs.bib'), '@book{smith2020, author = {Smith, Ann}, title = {Habits}, year = {2020}}\n');
let examples = 0;
for (const item of guide.sections.flatMap((s) => s.items)) {
  if (!item.code || item.compile === false) continue;
  examples++;
  const bib = item.code.includes('@smith2020') ? '\n#bibliography("refs.bib")\n' : '';
  writeFileSync(join(work, 'main.typ'), `${item.code}\n${bib}`);
  const run = spawnSync('typst', ['compile', '--diagnostic-format', 'short', 'main.typ', 'out.pdf'], { cwd: work, encoding: 'utf8' });
  const output = `${run.stdout}${run.stderr}`.trim();
  if (run.status !== 0 || /warning/i.test(output)) {
    failed++;
    console.log(`FAIL guide: ${item.title}\n${output}`);
  }
}
rmSync(work, { recursive: true, force: true });
console.log(`ok   ${examples} guide examples`);

// The sample books (samples/<id>), compiled as they are, each in a copy.
const samplesRoot = new URL('../samples/', import.meta.url).pathname;
for (const id of readdirSync(samplesRoot).filter((n) => statSync(join(samplesRoot, n)).isDirectory())) {
  const work = mkdtempSync(join(tmpdir(), `typst-sample-${id}-`));
  cpSync(join(samplesRoot, id), work, { recursive: true });
  // Its own fonts, as the app passes them to Tinymist.
  const fonts = (JSON.parse(readFileSync(join(work, '.typst-studio.json'), 'utf8')).fontPaths ?? []).flatMap((p) => ['--font-path', p]);
  const run = spawnSync('typst', ['compile', '--diagnostic-format', 'short', '--root', '.', ...fonts, 'main.typ', 'out.pdf'], { cwd: work, encoding: 'utf8' });
  const output = `${run.stdout}${run.stderr}`.trim();
  if (run.status !== 0 || /warning/i.test(output)) {
    failed++;
    console.log(`FAIL sample ${id}\n${output}`);
  } else {
    // Page objects, not /Pages or /PageLabel.
    const pages = (readFileSync(join(work, 'out.pdf'), 'latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
    console.log(`ok   sample ${id} (${pages} pages)`);
    if (pngDir) execFileSync('typst', ['compile', '--root', '.', ...fonts, '--format', 'png', '--ppi', '40', 'main.typ', join(pngDir, `sample-${id}-{0p}.png`)], { cwd: work });
  }
  rmSync(work, { recursive: true, force: true });
}

// --papers: the research-paper templates (downloads packages; missing-font warnings are expected).
if (process.argv.includes('--papers')) {
  const src = readFileSync(new URL('../src/templates/index.ts', import.meta.url), 'utf8');
  const specs = [...src.matchAll(/package: \{ name: '([a-z0-9-]+)', version: '([\d.]+)' \}/g)].map((m) => `${m[1]}:${m[2]}`);
  for (const spec of specs) {
    const dir = mkdtempSync(join(tmpdir(), 'typst-paper-'));
    const init = spawnSync('typst', ['init', `@preview/${spec}`, 'paper'], { cwd: dir, encoding: 'utf8' });
    const run = init.status === 0 ? spawnSync('typst', ['compile', '--diagnostic-format', 'short', 'main.typ', 'out.pdf'], { cwd: join(dir, 'paper'), encoding: 'utf8' }) : init;
    const output = `${run.stdout}${run.stderr}`.split('\n').filter((l) => /error|warning/.test(l) && !/unknown font family/.test(l)).join('\n');
    if (run.status !== 0 || output) {
      failed++;
      console.log(`FAIL paper ${spec}\n${output || run.stderr}`);
    } else console.log(`ok   paper ${spec}`);
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`${version}: ${failed ? `${failed} failed` : 'all templates, guide examples and samples compile'}`);
process.exit(failed ? 1 : 0);
