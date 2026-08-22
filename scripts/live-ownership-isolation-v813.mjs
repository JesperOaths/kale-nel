#!/usr/bin/env node
import fs from 'node:fs';

const token1 = String(process.env.GEJAST_OWNER_TOKEN || '').trim();
const token2 = String(process.env.GEJAST_MEMBER_TOKEN || '').trim();
const name1 = String(process.env.GEJAST_OWNER_NAME || '').trim();
const name2 = String(process.env.GEJAST_MEMBER_NAME || '').trim();
const siteScope = String(process.env.GEJAST_SITE_SCOPE || 'friends').trim() || 'friends';
const timeoutMs = Number(process.env.GEJAST_OWNERSHIP_TIMEOUT_MS || 20000);

if (!/^[0-9a-f]{48}$/i.test(token1) || !/^[0-9a-f]{48}$/i.test(token2) || !name1 || !name2) {
  throw new Error('Two canonical disposable player sessions and names are required');
}

const configText = fs.readFileSync('gejast-config.js', 'utf8');
const supabaseUrl = configText.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const publishableKey = configText.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
if (!supabaseUrl || !publishableKey) throw new Error('Could not resolve checked-in Supabase public config');

const state = { pikkenId:'', paardenCode:'', klaverId:'', klaverCode:'' };
const failures = [];
const safe = (value) => String(value?.message || value || 'unknown')
  .replaceAll(token1, '[OWNER_TOKEN]')
  .replaceAll(token2, '[MEMBER_TOKEN]');
const tokenPayload = (token, extra={}) => ({ session_token:token, session_token_input:token, site_scope_input:siteScope, ...extra });
const gameId = (x) => String(x?.game?.id || x?.game_id || x?.id || '').trim();
const lobbyCode = (x) => String(x?.game?.lobby_code || x?.lobby_code || x?.code || '').trim();
const roomCode = (x) => String(x?.room?.room_code || x?.room_code || x?.code || '').trim().toUpperCase();

async function rpc(name, payload={}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Accept:'application/json', apikey:publishableKey, Authorization:`Bearer ${publishableKey}` },
      body:JSON.stringify(payload),
      cache:'no-store',
      signal:controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw:text }; }
    if (!response.ok) throw new Error(`${name}: ${data?.message || data?.error || data?.details || data?.hint || `HTTP ${response.status}`}`);
    return data && data[name] !== undefined ? data[name] : data;
  } finally {
    clearTimeout(timer);
  }
}

async function expectRejected(label, fn, expected=/host|Alleen de host|mag niet|creator|eigenaar/i) {
  try {
    const value = await fn();
    failures.push(`${label}: unauthorized call unexpectedly succeeded (${JSON.stringify(value).slice(0,180)})`);
  } catch (error) {
    const message = safe(error);
    if (expected && !expected.test(message)) {
      failures.push(`${label}: rejected for an unexpected reason: ${message}`);
    } else {
      console.log(`${label}: unauthorized member rejected PASS`);
    }
  }
}

async function setupPikken() {
  const created = await rpc('pikken_create_lobby_fast_v687', tokenPayload(token1, { config_input:{ start_dice:2, final_certification:true } }));
  state.pikkenId = gameId(created);
  const code = lobbyCode(created);
  if (!state.pikkenId || !code) throw new Error('Pikken ownership fixture returned no id/code');
  await rpc('pikken_join_lobby_fast_v687', tokenPayload(token2, { lobby_code_input:code }));
  await expectRejected('Pikken config ownership', () => rpc('pikken_update_lobby_config_v715', tokenPayload(token2, { game_id_input:state.pikkenId, config_input:{ start_dice:3 } })), /Alleen de host/i);
  await expectRejected('Pikken start ownership', () => rpc('pikken_start_game_scoped', tokenPayload(token2, { game_id_input:state.pikkenId })), /Alleen de host/i);
  await expectRejected('Pikken destroy ownership', () => rpc('pikken_destroy_game_fast_v687', tokenPayload(token2, { game_id_input:state.pikkenId })), /Alleen de host/i);
}

async function cleanupPikken() {
  if (!state.pikkenId) return;
  try { await rpc('pikken_destroy_game_fast_v687', tokenPayload(token1, { game_id_input:state.pikkenId })); }
  catch (error) { console.log(`Pikken cleanup warning: ${safe(error)}`); }
}

async function setupPaardenrace() {
  const created = await rpc('create_paardenrace_room_fast_v687', tokenPayload(token1, { room_code_input:null, room_name_input:null }));
  state.paardenCode = roomCode(created);
  if (!state.paardenCode) throw new Error('Paardenrace ownership fixture returned no room code');
  await rpc('join_paardenrace_room_fast_v687', tokenPayload(token2, { room_code_input:state.paardenCode }));
  await expectRejected('Paardenrace wager verification ownership', () => rpc('verify_paardenrace_wager_safe', tokenPayload(token2, { room_code_input:state.paardenCode, target_player_name_input:name2 })), /Alleen de host/i);
  await expectRejected('Paardenrace start ownership', () => rpc('start_paardenrace_room_safe', tokenPayload(token2, { room_code_input:state.paardenCode })), /Alleen de host/i);
  await expectRejected('Paardenrace disband ownership', () => rpc('disband_paardenrace_room_fast_v687', tokenPayload(token2, { room_code_input:state.paardenCode })), /Alleen de host/i);
}

async function cleanupPaardenrace() {
  if (!state.paardenCode) return;
  try { await rpc('disband_paardenrace_room_fast_v687', tokenPayload(token1, { room_code_input:state.paardenCode })); }
  catch (error) { console.log(`Paardenrace cleanup warning: ${safe(error)}`); }
}

async function setupKlaverjas() {
  const created = await rpc('klaverjas_online_create', { session_token:token1, site_scope_input:siteScope, settings_input:{ bot_count:0, final_certification:true } });
  state.klaverId = gameId(created);
  state.klaverCode = lobbyCode(created);
  if (!state.klaverId || !state.klaverCode) throw new Error('Klaverjas ownership fixture returned no id/code');
  await rpc('klaverjas_online_join', { session_token:token2, lobby_code_input:state.klaverCode, site_scope_input:siteScope });
  await expectRejected('Klaverjas delete ownership', () => rpc('klaverjas_online_delete_room', { session_token:token2, game_id_input:state.klaverId, lobby_code_input:null, site_scope_input:siteScope }), /Alleen de host/i);
}

async function cleanupKlaverjas() {
  if (!state.klaverId) return;
  try { await rpc('klaverjas_online_delete_room', { session_token:token1, game_id_input:state.klaverId, lobby_code_input:null, site_scope_input:siteScope }); }
  catch (error) { console.log(`Klaverjas cleanup warning: ${safe(error)}`); }
}

try {
  await setupPikken();
  await setupPaardenrace();
  await setupKlaverjas();
} finally {
  await cleanupKlaverjas();
  await cleanupPaardenrace();
  await cleanupPikken();
}

if (failures.length) {
  console.error('Live ownership isolation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('RESULT=V813_LIVE_OWNERSHIP_ISOLATION_PASS');
