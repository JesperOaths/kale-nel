#!/usr/bin/env node
/* Controlled live-write beta test for secondary games.
   Uses only the configured beta player accounts and never prints tokens/PINs. */
import fs from 'node:fs';

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
const configText = fs.readFileSync('gejast-config.js', 'utf8');
const approvalName = checklist.approval_env?.name || 'GEJAST_ALLOW_LIVE_WRITE_BETA';
const approvalValue = checklist.approval_env?.required_value || 'I_APPROVE_LIVE_BETA_WRITES';
const scope = normalizeScope(process.env.GEJAST_BETA_SCOPE || 'friends');

const player1Name = clean(process.env.GEJAST_BETA_PLAYER1_NAME);
const player1Pin = clean(process.env.GEJAST_BETA_PLAYER1_PIN);
const player2Name = clean(process.env.GEJAST_BETA_PLAYER2_NAME);
const player2Pin = clean(process.env.GEJAST_BETA_PLAYER2_PIN);
const player3Name = clean(process.env.GEJAST_BETA_PLAYER3_NAME);
const player3Pin = clean(process.env.GEJAST_BETA_PLAYER3_PIN);
const player4Name = clean(process.env.GEJAST_BETA_PLAYER4_NAME);
const player4Pin = clean(process.env.GEJAST_BETA_PLAYER4_PIN);
const SUPABASE_URL = extractConfig('SUPABASE_URL');
const KEY = extractConfig('SUPABASE_PUBLISHABLE_KEY');

const missing = [];
if (process.env[approvalName] !== approvalValue) missing.push(`${approvalName}=${approvalValue}`);
if (!player1Name) missing.push('GEJAST_BETA_PLAYER1_NAME');
if (!/^\d{4}$/.test(player1Pin)) missing.push('GEJAST_BETA_PLAYER1_PIN');
if (!player2Name) missing.push('GEJAST_BETA_PLAYER2_NAME');
if (!/^\d{4}$/.test(player2Pin)) missing.push('GEJAST_BETA_PLAYER2_PIN');
if (!player3Name) missing.push('GEJAST_BETA_PLAYER3_NAME');
if (!/^\d{4}$/.test(player3Pin)) missing.push('GEJAST_BETA_PLAYER3_PIN');
if (!player4Name) missing.push('GEJAST_BETA_PLAYER4_NAME');
if (!/^\d{4}$/.test(player4Pin)) missing.push('GEJAST_BETA_PLAYER4_PIN');
if (!SUPABASE_URL || !KEY) missing.push('public Supabase config');

console.log(`Kale Nel secondary-games live-write beta: ${checklist.site_version || 'unknown version'}`);
console.log('Target: secondary_game_save_flows');
console.log(`Scope: ${scope}`);
console.log('');

