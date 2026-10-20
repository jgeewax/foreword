#!/usr/bin/env node
// Release a version: set it in tauri.conf.json, Cargo.toml and package.json,
// commit just that, tag it v<version>, and push main and the tag. The tag
// starts the release build (.github/workflows/release.yml), which publishes
// the DMG and the update every installed copy is offered.
//
// Usage: npm run release -- 0.2.0
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const version = process.argv[2]?.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('give the version, like: npm run release -- 0.2.0');
const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
if (newer(version, conf.version) <= 0) fail(`${version} isn't newer than ${conf.version}, so installed copies wouldn't be offered it`);
if (git('branch', '--show-current') !== 'main') fail('release from main');
if (git('tag', '--list', `v${version}`)) fail(`v${version} is already tagged`);

const files = ['src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'package.json'];
// Only these files change; anything else in the working tree stays out of the commit.
if (git('diff', '--cached', '--name-only')) fail('something is staged already: commit or unstage it first');
if (git('status', '--porcelain', '--', ...files)) fail(`${files.join(', ')} have changes of their own: commit them first`);

conf.version = version;
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
writeFileSync('src-tauri/Cargo.toml', cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.version = version;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

execFileSync('git', ['commit', '-m', `Version ${version}`, '--', ...files], { stdio: 'inherit' });
execFileSync('git', ['tag', '-a', `v${version}`, '-m', `Foreword ${version}`], { stdio: 'inherit' });
execFileSync('git', ['push', 'origin', 'main', `v${version}`], { stdio: 'inherit' });
console.log(`release: v${version} pushed; the release build is at https://github.com/jgeewax/foreword/actions`);
