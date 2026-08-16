#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const state = JSON.parse(fs.readFileSync('release-certification.json', 'utf8'));

assert.equal(state.schema_version, 1, 'unsupported release certification schema');
assert.equal(state.current_version, version, 'release certification state must track root VERSION');
assert(['REVALIDATION_REQUIRED', 'PASS'].includes(state.status), 'invalid release certification state');

if (state.status === 'PASS') {
  const acceptancePath = `final-acceptance-${version}.json`;
  assert(fs.existsSync(acceptancePath), `PASS requires ${acceptancePath}`);
  const final = JSON.parse(fs.readFileSync(acceptancePath, 'utf8'));
  assert.equal(final.schema_version, 1, 'unsupported current final acceptance schema');
  assert.equal(final.site_version, version, 'final acceptance must match current VERSION');
  assert.equal(final.status, 'PASS', 'current final acceptance must be PASS');
}

console.log('Release certification state:', state.current_version, state.status);
