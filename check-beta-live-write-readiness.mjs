#!/usr/bin/env node
/* Live-write beta readiness gate.
   This script does not mutate data. It reports whether any explicitly tracked
   live-write beta targets remain and, if so, whether their inputs are present. */

import fs from 'node:fs';

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
const approvalName = checklist.approval_env?.name || 'GEJAST_ALLOW_LIVE_WRITE_BETA';
const approvalValue = checklist.approval_env?.required_value || 'I_APPROVE_LIVE_BETA_WRITES';
const approved = process.env[approvalName] === approvalValue;
const secondaryTarget = String(process.env.GEJAST_BETA_WRITE_TARGET || '').trim().toLowerCase();
const allowedSecondaryTargets = new Set(['beerpong', 'boerenbridge', 'rad']);

function hasEnv(name) {
  return String(process.env[name] || '').trim().length > 0;
}

function requirementStatus(requirement) {
  if (requirement === 'live_write_approval') return approved;
  if (requirement === 'player1') return hasEnv('GEJAST_BETA_PLAYER1_NAME') && hasEnv('GEJAST_BETA_PLAYER1_PIN');
  if (requirement === 'player2') return hasEnv('GEJAST_BETA_PLAYER2_NAME') && hasEnv('GEJAST_BETA_PLAYER2_PIN');
  if (requirement === 'admin_session') return hasEnv('GEJAST_ADMIN_SESSION_TOKEN');
  if (requirement === 'secondary_target') return allowedSecondaryTargets.has(secondaryTarget);
  return false;
}

const items = Array.isArray(checklist.items) ? checklist.items : [];
console.log(`Kale Nel live-write beta gate: ${checklist.site_version || 'unknown version'}`);

if (!items.length) {
  console.log('State: complete. No live-write beta mutation targets remain armed.');
  console.log('No data was changed. Any future production mutation proof must be added deliberately with a new scoped approval gate.');
  process.exit(0);
}

const rows = items.map((item) => {
  const missing = (item.requires || []).filter((requirement) => !requirementStatus(requirement));
  return { ...item, missing };
});

console.log(`Approval: ${approved ? 'present' : `missing (${approvalName}=${approvalValue})`}`);
if (secondaryTarget) console.log(`Secondary target: ${secondaryTarget}${allowedSecondaryTargets.has(secondaryTarget) ? '' : ' (invalid)'}`);
console.log('');

for (const item of rows) {
  const state = item.missing.length ? 'blocked' : 'ready';
  console.log(`- [${state}] ${item.id} (${item.area})`);
  console.log(`  intent: ${item.intent}`);
  console.log(`  risk: ${item.risk}`);
  if (item.missing.length) console.log(`  missing: ${item.missing.join(', ')}`);
}

const blocked = rows.filter((row) => row.missing.length);
if (blocked.length) {
  console.log('');
  console.log(`Live-write beta tests are not armed. Blocked items=${blocked.length}. No data was changed.`);
  process.exit(0);
}

console.log('');
console.log('Live-write beta inputs are present. Run only the single dedicated mutation target explicitly approved in the current chat.');
