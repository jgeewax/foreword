#!/usr/bin/env node
// Put OpenCode inside the app for a release build (npm run app:build), so
// someone with no assistant installed has one that works. The app uses it
// only when it finds no other OpenCode (src-tauri/src/discover.rs).
//
// OpenCode 2.x isn't published as a release binary (Homebrew builds it from
// source), so this copies one that's installed: the path given, or
// $OPENCODE_BUNDLE, or the `opencode` on PATH. It must be 2.x, whose API the
// app speaks. The copy and OpenCode's MIT licence go to src-tauri/bundled/
// opencode/, which tauri.bundle.json adds to the app's Resources.
//
// Usage: node scripts/bundle-opencode.mjs [path/to/opencode]
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`bundle-opencode: ${message}`);
  process.exit(1);
};

let source = process.argv[2] ?? process.env.OPENCODE_BUNDLE;
if (!source) {
  try {
    source = execFileSync('/usr/bin/which', ['opencode'], { encoding: 'utf8' }).trim();
  } catch {
    fail('no opencode found: install it (brew install opencode) or give its path');
  }
}
const real = realpathSync(source);
const version = execFileSync(real, ['--version'], { encoding: 'utf8' }).trim();
if (!/\bv?2\.\d+\.\d+\b/.test(version)) fail(`${real} is ${version}; the app needs OpenCode 2.x`);
const arch = execFileSync('/usr/bin/file', ['-b', real], { encoding: 'utf8' }).trim();

const dir = new URL('../src-tauri/bundled/opencode/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
copyFileSync(real, `${dir}opencode`);
chmodSync(`${dir}opencode`, 0o755);
writeFileSync(
  `${dir}LICENSE`,
  `OpenCode (${version}), bundled with Foreword.
Source: https://github.com/anomalyco/opencode

MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
);
const mb = Math.round(statSync(`${dir}opencode`).size / 1e6);
console.log(`bundle-opencode: ${version} (${arch}, ${mb} MB) from ${real}`);
