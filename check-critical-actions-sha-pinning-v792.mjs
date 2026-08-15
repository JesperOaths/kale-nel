#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const approved = new Map([
  ['actions/checkout', 'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09'],
  ['actions/setup-node', 'a0853c24544627f65ddf259abe73b1d18a591444'],
]);

const critical = [
  '.github/workflows/verify.yml',
  '.github/workflows/dependency-security.yml',
  '.github/workflows/live-deployment-health.yml',
  '.github/workflows/apply-repair-sql.yml',
  '.github/workflows/controlled-live-game-flows.yml',
  '.github/workflows/setup-beta-users.yml',
  '.github/workflows/web-push-dispatcher.yml',
];

let externalUses = 0;
for (const file of critical) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const spec = match[1];
    if (spec.startsWith('./')) continue;
    assert.ok(!spec.startsWith('docker://'), `${file} uses a Docker action that needs an explicit digest policy: ${spec}`);
    const at = spec.lastIndexOf('@');
    assert.ok(at > 0, `${file} contains an external action without a ref: ${spec}`);
    const action = spec.slice(0, at);
    const ref = spec.slice(at + 1);
    assert.match(ref, /^[0-9a-f]{40}$/, `${file} must pin ${action} to an immutable 40-character commit SHA`);
    assert.ok(approved.has(action), `${file} uses an unreviewed external action: ${action}`);
    assert.equal(ref, approved.get(action), `${file} does not use the approved immutable commit for ${action}`);
    externalUses += 1;
  }
}

assert.ok(externalUses >= 10, `expected the critical workflow set to contain the reviewed action surface, found ${externalUses}`);

console.log(`Critical GitHub Actions pinning PASS: ${externalUses} external uses across ${critical.length} critical workflows are immutable and approved.`);
console.log('RESULT=CRITICAL_ACTIONS_SHA_PINNING_V792_PASS');
