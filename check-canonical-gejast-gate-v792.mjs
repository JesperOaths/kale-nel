#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/verify.yml', 'utf8');

assert.equal(
  pkg.scripts?.verify,
  'npm run verify:static && npm run verify:js && npm run admin-worker:test',
  'package.json verify must remain the canonical full repository verification entrypoint'
);
assert.equal(
  pkg.scripts?.['admin-worker:test'],
  'node scripts/test-admin-worker-gate.mjs',
  'canonical verification must execute the deterministic Cloudflare admin-worker security suite'
);
assert.ok(
  !String(pkg.scripts?.verify ?? '').includes('admin-worker:dry-run'),
  'canonical verification must test the Worker without invoking a Cloudflare deployment path'
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

console.log('Canonical npm verification is required by GEJAST CI, including the non-deploying Cloudflare Worker security suite.');
console.log('RESULT=CANONICAL_GEJAST_GATE_V792_PASS');
