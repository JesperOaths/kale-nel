#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = fs.readFileSync('_config.yml', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const quotedEntries = [...config.matchAll(/^\s*-\s+"([^"]+)"\s*$/gm)].map((match) => match[1]);
const excluded = new Set(quotedEntries);

const required = [
  '.github/',
  'scripts/',
  'cloudflare/',
  'check-*.mjs',
  'package.json',
  'package-lock.json',
  'gameplay-acceptance.json',
  'beta-live-write-checklist.json',
  '*.sql',
  '**/*.sql',
  '*.patch',
  '**/*.patch',
  'ADMIN_*',
  'AUDIT_*',
  'APPLY_*',
  '*_PROOF_*',
  '*_MATRIX_*'
];

for (const entry of required) {
  assert.ok(excluded.has(entry), `GitHub Pages exclusion is missing repository-only boundary: ${entry}`);
}

for (const forbidden of ['*.html', '**/*.html', '*.css', '**/*.css', '*.js', '**/*.js', '*.png', '**/*.png', '*.jpg', '**/*.jpg', '*.jpeg', '**/*.jpeg', '*.svg', '**/*.svg', 'CNAME']) {
  assert.ok(!excluded.has(forbidden), `Publication boundary must not blanket-exclude runtime web asset: ${forbidden}`);
}

assert.match(
  pkg.scripts?.['verify:static'] ?? '',
  /(?:^|&&\s*)node check-pages-publication-boundary-v792\.mjs(?:\s*&&|$)/,
  'verify:static must enforce the Pages publication boundary'
);

console.log('GitHub Pages repository-only publication boundary is guarded.');
console.log('RESULT=PAGES_PUBLICATION_BOUNDARY_V792_PASS');
