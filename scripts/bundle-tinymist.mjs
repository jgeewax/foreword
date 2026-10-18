#!/usr/bin/env node
// Put Tinymist inside the app for a release build (npm run app:build), so the
// preview works on a Mac that doesn't have it. The app uses it only when it
// finds no other Tinymist (src-tauri/src/discover.rs).
//
// Downloads Tinymist's own release build from GitHub, for this Mac or for
// $TINYMIST_ARCH (arm64 or x64), checks it against the release's SHA-256, and
// puts it with its Apache-2.0 licence in src-tauri/bundled/tinymist/, which
// tauri.bundle.json adds to the app's Resources. The version is the one the
// app is built and tested against (docs/decisions.md).
//
// Usage: node scripts/bundle-tinymist.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '0.15.8';

const fail = (message) => {
  console.error(`bundle-tinymist: ${message}`);
  process.exit(1);
};

const arch = process.env.TINYMIST_ARCH ?? (process.arch === 'x64' ? 'x64' : 'arm64');
const triple = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' }[arch] ?? fail(`unknown TINYMIST_ARCH ${arch} (arm64 or x64)`);
const base = `https://github.com/Myriad-Dreamin/tinymist/releases/download/v${VERSION}`;
const archive = `tinymist-${triple}.tar.gz`;

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) fail(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

const [tarball, sums, licence] = await Promise.all([
  get(`${base}/${archive}`),
  get(`${base}/${archive}.sha256`),
  get(`https://raw.githubusercontent.com/Myriad-Dreamin/tinymist/v${VERSION}/LICENSE`),
]);
const expected = sums.toString('utf8').trim().split(/\s+/)[0];
const actual = createHash('sha256').update(tarball).digest('hex');
if (actual !== expected) fail(`${archive}: SHA-256 is ${actual}, the release says ${expected}`);

const work = mkdtempSync(join(tmpdir(), 'bundle-tinymist-'));
try {
  writeFileSync(join(work, archive), tarball);
  execFileSync('/usr/bin/tar', ['-xzf', join(work, archive), '-C', work]);
  const dir = new URL('../src-tauri/bundled/tinymist/', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(work, `tinymist-${triple}`, 'tinymist'), `${dir}tinymist`);
  chmodSync(`${dir}tinymist`, 0o755);
  writeFileSync(`${dir}LICENSE`, `Tinymist ${VERSION}, bundled with Typst Studio.\nSource: https://github.com/Myriad-Dreamin/tinymist\n\n${licence.toString('utf8')}`);
  // It runs (its --version doesn't say the version).
  execFileSync(`${dir}tinymist`, ['--version']);
  const mb = Math.round(statSync(`${dir}tinymist`).size / 1e6);
  console.log(`bundle-tinymist: ${VERSION} for ${arch} (${mb} MB)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
