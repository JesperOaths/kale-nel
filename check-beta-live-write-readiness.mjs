#!/usr/bin/env node
/* Live-write beta readiness gate.
   This script does not mutate data. It verifies that the remaining beta-write
   tests are explicitly approved and that required inputs are present. */

import fs from 'node:fs';

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
const approvalName = checklist.approval_env?.name || 'GEJAST_ALLOW_LIVE_WRITE_BETA';
const approvalValue = checklist.approval_env?.required_value || 'I_APPROVE_LIVE_BETA_WRITES';
const approved = process.env[approvalName] === approvalValue;

function hasEnv(name) {
  return String(process.env[name] || '').trim().length > 0;
}

function requirementStatus(requirement) {
  if (requirement === 'live_write_approval') return approved;
  if (requirement === 'player1') return hasEnv('GEJAST_BETA_PLAYER1_NAME') && hasEnv('GEJAST_BETA_PLAYER1_PIN');
  if (requirement === 'player2') return hasEnv('GEJAST_BETA_PLAYER2_NAME') && hasEnv('GEJAST_BETA_PLAYER2_PIN');
  if (requirement === 'player3') return hasEnv('GEJAST_BETA_PLAYER3_NAME') && hasEnv('GEJAST_BETA_PLAYER3_PIN');
  if (requirement === 'player4') return hasEnv('GEJAST_BETA_PLAYER4_NAME') && hasEnv('GEJAST_BETA_PLAYER4_PIN');
  if (requirement === 'admin_session') return hasEnv('GEJAST_ADMIN_SESSION_TOKEN');
  if (requirement === 'real_permissioned_device') return hasEnv('GEJAST_REAL_PUSH_DEVICE_READY');
  return false;
}

const rows = checklist.items.map((item) => {
  const missing = (item.requires || []).filter((requirement) => !requirementStatus(requirement));
  return { ...item, missing };
});

console.log(`Kale Nel live-write beta gate: ${checklist.site_version || 'unknown version'}`);
console.log(`Approval: ${approved ? 'present' : `missing (${approvalName}=${approvalValue})`}`);
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
console.log('Live-write beta inputs are present. Use the dedicated mutation harnesses only after final human confirmation in the current chat.');
