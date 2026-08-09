#!/usr/bin/env node
/* Prints a sanitized, non-mutating plan for remaining live-write beta tests.
   This deliberately does not call mutation RPCs. */
import fs from 'node:fs';

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
const target = String(process.env.GEJAST_BETA_WRITE_TARGET || 'all').trim();
const approvalName = checklist.approval_env?.name || 'GEJAST_ALLOW_LIVE_WRITE_BETA';
const approvalValue = checklist.approval_env?.required_value || 'I_APPROVE_LIVE_BETA_WRITES';
const approved = process.env[approvalName] === approvalValue;
const items = Array.isArray(checklist.items) ? checklist.items : [];

if (!items.length) {
  console.log(`Kale Nel live-write beta plan: ${checklist.site_version || 'unknown version'}`);
  console.log('State: complete. There are no remaining live-write beta targets to plan or arm.');
  console.log('This command changed no live data. Future mutation proof must be introduced as a new explicitly scoped checklist item.');
  process.exit(0);
}

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

const evidence = {
  drinks_create_verify_reject: [
    'create one clearly named beta drink request',
    'verify it appears in pending surfaces',
    'approve or reject through the canonical drinks action',
    'verify history/stats/push-queue surfaces changed as expected',
    'record request id and final state without storing session tokens',
  ],
  admin_mutations: [
    'run one reversible audited admin action at a time',
    'verify the admin audit/history page shows the expected event',
    'undo or mark the beta record where the feature supports reversal',
    'stop after the first unexpected mutation result',
  ],
  badge_awards: [
    'trigger one simple badge condition through a controlled beta outcome',
    'verify profile and leaderboard badge rendering',
    'record badge id/name and affected beta players',
  ],
  secondary_game_save_flows: [
    'run one clearly marked beta save/spin for Klaverjas/scorer, Beerpong, Boerenbridge, and Rad',
    'verify vault/history/stats/odds surfaces after each game',
    'stop and patch the first game owner that fails',
  ],
  profile_editing: [
    'capture current beta profile display fields',
    'apply one reversible display-name/avatar change',
    'verify profile, leaderboard, and game-row rendering',
    'restore the original profile values before finishing',
  ],
  real_device_push_delivery: [
    'confirm a permissioned device/browser has notifications enabled',
    'queue one safe test notification only',
    'verify arrival, click target, and no duplicate queue entries',
    'record device class and result, not endpoint/auth keys',
  ],
};

function selected(item) {
  return target === 'all' || target === item.id || target === item.area;
}

const rows = items.filter(selected).map((item) => {
  const missing = (item.requires || []).filter((requirement) => !requirementStatus(requirement));
  return { ...item, missing, armed: missing.length === 0 };
});

if (!rows.length) {
  console.error(`No beta-write item matched GEJAST_BETA_WRITE_TARGET=${target}`);
  process.exit(1);
}

console.log(`Kale Nel live-write beta plan: ${checklist.site_version || 'unknown version'}`);
console.log(`Target: ${target}`);
console.log(`Approval: ${approved ? 'present' : `missing (${approvalName}=${approvalValue})`}`);
console.log('');

for (const item of rows) {
  console.log(`## ${item.id} (${item.area})`);
  console.log(`state: ${item.armed ? 'armed' : 'blocked'}`);
  console.log(`risk: ${item.risk}`);
  if (item.command) console.log(`command: ${item.command}`);
  if (item.missing.length) console.log(`missing: ${item.missing.join(', ')}`);
  console.log('evidence checklist:');
  for (const step of evidence[item.id] || [item.intent]) console.log(`- ${step}`);
  console.log('');
}

const armed = rows.filter((row) => row.armed);
console.log(`Summary: ${armed.length}/${rows.length} selected item(s) armed. This command changed no live data.`);
if (armed.length) {
  console.log('Run the matching dedicated mutation harness only after confirming this exact target in the current chat.');
}
