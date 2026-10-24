#!/usr/bin/env node
// The words of code that spell checking knows (src-tauri/src/proof/code.rs):
// the programming-language and software-terms lists of cspell, VS Code's Code
// Spell Checker (MIT). Downloads them from one pinned commit, checks each
// against its SHA-256, and writes one word list per language to
// src-tauri/src/proof/dictionaries/, which the app compiles in. Run it again
// only to move to a newer commit (then update COMMIT and the hashes).
//
// Usage: node scripts/fetch-proofing-dictionaries.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const COMMIT = 'b43f5f00752d7e940a9df4a4ecbee89c2d2cc5e0';
const BASE = `https://raw.githubusercontent.com/streetsidesoftware/cspell-dicts/${COMMIT}/dictionaries/`;

/** Each list the app has, from these files (and their SHA-256). */
const LISTS = {
  software: {
    'software-terms/dict/softwareTerms.txt': 'b616ed2bc243ec526737c34478e1ccd6552527707398343ba40dd00ca81f5ffd',
    'software-terms/dict/coding-compound-terms.txt': 'd36841073c05801449e8075161831b359f33179f08429bcfb30e038af338e38a',
    'software-terms/dict/software-tools.txt': '7bde41e829aae803bc0ae3e9d51fd232e080c04837043f127e47b33594f82029',
    'software-terms/dict/networkingTerms.txt': 'ee74deb04d179b2baa79b0de7c39c1971cf80fde6551ab3c11151820b95cc6a1',
    'software-terms/dict/computing-acronyms.txt': '3654d7893d7803ec3682c9ffa19a0bff092e4cb6d4caef7d41804c37e3baf18a',
  },
  python: {
    'python/dict/python.txt': '2d99532ba3b2aef4de8369a8798054a4d7f75bba1f68340a337f95cd5af5b655',
    'python/dict/python-common.txt': '5cf3777fb70afa23f9888f2cce456f8cc591c6f7121115356eade6148478b309',
  },
  typescript: { 'typescript/dict/typescript.txt': 'b26553dddacb1b142c169f0a54115e5a3ec15f045ed775157152f61fca743db3' },
  rust: {
    'rust/dict/rust.txt': '2e52162ad38c621456265b5021281e0588bdf85b610b9211349886e2cbf04e9a',
    'rust/dict/crates.txt': '3341edb23613ee68f61ce8454b7df651b697d36138f675989a348ab1c8e6e650',
  },
  go: { 'golang/dict/go.txt': '838c5de2a319b1988e72dc8227a9d176db34ad71394917530dbda0a668dfb646' },
  cpp: {
    'cpp/dict/cpp-refined.txt': '66b4bf77f222dbc736fd9c9a28981b982d3a9b95190e4fb622856d869d8a1e85',
    'cpp/dict/cpp-legacy.txt': '312803b6a3f8745a2b1a4703b16cb85bc9f0a1c682f37cd59b982798017c1285',
  },
  csharp: { 'csharp/dict/csharp.txt': 'b38f88d11f96925573f8f9da68db320394249fac7f9181491c69b57dfd869a95' },
  dart: { 'dart/dict/dart.txt': 'ec7c2f2928ae392a13146bfb609d9e9a67afb72909e0597de2681838520d67fb' },
  ruby: { 'ruby/dict/ruby.txt': 'b2c28325a0cf4ec93ff22a44ae64176348e73c6b9038b98b7936e3a232189647' },
  lua: { 'lua/dict/lua.txt': '0db3d5345a78173a0b03a53c3e3b0c71e5c11384127f16d471923df9bb2a1a29' },
  haskell: { 'haskell/dict/haskell.txt': 'c7e4f0bb6995126b54615c122d0f8ac7986f8031c684b9f87cb4578687a7059b' },
  php: { 'php/dict/php.txt': 'cc6a75a4b8af8abf17377e778f2b968aead466e328538215dd4f70c2d4db3e94' },
  html: { 'html/dict/html.txt': 'ca801c18c3d811ef60f119158691bde34895e44fbf81a719a404e1ce80f8d0cc' },
  css: { 'css/dict/css.txt': '5e8ced686d4e46d90deab89a6871722756ce065523668f526fe2f2c28dd8bf2a' },
  latex: { 'latex/dict/latex.txt': '77f0d07d2ca3bb2d661bd1bb6b49a144f1baa15c926ef0bc19431c42d1cf1ec4' },
};
const LICENCE = ['software-terms/LICENSE', '6245ecd81789d113a600fa0e4f5f503e6d1b4f425860f6047dc945560dfcf13c'];

const fail = (message) => {
  console.error(`fetch-proofing-dictionaries: ${message}`);
  process.exit(1);
};

const get = async (path, sha) => {
  const res = await fetch(BASE + path);
  if (!res.ok) fail(`${path}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha) fail(`${path}: SHA-256 is ${actual}, expected ${sha}`);
  return bytes.toString('utf8');
};

/** cspell's word-list lines as plain words: no comments, no forbidden words (!), no affix marks (* + ~). */
const words = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    .flatMap((l) => l.replace(/^[~+*]+|[+*]+$/g, '').split(/\s+/))
    .filter((w) => /\p{L}/u.test(w));

const dir = new URL('../src-tauri/src/proof/dictionaries/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
let total = 0;
for (const [name, files] of Object.entries(LISTS)) {
  const texts = await Promise.all(Object.entries(files).map(([path, sha]) => get(path, sha)));
  const list = [...new Set(texts.flatMap(words))].sort();
  const body = list.join('\n') + '\n';
  writeFileSync(`${dir}${name}.txt`, body);
  total += body.length;
  console.log(`fetch-proofing-dictionaries: ${name}: ${list.length} words`);
}
const licence = await get(...LICENCE);
writeFileSync(
  `${dir}LICENSE`,
  `Word lists from cspell-dicts (https://github.com/streetsidesoftware/cspell-dicts), commit ${COMMIT},\n` +
    `made by scripts/fetch-proofing-dictionaries.mjs. Each list's package is MIT-licensed:\n\n${licence}`,
);
console.log(`fetch-proofing-dictionaries: ${Math.round(total / 1000)} KB in ${dir}`);
