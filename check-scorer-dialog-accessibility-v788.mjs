#!/usr/bin/env node
import fs from 'node:fs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const versionNumber = Number(version.match(/^v(\d+)$/)?.[1] || 0);
const html = fs.readFileSync('scorer.html', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const failures = [];

if (versionNumber < 788) failures.push(`expected v788+, got ${version}`);

const required = [
  {
    dialog: '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="setupDialogTitle">',
    heading: '<h2 id="setupDialogTitle">Wie spelen er mee?</h2>',
    id: 'setupDialogTitle'
  },
  {
    dialog: '<div class="modal" role="dialog" aria-modal="true" id="bidModal" aria-labelledby="bidDialogTitle">',
    heading: '<h2 id="bidDialogTitle">Bieding voor ronde <span id="bidRoundNo">1</span></h2>',
    id: 'bidDialogTitle'
  }
];

for (const owner of required) {
  if (!html.includes(owner.dialog)) failures.push(`missing scorer dialog accessibility marker: ${owner.dialog}`);
  if (!html.includes(owner.heading)) failures.push(`missing visible title target: ${owner.heading}`);
  const count = (html.match(new RegExp(`id=["']${owner.id}["']`, 'g')) || []).length;
  if (count !== 1) failures.push(`${owner.id} must occur exactly once, got ${count}`);
  const dialogIndex = html.indexOf(owner.dialog);
  const headingIndex = html.indexOf(owner.heading);
  if (dialogIndex < 0 || headingIndex <= dialogIndex) failures.push(`${owner.id} visible title must be inside/after its dialog opening tag`);
}

const dialogs = [...html.matchAll(/<div\b[^>]*\brole=["']dialog["'][^>]*>/gi)].map((match) => match[0]);
// v788 introduced exactly the setup + bidding dialogs. Preserve that exact historical
// baseline while allowing later releases to add additional, properly named dialogs.
if (versionNumber === 788 && dialogs.length !== 2) failures.push(`v788 baseline expected exactly 2 scorer role=dialog containers, got ${dialogs.length}`);
if (versionNumber > 788 && dialogs.length < 2) failures.push(`newer release must retain at least the 2 v788 scorer dialogs, got ${dialogs.length}`);
for (const dialog of dialogs) {
  if (!/\baria-(?:label|labelledby)=["'][^"']+["']/i.test(dialog)) failures.push(`unnamed scorer dialog remains: ${dialog}`);
}

const guardCommand = 'node check-scorer-dialog-accessibility-v788.mjs';
if (!String(pkg.scripts?.['verify:static'] || '').includes(guardCommand)) failures.push('v788 scorer dialog guard is not wired into verify:static');

if (failures.length) {
  console.error('v788 scorer dialog accessibility regression FAIL:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`v788 scorer dialog accessibility PASS at ${version}: setup and bid dialogs retain visible-title accessible names; every scorer role=dialog remains named; permanent verify wiring is present.`);
