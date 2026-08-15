#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/verify.yml', 'utf8');

assert.equal(
  pkg.scripts?.verify,
  'npm run verify:static && npm run verify:js',
  'package.json verify must remain the canonical full repository verification entrypoint'
);
assert.match(
  pkg.scripts?.['verify:static'] ?? '',
  /(?:^|&&\s*)node check-canonical-gejast-gate-v792\.mjs(?:\s*&&|$)/,
  'verify:static must protect the canonical GEJAST gate itself'
);
assert.match(
  workflow,
  /^\s*- name: Canonical repository verification\s*\n\s*run: npm run verify\s*$/m,
  'GEJAST verification workflow must execute npm run verify as its canonical repository gate'
);

console.log('Canonical npm verification is required by GEJAST CI.');
console.log('RESULT=CANONICAL_GEJAST_GATE_V792_PASS');