if (missing.length) {
  console.log('State: blocked. No data was changed.');
  console.log(`Missing: ${missing.join(', ')}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const evidence = {};

try {
  const p1 = await login(player1Name, player1Pin);
  const p2 = await login(player2Name, player2Pin);
  const p3 = await login(player3Name, player3Pin);
  const p4 = await login(player4Name, player4Pin);
  evidence.rad = await runCase('rad', () => testRad(p1, p2));
  evidence.beerpong = await runCase('beerpong', () => testBeerpong(p1, p2));
  evidence.boerenbridge = await runCase('boerenbridge', () => testBoerenbridge(p1, p2));
  evidence.klaverjas = await runCase('klaverjas', () => testKlaverjas(p1, p2, p3, p4));

  console.log('State: complete.');
  console.log(JSON.stringify(evidence, null, 2));
} catch (err) {
  console.error('State: failed.');
  console.error(err?.message || String(err));
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(1);
}

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

async function runCase(name, fn) {
  try {
    return await fn();
  } catch (err) {
    return {
      ok: false,
      state: 'failed',
      error: String(err?.message || err || `${name} failed`).slice(0, 320),
    };
  }
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
    } catch (err) {
      last = err;
      const msg = String(err?.message || err || '');
      if (/does not exist|schema cache|could not find the function|could not choose/i.test(msg)) continue;
      throw err;
    }
  }
  throw last || new Error('No matching RPC succeeded.');
}

async function login(name, pin) {
  const data = await rpcFirst([
    { name:'account_login_bridge_v687', body:{ desired_name:name, entered_pin:pin, display_name_input:name, input_pin:pin, input_username:name, site_scope_input:scope, client_meta:{ source:'check-beta-live-write-secondary-games' } } },
    { name:'account_login_v687', body:{ desired_name:name, entered_pin:pin, site_scope_input:scope, client_meta:{ source:'check-beta-live-write-secondary-games' } } },
    { name:'account_login_bridge_v687', body:{ display_name_input:name, pin_input:pin, site_scope_input:scope } },
    { name:'account_login_v687', body:{ display_name_input:name, pin_input:pin, site_scope_input:scope } },
    { name:'login_player', body:{ desired_name:name, entered_pin:pin } },
    { name:'login_player', body:{ input_username:name, entered_pin:pin } },
    { name:'login_player', body:{ input_display_name:name, input_pin:pin } },
  ]);
  const token = clean(data?.session_token || data?.player_session_token || data?.token);
  if (!token) throw new Error(`Login for ${name} did not return a session token.`);
  return { name, token };
}

async function testRad(p1, p2) {
  const spin = await rpc('rad_log_spin_scoped', {
    session_token: p1.token,
    segment_key_input: `beta_tier3_rad_${stamp}`,
    segment_label_input: `Beta tier 3 rad ${stamp}`,
    segment_type_input: 'beta-test',
    chance_input: 1,
    copy_text_input: 'Controlled Tier 3 beta spin',
    drinks_input: [],
    meta_input: { source:'check-beta-live-write-secondary-games', beta:true, stamp },
    site_scope_input: scope,
  });
  const spinId = Number(spin?.spin_id || 0);
  const target = await rpc('rad_log_target_nomination_scoped', {
    session_token: p1.token,
    spin_id_input: spinId || null,
    segment_key_input: `beta_tier3_rad_${stamp}`,
    segment_label_input: `Beta tier 3 rad ${stamp}`,
    target_player_name_input: p2.name,
    meta_input: { source:'check-beta-live-write-secondary-games', beta:true, stamp },
    site_scope_input: scope,
  });
  return {
    ok: !!spinId,
    spin_id: spinId || null,
    target_id: Number(target?.target_id || target?.id || 0) || null,
    target_player: p2.name,
  };
}

async function testBeerpong(p1, p2) {
  const clientMatchId = `beta-tier3-beerpong-${stamp}`;
  const payload = {
    match_format: '1v1',
    team_a_player_names: [p1.name],
    team_b_player_names: [p2.name],
    winner_team: 'team_a',
    team_a_cups_left: 2,
    team_b_cups_left: 0,
    finished_at: new Date().toISOString(),
    beta_test: true,
    source: 'check-beta-live-write-secondary-games',
  };
  const out = await rpc('save_beerpong_match', {
    session_token: p1.token,
    client_match_id: clientMatchId,
    payload,
  });
  return {
    ok: out?.ok !== false,
    match_id: Number(out?.match_id || 0) || null,
    client_match_id: clientMatchId,
    ratings_applied: !!out?.ratings_applied,
  };
}

async function testBoerenbridge(p1, p2) {
  const clientMatchId = `beta-tier3-boerenbridge-${stamp}`;
  const payload = {
    match_name: `Beta tier 3 boerenbridge ${stamp}`,
    match_status: 'finished',
    started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    finished_at: new Date().toISOString(),
    players: [p1.name, p2.name],
    winner_names: [p1.name],
    totals: [
      { name:p1.name, final_total_points:42 },
      { name:p2.name, final_total_points:31 },
    ],
    beta_test: true,
    source: 'check-beta-live-write-secondary-games',
  };
  const out = await rpc('save_boerenbridge_match', {
    session_token: p1.token,
    client_match_id: clientMatchId,
    rules_version: 'beta-tier3',
    app_version: checklist.site_version || 'beta',
    match_payload: payload,
  });
  return {
    ok: out?.ok !== false,
    match_id: Number(out?.match_id || 0) || null,
    client_match_id: clientMatchId,
    stats_applied: !!out?.stats_applied,
  };
}

async function testKlaverjas(p1, p2, p3, p4) {
  const title = `Beta tier 3 klaverjas ${stamp}`;
  const playedAt = new Date().toISOString().slice(0, 10);
  const payload = {
    title,
    played_at: playedAt,
    variant: '4_player',
    scoreboard_mode: 'teams',
    beta_test: true,
    source: 'check-beta-live-write-secondary-games',
    participants: [
      { name: p1.name, seat_no: 1, team_no: 1, total_points: 1521, is_winner: true },
      { name: p2.name, seat_no: 2, team_no: 2, total_points: 1197, is_winner: false },
      { name: p3.name, seat_no: 3, team_no: 1, total_points: 1521, is_winner: true },
      { name: p4.name, seat_no: 4, team_no: 2, total_points: 1197, is_winner: false },
    ],
  };
  const out = await rpc('create_jas_game', {
    session_token: p1.token,
    game_payload: payload,
  });
  return {
    ok: out?.ok !== false,
    game_id: Number(out?.game_id || 0) || null,
    title,
    players: [p1.name, p2.name, p3.name, p4.name],
  };
}
