#!/usr/bin/env node
// Sign the program the app carries (Tinymist, in src-tauri/bundled/) for
// notarizing: Apple checks every program inside the app, and Tauri signs only
// the app itself and its sidecars, not this, which goes in as a resource. Run
// after bundle-tinymist.mjs, before `tauri build`, which copies it in as it is.
//
// It's signed with the hardened runtime and a secure timestamp, as notarizing
// requires, then run once, to be sure it still starts. The assistants aren't
// in the app: each person installs their own.
//
// Usage: node scripts/sign-bundled.mjs "Developer ID Application: Name (TEAMID)"
//        node scripts/sign-bundled.mjs -     (ad hoc: to try the hardened runtime on this Mac)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const fail = (message) => {
  console.error(`sign-bundled: ${message}`);
  process.exit(1);
};

const identity = process.argv[2] ?? process.env.APPLE_SIGNING_IDENTITY ?? fail('give the signing identity, or - for ad hoc');
const adHoc = identity === '-';

const PROGRAMS = ['src-tauri/bundled/tinymist/tinymist'];

for (const path of PROGRAMS) {
  if (!existsSync(path)) fail(`${path} isn't there: run scripts/bundle-tinymist.mjs first`);
  // An ad hoc signature can't have a timestamp.
  const args = ['--force', '--options', 'runtime', ...(adHoc ? [] : ['--timestamp']), '--sign', identity, path];
  execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', path], { stdio: 'inherit' });
  const version = execFileSync(path, ['--version'], { encoding: 'utf8' }).split('\n')[0];
  console.log(`sign-bundled: ${path} (${version.trim() || 'runs'})`);
}
