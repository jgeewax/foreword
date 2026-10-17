#!/usr/bin/env node
// Compile every book template in src/templates with the installed `typst`,
// with a title that needs escaping, and fail on any error or warning.
// Usage: npm run check-templates [-- --png <dir>]  (also renders page images)
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../src/templates/', import.meta.url).pathname;
const pngDir = process.argv.includes('--png') ? process.argv[process.argv.indexOf('--png') + 1] : null;
// Same escaping as typstString() in src/templates/index.ts.
const str = (v) => v.replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const values = { title: 'The "Quiet" Harbour \\ Part One', author: 'Ada Example', year: '2026' };

function fill(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) fill(p);
    else if (p.endsWith('.typ')) writeFileSync(p, readFileSync(p, 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => str(values[k])));
  }
}

const version = execFileSync('typst', ['--version'], { encoding: 'utf8' }).trim();
let failed = 0;
for (const id of readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory())) {
  const work = mkdtempSync(join(tmpdir(), `typst-template-${id}-`));
  cpSync(join(root, id), work, { recursive: true });
  fill(work);
  try {
    const args = ['compile', '--diagnostic-format', 'short', 'main.typ', 'out.pdf'];
    const run = spawnSync('typst', args, { cwd: work, encoding: 'utf8' });
    const output = `${run.stdout}${run.stderr}`.trim();
    if (run.status !== 0 || /warning/i.test(output)) throw new Error(output || `typst exited with ${run.status}`);
    const pdf = statSync(join(work, 'out.pdf')).size;
    if (pngDir) execFileSync('typst', ['compile', '--format', 'png', '--ppi', '40', 'main.typ', join(pngDir, `${id}-{0p}.png`)], { cwd: work });
    console.log(`ok   ${id} (${Math.round(pdf / 1024)} KB PDF)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${id}\n${e.message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
console.log(`${version}: ${failed ? `${failed} failed` : 'all templates compile'}`);
process.exit(failed ? 1 : 0);
