#!/usr/bin/env node
/* Controlled reversible profile-edit beta proof.
   Refuses to mutate unless explicit approval and one beta player login are present.
   Captures original display/avatar values, makes one temporary display-name-only change,
   verifies it, restores the original values in finally, and verifies restoration.
   Never prints PINs, session tokens, or avatar contents. */
import fs from 'node:fs';

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
const configText = fs.readFileSync('gejast-config.js', 'utf8');
const approvalName = checklist.approval_env?.name || 'GEJAST_ALLOW_LIVE_WRITE_BETA';
const approvalValue = checklist.approval_env?.required_value || 'I_APPROVE_LIVE_BETA_WRITES';
const approved = process.env[approvalName] === approvalValue;
const playerName = clean(process.env.GEJAST_BETA_PLAYER1_NAME);
const playerPin = clean(process.env.GEJAST_BETA_PLAYER1_PIN);
const scope = normalizeScope(process.env.GEJAST_BETA_SCOPE || 'friends');
const SUPABASE_URL = extractConfig('SUPABASE_URL');
const KEY = extractConfig('SUPABASE_PUBLISHABLE_KEY');

const missing = [];
if (!approved) missing.push(`${approvalName}=${approvalValue}`);
if (!playerName) missing.push('GEJAST_BETA_PLAYER1_NAME');
if (!/^\d{4}$/.test(playerPin)) missing.push('GEJAST_BETA_PLAYER1_PIN');
if (!SUPABASE_URL || !KEY) missing.push('public Supabase config');

console.log(`Kale Nel reversible profile beta proof: ${checklist.site_version || 'unknown version'}`);
console.log('Target: profile_editing');
console.log(`Scope: ${scope}`);
console.log('Safety: display name only; original display/avatar restored in finally; secrets/avatar contents are never printed.');
console.log('');

if (missing.length) {
  console.log('State: blocked. No data was changed.');
  console.log(`Missing: ${missing.join(', ')}`);
  process.exit(0);
}

let sessionToken = '';
let original = null;
let changed = false;
let primaryError = null;
let restoreError = null;

try {
  sessionToken = await login(playerName, playerPin);
  original = normalizeSettings(await getSettings(sessionToken));
  if (!original.display_name) throw new Error('Profile settings did not return a display name; refusing reversible edit.');

  const temporaryName = buildTemporaryName(original.display_name);
  if (temporaryName === original.display_name) throw new Error('Could not construct a distinct reversible temporary display name.');

  await updateSettings(sessionToken, temporaryName, original.avatar_url);
  changed = true;
  const afterChange = normalizeSettings(await getSettings(sessionToken));
  if (afterChange.display_name !== temporaryName) throw new Error('Temporary display name did not persist exactly.');
  if (afterChange.avatar_url !== original.avatar_url) throw new Error('Avatar changed during display-name-only proof.');

  console.log('Temporary profile edit verified. Restoration is running now.');
} catch (error) {
  primaryError = error;
} finally {
  if (sessionToken && original) {
    try {
      await updateSettings(sessionToken, original.display_name, original.avatar_url);
      const restored = normalizeSettings(await getSettings(sessionToken));
      if (restored.display_name !== original.display_name) throw new Error('Original display name was not restored exactly.');
      if (restored.avatar_url !== original.avatar_url) throw new Error('Original avatar value was not restored exactly.');
      console.log(`RESTORE_PASS changed=${changed} display_name_restored=true avatar_restored=true`);
    } catch (error) {
      restoreError = error;
    }
  }
}

if (restoreError) {
  console.error('State: failed-restoration. Manual profile restoration may be required before any further mutation testing.');
  console.error(String(restoreError?.message || restoreError));
  process.exit(1);
}
if (primaryError) {
  console.error('State: failed, but restoration passed.');
  console.error(String(primaryError?.message || primaryError));
  process.exit(1);
}

console.log('State: complete. Temporary display-name edit was verified and original profile values were restored.');

function clean(value) {
  return String(value || '').trim();
}

function normalizeScope(value) {
  return String(value || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
}

function extractConfig(name) {
  const pattern = new RegExp(`${name}\\s*:\\s*['"]([^'"]+)['"]`);
  return configText.match(pattern)?.[1] || '';
}

function headers() {
  return {
    'Content-Type': 'application/json',
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    Accept: 'application/json',
  };
}

async function parse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || `HTTP ${res.status}`);
  return data;
}

async function rpc(name, body) {
  const raw = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: headers(),
    body: JSON.stringify(body || {}),
  }).then(parse);
  return raw && raw[name] !== undefined ? raw[name] : raw;
}

async function rpcFirst(calls) {
  let last = null;
  for (const call of calls) {
    try {
      return await rpc(call.name, call.body);
    } catch (error) {
      last = error;
      const message = String(error?.message || error || '');
      if (/does not exist|schema cache|could not find the function|could not choose/i.test(message)) continue;
      throw error;
    }
  }
  throw last || new Error('No matching RPC succeeded.');
}

async function login(name, pin) {
  const data = await rpcFirst([
    { name:'account_login_bridge_v687', body:{ desired_name:name, entered_pin:pin, display_name_input:name, input_pin:pin, input_username:name, site_scope_input:scope, client_meta:{ source:'check-beta-live-write-profile' } } },
    { name:'account_login_v687', body:{ desired_name:name, entered_pin:pin, site_scope_input:scope, client_meta:{ source:'check-beta-live-write-profile' } } },
    { name:'account_login_bridge_v687', body:{ display_name_input:name, pin_input:pin, site_scope_input:scope } },
    { name:'account_login_v687', body:{ display_name_input:name, pin_input:pin, site_scope_input:scope } },
    { name:'login_player', body:{ desired_name:name, entered_pin:pin } },
    { name:'login_player', body:{ input_username:name, entered_pin:pin } },
    { name:'login_player', body:{ input_display_name:name, input_pin:pin } },
  ]);
  const token = clean(data?.session_token || data?.player_session_token || data?.token);
  if (!token) throw new Error('Player login did not return a session token.');
  return token;
}

async function getSettings(token) {
  return rpc('get_my_profile_settings', { session_token: token });
}

async function updateSettings(token, displayName, avatarUrl) {
  const data = await rpc('update_my_profile_settings', {
    session_token: token,
    display_name_input: displayName,
    avatar_url_input: avatarUrl,
  });
  if (data && data.ok === false) throw new Error(data?.message || data?.error || 'Profile update returned ok=false.');
  return data;
}

function normalizeSettings(data) {
  const row = data?.data || data || {};
  return {
    display_name: clean(row.display_name || row.player_name),
    avatar_url: String(row.profile_picture_url ?? row.avatar_url ?? ''),
  };
}

function buildTemporaryName(originalName) {
  const suffix = ' · beta';
  const max = 40;
  const base = clean(originalName).slice(0, Math.max(1, max - suffix.length));
  let candidate = `${base}${suffix}`;
  if (candidate === originalName) candidate = `${base.slice(0, Math.max(1, base.length - 1))}· beta`;
  return candidate.slice(0, max);
}
