#!/usr/bin/env node
import fs from 'node:fs';

const config = fs.readFileSync('gejast-config.js', 'utf8');
const base = config.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const key = config.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
if (!base || !key) throw new Error('Public Supabase config not found.');

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Accept: 'application/json'
};

const response = await fetch(`${base}/rest/v1/rpc/get_ballroom_state_safe`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ session_token: null, session_token_input: null })
});
const text = await response.text();
const expectBroken = process.env.GEJAST_EXPECT_BALLROOM_BROKEN === '1';

if (expectBroken) {
  if (response.status !== 400 || !/DELETE requires a WHERE clause/i.test(text)) {
    console.error(`Expected known pre-repair Ballroom failure, got HTTP ${response.status}: ${text.slice(0,500)}`);
    process.exit(1);
  }
  console.log('Ballroom v769a preflight PASS: production reproduces the known safe-read defect and no state mutation was attempted.');
  process.exit(0);
}

if (!response.ok) {
  console.error(`Ballroom safe read expected HTTP 200 after repair, got HTTP ${response.status}: ${text.slice(0,500)}`);
  process.exit(1);
}

let data;
try { data = text ? JSON.parse(text) : null; }
catch { console.error(`Ballroom safe read returned non-JSON: ${text.slice(0,500)}`); process.exit(1); }

if (!data || typeof data !== 'object' || Array.isArray(data)) {
  console.error('Ballroom safe read returned an invalid state object.');
  process.exit(1);
}
const requiredKeys = ['has_king', 'king', 'approved_members', 'succession_line', 'pending_requests', 'viewer'];
const missing = requiredKeys.filter((keyName) => !(keyName in data));
if (missing.length) {
  console.error(`Ballroom safe read missing state keys: ${missing.join(', ')}`);
  process.exit(1);
}
if (!Array.isArray(data.approved_members) || !Array.isArray(data.succession_line) || !Array.isArray(data.pending_requests)) {
  console.error('Ballroom safe read list fields are not arrays.');
  process.exit(1);
}
if (!data.viewer || typeof data.viewer !== 'object' || Array.isArray(data.viewer)) {
  console.error('Ballroom safe read viewer field is invalid.');
  process.exit(1);
}

console.log(`Ballroom safe read v769a LIVE PASS. has_king=${Boolean(data.has_king)} members=${data.approved_members.length} pending=${data.pending_requests.length}`);
