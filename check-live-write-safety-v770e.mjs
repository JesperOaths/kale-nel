#!/usr/bin/env node
import fs from 'node:fs';

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
const readiness = JSON.parse(fs.readFileSync('beta-readiness.json', 'utf8'));
const gate = fs.readFileSync('check-beta-live-write-readiness.mjs', 'utf8');
const secondary = fs.readFileSync('check-beta-live-write-secondary-games.mjs', 'utf8');
const drinks = fs.readFileSync('check-beta-live-write-drinks.mjs', 'utf8');
const failures = [];

const needsPermission = (readiness.beta_gaps || [])
  .filter((item) => item.status === 'needs_permission')
  .map((item) => item.id)
  .sort();
const checklistIds = (checklist.items || []).map((item) => item.id).sort();

if (checklist.site_version !== 'v770') failures.push(`live-write checklist must target v770, got ${checklist.site_version || '(missing)'}`);
if (JSON.stringify(checklistIds) !== JSON.stringify(needsPermission)) {
  failures.push(`checklist ids must exactly match permission-gated readiness gaps; checklist=${checklistIds.join(',')} readiness=${needsPermission.join(',')}`);
}
if (checklistIds.includes('real_device_push_delivery')) failures.push('already-proven real_device_push_delivery must not remain in mutation checklist');

const secondaryItem = checklist.items.find((item) => item.id === 'secondary_game_save_flows');
if (!secondaryItem) failures.push('secondary_game_save_flows checklist item missing');
else {
  if (/Klaverjas/i.test(secondaryItem.area || '')) failures.push('secondary checklist area must exclude already-proven Klaverjas');
  for (const required of ['player1', 'player2', 'secondary_target', 'live_write_approval']) {
    if (!(secondaryItem.requires || []).includes(required)) failures.push(`secondary checklist missing ${required}`);
  }
  for (const forbidden of ['player3', 'player4']) {
    if ((secondaryItem.requires || []).includes(forbidden)) failures.push(`secondary checklist must not require ${forbidden}`);
  }
}

for (const id of ['admin_mutations', 'badge_awards']) {
  const item = checklist.items.find((entry) => entry.id === id);
  if (!item) failures.push(`${id} checklist item missing`);
  else if (item.command) failures.push(`${id} must remain unarmed until a target-specific reversible harness exists`);
}

if (!gate.includes("new Set(['beerpong', 'boerenbridge', 'rad'])")) failures.push('readiness gate must whitelist exactly the remaining secondary targets');
if (!gate.includes("requirement === 'secondary_target'")) failures.push('readiness gate must require a valid secondary target');

for (const required of [
  "const allowedTargets = new Set(['beerpong', 'boerenbridge', 'rad']);",
  "GEJAST_BETA_WRITE_TARGET=beerpong|boerenbridge|rad",
  "if (target === 'rad')",
  "else if (target === 'beerpong')",
  "else if (target === 'boerenbridge')",
  'Exactly one selected target was executed',
]) {
  if (!secondary.includes(required)) failures.push(`secondary harness missing safety marker: ${required}`);
}
for (const forbidden of ['testKlaverjas', 'create_jas_game', 'GEJAST_BETA_PLAYER3', 'GEJAST_BETA_PLAYER4']) {
  if (secondary.includes(forbidden)) failures.push(`secondary harness must not contain ${forbidden}`);
}

if (!drinks.includes("process.env[approvalName] === approvalValue")) failures.push('drinks harness must retain explicit approval gate');
if (!drinks.includes('rejectDrinkEvent')) failures.push('drinks harness must retain explicit rejection proof');
if (!drinks.includes('cancelDrinkEvent')) failures.push('drinks harness must retain best-effort pending cleanup');

if (failures.length) {
  console.error('Live-write beta safety v770e failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Live-write beta safety v770e PASS: checklist matches five permission gaps; secondary writes are single-target; generic admin/badge writes remain unarmed.');
