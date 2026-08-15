#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SELF = 'check-checker-inventory-v792.mjs';
const deliberateStandalone = new Map([
  ['check-live-ballroom-safe-read-v769a.mjs', 'manual read-only production diagnostic; network-dependent and intentionally outside canonical offline verification'],
  ['check-live-scoped-live-read-v770a.mjs', 'manual read-only production diagnostic with pre/post deployment modes; network-dependent and intentionally outside canonical offline verification'],
  ['check-live-write-matrix-readonly.mjs', 'historical v764/v761 unauthorized-production matrix evidence; retained for provenance, not a current verifier'],
]);

const checks = fs.readdirSync('.')
  .filter((name) => /^check-.*\.mjs$/.test(name))
  .sort();
const pkg = fs.readFileSync('package.json', 'utf8');
const workflowDir = '.github/workflows';
const workflows = fs.readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => fs.readFileSync(path.join(workflowDir, name), 'utf8'));
const checkerBodies = checks
  .filter((name) => name !== SELF)
  .map((name) => [name, fs.readFileSync(name, 'utf8')]);

assert.ok(checks.includes(SELF), 'checker inventory guard must exist');
assert.ok(pkg.includes(SELF), 'checker inventory guard must run through package.json canonical verification');

const unreferenced = [];
for (const name of checks) {
  const npm = pkg.includes(name);
  const workflow = workflows.some((body) => body.includes(name));
  const composed = checkerBodies.some(([other, body]) => other !== name && body.includes(name));
  if (!npm && !workflow && !composed) unreferenced.push(name);
}

assert.deepEqual(
  unreferenced,
  [...deliberateStandalone.keys()].sort(),
  `Every check-*.mjs must be canonical, workflow-owned, composed by another checker, or deliberately classified. Unclassified/stale exceptions: ${unreferenced.join(', ')}`
);

for (const [name, reason] of deliberateStandalone) {
  assert.ok(checks.includes(name), `classified standalone checker is missing: ${name}`);
  assert.ok(reason.length >= 30, `standalone checker classification needs a meaningful reason: ${name}`);
}

const historical = fs.readFileSync('check-live-write-matrix-readonly.mjs', 'utf8');
assert.match(historical, /agent\/v764-live-write-matrix/, 'historical matrix classification depends on its original v764 branch pin');
assert.match(historical, /assert\.equal\(version, 'v761'/, 'historical matrix classification depends on its original v761 production pin');

console.log(`Checker inventory PASS: ${checks.length} checks; ${deliberateStandalone.size} deliberately standalone.`);
console.log('RESULT=CHECKER_INVENTORY_V792_PASS');
