#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflowPath = '.github/workflows/live-deployment-health.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');
const primary = fs.readFileSync('check-beta-readonly-surfaces.mjs', 'utf8');
const extended = fs.readFileSync('check-beta-readonly-extended.mjs', 'utf8');
const perf = fs.readFileSync('check-beta-performance.mjs', 'utf8');

const deploymentGate = 'run: node check-live-routes.mjs';
const primaryGate = 'run: node check-beta-readonly-surfaces.mjs';
const extendedGate = 'run: node check-beta-readonly-extended.mjs';
const perfGate = 'run: node check-beta-performance.mjs';

for (const needle of [deploymentGate, primaryGate, extendedGate, perfGate]) {
  assert.ok(workflow.includes(needle), `${workflowPath} must retain ${needle}`);
}

const deploymentIndex = workflow.indexOf(deploymentGate);
const primaryIndex = workflow.indexOf(primaryGate);
const extendedIndex = workflow.indexOf(extendedGate);
const perfIndex = workflow.indexOf(perfGate);
assert.ok(deploymentIndex < primaryIndex && primaryIndex < extendedIndex && extendedIndex < perfIndex,
  'live acceptance must wait for exact deployed-version health before primary, extended and performance probes');

assert.match(workflow, /GEJAST_DEPLOY_WAIT_SECONDS:\s*'240'/, 'live deployment gate must retain the bounded deployment wait');
assert.match(workflow, /node-version:\s*'24'/, 'live acceptance must stay on Node 24');
assert.doesNotMatch(workflow, /\bsecrets\./, 'read-only live acceptance workflow must not consume repository secrets');

assert.match(primary, /does not log in, submit forms, create records, or mutate live data/i,
  'primary beta checker must retain its explicit non-mutation contract');
assert.match(primary, /redirect:\s*'manual'/, 'primary beta checker must retain manual redirects for protected-route observation');
assert.match(extended, /without login or mutation/i, 'extended beta checker must retain its read-only contract');
assert.match(extended, /response\.status !== 401/, 'extended beta checker must continue enforcing the protected admin perimeter');
assert.match(perf, /method:\s*'HEAD'/, 'performance probe must retain read-only HEAD asset sizing');

console.log('Live read-only beta acceptance wiring PASS: exact-version deployment health precedes primary, extended and performance probes with no workflow secrets.');
console.log('RESULT=LIVE_READONLY_BETA_ACCEPTANCE_V792_PASS');
