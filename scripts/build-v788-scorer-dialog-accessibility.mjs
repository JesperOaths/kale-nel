#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const fail = (message) => { throw new Error(message); };
const replaceOnce = (text, before, after, owner) => {
  const count = text.split(before).length - 1;
  if (count !== 1) fail(`${owner}: expected exactly one match, got ${count}: ${before}`);
  return text.replace(before, after);
};

const from = fs.readFileSync('VERSION', 'utf8').trim();
if (from !== 'v787') fail(`expected v787 baseline, got ${from}`);

let scorer = fs.readFileSync('scorer.html', 'utf8');
scorer = replaceOnce(
  scorer,
  '<div class="modal" role="dialog" aria-modal="true">\n      <h2>Wie spelen er mee?</h2>',
  '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="setupDialogTitle">\n      <h2 id="setupDialogTitle">Wie spelen er mee?</h2>',
  'setup dialog'
);
scorer = replaceOnce(
  scorer,
  '<div class="modal" role="dialog" aria-modal="true" id="bidModal">\n      <h2>Bieding voor ronde <span id="bidRoundNo">1</span></h2>',
  '<div class="modal" role="dialog" aria-modal="true" id="bidModal" aria-labelledby="bidDialogTitle">\n      <h2 id="bidDialogTitle">Bieding voor ronde <span id="bidRoundNo">1</span></h2>',
  'bid dialog'
);
fs.writeFileSync('scorer.html', scorer);
fs.writeFileSync('VERSION', 'v788\n');

const checklistPath = 'beta-live-write-checklist.json';
const checklist = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));
checklist.site_version = 'v788';
if (!Array.isArray(checklist.items) || checklist.items.length !== 0) fail('live-write checklist unexpectedly contains armed items');
fs.writeFileSync(checklistPath, JSON.stringify(checklist, null, 2) + '\n');

const readinessPath = 'beta-readiness.json';
const readiness = JSON.parse(fs.readFileSync(readinessPath, 'utf8'));
if (readiness.deployment_identity?.live_version !== 'v787') fail('expected live v787 before v788 candidate');
readiness.site_version = 'live v787 / release candidate v788';
readiness.last_updated = '2026-08-12';
readiness.deployment_identity.release_candidate_version = 'v788';
readiness.deployment_identity.evidence = Array.isArray(readiness.deployment_identity.evidence) ? readiness.deployment_identity.evidence : [];
const candidateEvidence = '2026-08-12 v788 candidate: canonical Klaverjas setup and bid dialogs receive visible-title accessible names via aria-labelledby; no gameplay/layout/backend owner changed.';
if (!readiness.deployment_identity.evidence.includes(candidateEvidence)) readiness.deployment_identity.evidence.push(candidateEvidence);
const staticIntegrity = (readiness.baseline_checks || []).find((item) => item.id === 'static_integrity');
if (!staticIntegrity) fail('static_integrity readiness entry missing');
if (!String(staticIntegrity.evidence || '').includes('v788')) {
  staticIntegrity.evidence = `${String(staticIntegrity.evidence || '').trim()} v788 adds explicit visible-title accessible names to the two existing canonical Klaverjas scorer dialogs without changing gameplay or layout.`;
}
fs.writeFileSync(readinessPath, JSON.stringify(readiness, null, 2) + '\n');

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const guard = 'node check-scorer-dialog-accessibility-v788.mjs';
if (!String(pkg.scripts?.['verify:static'] || '').includes(guard)) {
  pkg.scripts['verify:static'] = `${pkg.scripts['verify:static']} && ${guard}`;
}
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

execFileSync(process.execPath, ['fix-version-drift.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['check-scorer-dialog-accessibility-v788.mjs'], { stdio: 'inherit' });
console.log('V788_SCORER_DIALOG_ACCESSIBILITY_BUILD=PASS');
