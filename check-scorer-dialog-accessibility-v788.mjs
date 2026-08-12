#!/usr/bin/env node
import fs from 'node:fs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const versionNumber = Number(version.match(/^v(\d+)$/)?.[1] || 0);
const html = fs.readFileSync('scorer.html', 'utf8');
const failures = [];

if (versionNumber < 788) failures.push(`expected v788+, got ${version}`);

for (const marker of [
  '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="setupDialogTitle">',
  '<h2 id="setupDialogTitle">Wie spelen er mee?</h2>',
  '<div class="modal" role="dialog" aria-modal="true" id="bidModal" aria-labelledby="bidDialogTitle">',
  '<h2 id="bidDialogTitle">Bieding voor ronde <span id="bidRoundNo">1</span></h2>'
]) {
  if (!html.includes(marker)) failures.push(`missing scorer dialog accessibility marker: ${marker}`);
}

const dialogs = [...html.matchAll(/<div\b[^>]*\brole=["']dialog["'][^>]*>/gi)].map((match) => match[0]);
if (dialogs.length !== 2) failures.push(`expected exactly 2 scorer role=dialog containers, got ${dialogs.length}`);
for (const dialog of dialogs) {
  if (!/\baria-(?:label|labelledby)=["'][^"']+["']/i.test(dialog)) failures.push(`unnamed scorer dialog remains: ${dialog}`);
}

for (const id of ['setupDialogTitle', 'bidDialogTitle']) {
  const count = (html.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length;
  if (count !== 1) failures.push(`${id} must occur exactly once, got ${count}`);
}

if (failures.length) {
  console.error('v788 scorer dialog accessibility regression FAIL:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`v788 scorer dialog accessibility PASS at ${version}: setup and bid dialogs retain visible-title accessible names; no gameplay/layout owner changed.`);
