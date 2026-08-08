#!/usr/bin/env node
import fs from 'node:fs';

const scorerPath = 'scorer.html';
let scorer = fs.readFileSync(scorerPath, 'utf8');
const replacements = [
  ['â™£', '♣'],
  ['â™¥', '♥'],
  ['â™ ', '♠'],
  ['â™¦', '♦'],
  ['??n', 'één'],
];
for (const [from, to] of replacements) {
  if (!scorer.includes(from)) throw new Error(`Expected scorer corruption not found: ${from}`);
  scorer = scorer.replaceAll(from, to);
}
for (const [from] of replacements) {
  if (scorer.includes(from)) throw new Error(`Scorer corruption remains after repair: ${from}`);
}
fs.writeFileSync(scorerPath, scorer, 'utf8');

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const check = 'node check-active-frontend-encoding-v767.mjs';
if (!String(pkg.scripts?.['verify:static'] || '').includes(check)) {
  pkg.scripts['verify:static'] += ` && ${check}`;
}
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
fs.writeFileSync('VERSION', 'v767\n', 'utf8');
console.log('Applied v767 active scorer encoding repair and release bump.');
