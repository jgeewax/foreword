#!/usr/bin/env node
// Generates fixtures/stress-book/: a large multi-file Typst book used as the
// reference workload for the SPEC §6 responsiveness budgets. Deterministic.
//
//   node scripts/gen-stress-book.mjs [--chapters 60] [--pad 4800] [--out DIR]
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    chapters: { type: 'string', default: '60' },
    sections: { type: 'string', default: '6' },
    paragraphs: { type: 'string', default: '5' },
    pad: { type: 'string', default: '4800' },
    out: { type: 'string', default: resolve(import.meta.dirname, '../fixtures/stress-book') },
  },
});
const N = Number(opt.chapters);
const out = resolve(opt.out);

let seed = 0x5eed;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const WORDS = (
  'matrix vector space basis span kernel image rank linear map operator scalar field norm inner product ' +
  'orthogonal projection subspace dimension eigenvalue eigenvector determinant trace transpose inverse ' +
  'the of and a to in is that for it as with be on by this are from or an which we can these such ' +
  'every each when then therefore hence because consider suppose observe note recall define proof result'
).split(' ');
const sentence = () => {
  const n = 8 + Math.floor(rand() * 14);
  const w = Array.from({ length: n }, () => pick(WORDS));
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(' ') + '.';
};
const paragraph = (sentences = 5) => Array.from({ length: sentences }, sentence).join(' ');
const EQS = [
  'A bold(v) = lambda bold(v)',
  'det(A - lambda I) = 0',
  'norm(bold(x))^2 = sum_(i=1)^n x_i^2',
  'P = A (A^T A)^(-1) A^T',
  'integral_0^1 f(t) dif t = F(1) - F(0)',
  'mat(a, b; c, d)^(-1) = 1 / (a d - b c) mat(d, -b; -c, a)',
];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'chapters'), { recursive: true });
mkdirSync(join(out, 'figures'), { recursive: true });
copyFileSync(resolve(import.meta.dirname, '../fixtures/sample-book/figures/span.svg'), join(out, 'figures/span.svg'));

const bib = [];
for (let k = 0; k < 40; k++) {
  bib.push(`@book{ref${k},\n  author = {Author ${k}},\n  title = {${sentence().slice(0, -1)}},\n  publisher = {Fixture Press},\n  year = {${1990 + k}},\n}\n`);
}
writeFileSync(join(out, 'refs.bib'), bib.join('\n'));

const chapterFiles = [];
for (let c = 1; c <= N; c++) {
  const lines = [`= Chapter ${c}: ${pick(WORDS)} and ${pick(WORDS)} <ch-${c}>`, '', paragraph(4), ''];
  for (let s = 1; s <= Number(opt.sections); s++) {
    lines.push(`== Section ${c}.${s} <sec-${c}-${s}>`, '');
    for (let p = 1; p <= Number(opt.paragraphs); p++) {
      lines.push(paragraph());
      if (p === 2) lines.push('', `$ ${pick(EQS)} $ <eq-${c}-${s}>`);
      lines.push('');
    }
    const refs = [];
    if (s > 1) refs.push(`@eq-${c}-${s - 1}`);
    if (c > 1) refs.push(`@ch-${c - 1}`);
    lines.push(`This builds on ${refs.length ? refs.join(' and ') : 'the definitions above'} @ref${(c * 7 + s) % 40}.`, '');
    if (s % 3 === 0) {
      lines.push(`#figure(image("../figures/span.svg", width: 45%), caption: [${sentence()}]) <fig-${c}-${s}>`, '');
    }
  }
  const name = `chapters/ch${String(c).padStart(2, '0')}.typ`;
  writeFileSync(join(out, name), lines.join('\n'));
  chapterFiles.push(name);
}

writeFileSync(
  join(out, 'main.typ'),
  `#set document(title: "Stress Book")
#set page(paper: "a5", margin: (x: 1.8cm, y: 2cm), numbering: "1")
#set text(size: 10.5pt)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  it
}

#outline(depth: 1)

${chapterFiles.map((f) => `#include "${f}"`).join('\n')}

#bibliography("refs.bib")
`,
);

// Non-Typst padding so the tree resembles a real repo (exercises Explorer/Quick Open).
const pad = Number(opt.pad);
for (let i = 0; i < pad; i++) {
  const dir = join(out, 'notes', `batch${String(Math.floor(i / 100)).padStart(2, '0')}`);
  if (i % 100 === 0) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `note${String(i).padStart(4, '0')}.md`), `# Note ${i}\n\n${sentence()}\n`);
}

console.log(`wrote ${out}: ${N} chapters, ${pad} padding files`);
