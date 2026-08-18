#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const state = JSON.parse(fs.readFileSync('release-certification.json', 'utf8'));

assert.equal(state.schema_version, 1, 'unsupported release certification schema');
assert.equal(state.current_version, version, 'release certification state must track root VERSION');
assert(['REVALIDATION_REQUIRED', 'PASS'].includes(state.status), 'invalid release certification state');

// v812 cannot be promoted while its prepared direct-data boundary drifts from the repository
// contract. Keep this conditional so future frontend versions are not permanently coupled to
// a historical SQL-only checker.
if (version === 'v812') {
  await import('./check-v812f-direct-data-boundary.mjs');
}

if (state.status === 'PASS') {
  const acceptancePath = `final-acceptance-${version}.json`;
  assert(fs.existsSync(acceptancePath), `PASS requires ${acceptancePath}`);
  const final = JSON.parse(fs.readFileSync(acceptancePath, 'utf8'));
  assert.equal(final.schema_version, 1, 'unsupported current final acceptance schema');
  assert.equal(final.site_version, version, 'final acceptance must match current VERSION');
  assert.equal(final.status, 'PASS', 'current final acceptance must be PASS');
}

console.log('Release certification state:', state.current_version, state.status);
