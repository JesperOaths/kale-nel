#!/usr/bin/env node
/* GEJAST beta readiness tracker.
   This is intentionally non-destructive: it reads the tracked beta proof state
   and reports what is complete, test-ready, permission-gated, or externally blocked. */
import fs from 'node:fs';

const trackerPath = process.env.GEJAST_BETA_READINESS_FILE || 'beta-readiness.json';
const failOnOpen = process.env.GEJAST_BETA_FAIL_ON_OPEN === '1';

function readJson(pathname) {
  return JSON.parse(fs.readFileSync(pathname, 'utf8'));
}

function byPriority(a, b) {
  return Number(a.priority || 999) - Number(b.priority || 999);
}

function statusLabel(status) {
  return String(status || 'unknown').toUpperCase().replaceAll('_', ' ');
}

const tracker = readJson(trackerPath);
const gaps = Array.isArray(tracker.beta_gaps) ? tracker.beta_gaps.slice().sort(byPriority) : [];
const baseline = Array.isArray(tracker.baseline_checks) ? tracker.baseline_checks : [];
const open = gaps.filter((item) => item.status !== 'verified_complete');
const permission = gaps.filter((item) => item.status === 'needs_permission');
const external = gaps.filter((item) => item.status === 'blocked_external');
const ready = gaps.filter((item) => item.status === 'ready_to_test');
const fixIfFail = gaps.filter((item) => item.status === 'needs_fix_if_test_fails');

console.log(`Kale Nel beta readiness tracker: ${trackerPath}`);
console.log(`Tracked site version: ${tracker.site_version || 'unknown'}`);
console.log('');

console.log('Baseline checks:');
for (const check of baseline) {
  console.log(`- [${statusLabel(check.status)}] ${check.id}: ${check.command || check.evidence || ''}`);
}

console.log('');
console.log('Open beta gaps:');
for (const item of open) {
  console.log(`- #${item.priority} [${statusLabel(item.status)}] ${item.area} (${item.id})`);
  console.log(`  proof: ${item.proof_needed}`);
  console.log(`  next: ${item.next_action}`);
}

console.log('');
console.log(`Summary: ${gaps.length - open.length}/${gaps.length} beta gaps verified complete.`);
console.log(`Ready to test: ${ready.length}; needs permission: ${permission.length}; external/device blocked: ${external.length}; fix-if-test-fails: ${fixIfFail.length}.`);

if (open.length) {
  console.log('');
  console.log('Next best action:');
  const next = external[0] || ready[0] || permission[0] || fixIfFail[0] || open[0];
  console.log(`- ${next.area}: ${next.next_action}`);
}

if (failOnOpen && open.length) {
  console.error(`Beta readiness is not complete: ${open.length} open gap(s).`);
  process.exit(1);
}
