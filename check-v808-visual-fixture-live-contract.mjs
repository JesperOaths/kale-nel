#!/usr/bin/env node
import fs from 'node:fs';

const path = 'scripts/full-live-visual-fixtures-v801.mjs';
const source = fs.readFileSync(path, 'utf8');

const failures = [];
const requireText = (needle, label) => {
  if (!source.includes(needle)) failures.push(`missing ${label}`);
};
const forbidText = (needle, label) => {
  if (source.includes(needle)) failures.push(`stale ${label}`);
};

requireText("desired_name: displayName", 'account_login_v687 desired_name argument');
requireText("entered_pin: pin", 'account_login_v687 entered_pin argument');
requireText("site_scope_input: scope", 'account_login_v687 site_scope_input argument');
requireText("client_meta: {}", 'account_login_v687 client_meta argument');
forbidText("display_name_input: displayName", 'account_login_v687 display_name_input argument');
requireText("selectRows('gejast_player_sessions_v746', { select: 'session_token', display_name: inFilter(names)", 'session cleanup verification using session_token');
forbidText("selectRows('gejast_player_sessions_v746', { select: 'id', display_name: inFilter(names)", 'session cleanup verification using nonexistent id column');

if (failures.length) {
  console.error(`V808 visual fixture live-contract check failed: ${failures.join('; ')}`);
  process.exit(1);
}

console.log('RESULT=V808_VISUAL_FIXTURE_LIVE_CONTRACT_PASS');
