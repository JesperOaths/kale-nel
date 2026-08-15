#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const config = fs.readFileSync('_config.yml', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const quotedEntries = [...config.matchAll(/^\s*-\s+"([^"]+)"\s*$/gm)].map((match) => match[1]);
const excluded = new Set(quotedEntries);

const required = [
  '.github/',
  'scripts/',
  'cloudflare/',
  'sql/',
  'repo/',
  'mnt/',
  'deployment_forensics_v761/',
  'RELEASES/',
  'docs/',
  'check-*.mjs',
  'package.json',
  'package-lock.json',
  'gameplay-acceptance.json',
  'beta-live-write-checklist.json',
  '*.md', '**/*.md',
  '*.txt', '**/*.txt',
  '*.json', '**/*.json',
  '*.csv', '**/*.csv',
  '*.xml', '**/*.xml',
  '*.body', '**/*.body',
  '*.yml', '**/*.yml',
  '*.yaml', '**/*.yaml',
  '*.sql', '**/*.sql',
  '*.patch', '**/*.patch',
  '*.ps1', '**/*.ps1',
  '*.py', '**/*.py',
  '*.sh', '**/*.sh',
  '*.toml', '**/*.toml',
  '*.mjs', '**/*.mjs',
  'ADMIN_*',
  'AUDIT_*',
  'APPLY_*',
  '*_PROOF_*',
  '*_MATRIX_*',
  'gejast-family-rollout-v437.js',
  'gejast-mobile-foundation-v581.css',
  'gejast-mobile-foundation-v581.js',
  'gejast-mobile-foundation-v582.css',
  'gejast-mobile-foundation-v582.js'
];

for (const entry of required) {
  assert.ok(excluded.has(entry), `GitHub Pages exclusion is missing repository-only boundary: ${entry}`);
}

for (const forbidden of [
  '*.html', '**/*.html',
  '*.css', '**/*.css',
  '*.js', '**/*.js',
  '*.png', '**/*.png',
  '*.jpg', '**/*.jpg',
  '*.jpeg', '**/*.jpeg',
  '*.webp', '**/*.webp',
  '*.svg', '**/*.svg',
  '*.ico', '**/*.ico',
  'CNAME', 'VERSION'
]) {
  assert.ok(!excluded.has(forbidden), `Publication boundary must not blanket-exclude runtime web asset: ${forbidden}`);
}

assert.match(
  pkg.scripts?.['verify:static'] ?? '',
  /(?:^|&&\s*)node check-pages-publication-boundary-v792\.mjs(?:\s*&&|$)/,
  'verify:static must enforce the Pages publication boundary'
);

// The repository currently has no active frontend dependency on the globally
// excluded data/evidence file classes. Guard that assumption so a future real
// runtime dependency cannot be silently broken by the Pages deny boundary.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const nonRuntimePrefixes = [
  '.github/',
  'cloudflare/',
  'scripts/',
  'sql/',
  'repo/',
  'mnt/',
  'deployment_forensics_v761/',
  'RELEASES/',
  'docs/'
];

const activeSources = tracked.filter((file) =>
  /\.(?:html|js|css)$/i.test(file) &&
  !/^check-/.test(file) &&
  !nonRuntimePrefixes.some((prefix) => file.startsWith(prefix))
);

const globallyExcludedExtensions = new Set([
  '.md', '.txt', '.json', '.csv', '.xml', '.body', '.yml', '.yaml',
  '.sql', '.patch', '.ps1', '.py', '.sh', '.toml', '.mjs'
]);

const excludedTrackedFiles = tracked.filter((file) =>
  globallyExcludedExtensions.has(path.extname(file).toLowerCase())
);

const sourceBodies = activeSources.map((file) => [file, fs.readFileSync(file, 'utf8')]);
const dependencyViolations = [];
for (const excludedFile of excludedTrackedFiles) {
  const basename = path.basename(excludedFile);
  for (const [sourceFile, body] of sourceBodies) {
    if (body.includes(excludedFile) || body.includes(basename)) {
      dependencyViolations.push(`${sourceFile} -> ${excludedFile}`);
    }
  }
}

assert.deepEqual(
  dependencyViolations,
  [],
  `Active frontend references a globally excluded Pages artifact. Add a deliberate publication exception instead of weakening the boundary:\n${dependencyViolations.join('\n')}`
);

const historicalWebFiles = [
  'gejast-family-rollout-v437.js',
  'gejast-mobile-foundation-v581.css',
  'gejast-mobile-foundation-v581.js',
  'gejast-mobile-foundation-v582.css',
  'gejast-mobile-foundation-v582.js'
];
for (const historicalFile of historicalWebFiles) {
  assert.ok(tracked.includes(historicalFile), `historical Pages exclusion no longer maps to a tracked provenance file: ${historicalFile}`);
  for (const [sourceFile, body] of sourceBodies) {
    if (sourceFile === historicalFile) continue;
    assert.ok(
      !body.includes(historicalFile),
      `Historical/dead web file became an active runtime dependency and must be reclassified: ${sourceFile} -> ${historicalFile}`
    );
  }
}

console.log(`GitHub Pages publication boundary PASS: ${activeSources.length} active web sources checked against ${excludedTrackedFiles.length} excluded evidence files.`);
console.log('RESULT=PAGES_PUBLICATION_BOUNDARY_V792_PASS');
