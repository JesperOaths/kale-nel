#!/usr/bin/env node
/* GEJAST live game-flow checker.
   Without player tokens, this runs non-destructive public probes.
   With GEJAST_PLAYER1_TOKEN and GEJAST_PLAYER2_TOKEN, it creates/starts/cleans
   Pikken and Paardenrace two-player test rooms. Tokens are never printed. */
import fs from 'node:fs';

const timeoutMs = Number(process.env.GEJAST_GAME_FLOW_TIMEOUT_MS || 15000);
const siteScope = process.env.GEJAST_SITE_SCOPE || 'friends';
const token1 = String(process.env.GEJAST_PLAYER1_TOKEN || '').trim();
const token2 = String(process.env.GEJAST_PLAYER2_TOKEN || '').trim();
const requireTwoPlayer = process.env.GEJAST_REQUIRE_TWO_PLAYER === '1';

function readConfig() {
  const text = fs.readFileSync('gejast-config.js', 'utf8');
  const url = text.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
  const key = text.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
  if (!url || !key) throw new Error('Could not read public Supabase config from gejast-config.js');
  return { url, key };
}

const config = readConfig();
const failures = [];

function safeMessage(error) {
  return String(error?.message || error || 'unknown_error')
    .replaceAll(token1, '[PLAYER1_TOKEN]')
    .replaceAll(token2, '[PLAYER2_TOKEN]');
}

async function rpc(name, payload = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) {
      const msg = data?.message || data?.error || data?.details || data?.hint || `HTTP ${response.status}`;
      const error = new Error(`${name}: ${msg}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data && data[name] !== undefined ? data[name] : data;
  } finally {
    clearTimeout(timer);
  }
}

function tokenPayload(token, extra = {}) {
  return {
    session_token: token,
    session_token_input: token,
    site_scope_input: siteScope,
    ...extra,
  };
}

function arrayish(value, ...keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function roomCode(state) {
  return String(state?.room?.room_code || state?.room_code || state?.code || '').trim().toUpperCase();
}

function gameId(state) {
  return String(state?.game?.id || state?.game_id || state?.id || '').trim();
}

async function publicProbes() {
  const checks = [
    ['get_pikken_open_lobbies_fast_v687', { site_scope_input: siteScope, limit_input: 3 }],
    ['get_pikken_live_matches_fast_v687', { site_scope_input: siteScope, limit_input: 3 }],
    ['get_paardenrace_open_rooms_fast_v687', { site_scope_input: siteScope, limit_input: 3 }],
    ['get_paardenrace_stats_fast_v687', { site_scope_input: siteScope, limit_input: 3 }],
  ];
  for (const [name, payload] of checks) {
    const data = await rpc(name, payload);
    console.log(`${name}: ok (${Array.isArray(data) ? data.length : 'json'} rows)`);
  }
}

async function runPikkenTwoPlayer() {
  let id = '';
  try {
    const created = await rpc('pikken_create_lobby_fast_v687', tokenPayload(token1, {
      config_input: { penalty_mode: 'wrong_loses', start_dice: 6, smoke_test: true },
    }));
    id = gameId(created);
    const code = String(created?.game?.lobby_code || created?.lobby_code || created?.code || '').trim();
    if (!id || !code) throw new Error('Pikken create returned no game id/code');

    await rpc('pikken_join_lobby_fast_v687', tokenPayload(token2, { lobby_code_input: code }));
    await rpc('pikken_set_ready_scoped', tokenPayload(token1, { game_id_input: id, ready_input: true }));
    await rpc('pikken_set_ready_scoped', tokenPayload(token2, { game_id_input: id, ready_input: true }));
    await rpc('pikken_update_lobby_config_v715', tokenPayload(token1, {
      game_id_input: id,
      config_input: { penalty_mode: 'wrong_loses', start_dice: 6, smoke_test: true },
    }));
    const started = await rpc('pikken_start_game_scoped', tokenPayload(token1, { game_id_input: id }));
    const state = started?.game ? started : await rpc('pikken_get_state_scoped', tokenPayload(token1, { game_id_input: id, game_id: id }));
    const players = arrayish(state, 'players');
    const phase = String(state?.game?.state?.phase || state?.game?.status || state?.phase || '').toLowerCase();
    if (players.length < 2) throw new Error(`Pikken started with only ${players.length} player(s) visible`);
    if (!/bidding|live|playing|round|started/.test(phase)) throw new Error(`Pikken unexpected phase after start: ${phase || 'unknown'}`);
    console.log(`Pikken two-player flow: ok (${players.length} players, phase ${phase || 'unknown'})`);
  } finally {
    if (id) {
      try { await rpc('pikken_destroy_game_fast_v687', tokenPayload(token1, { game_id_input: id })); }
      catch (error) { console.log(`Pikken cleanup warning: ${safeMessage(error)}`); }
    }
  }
}

async function runPaardenraceTwoPlayer() {
  let code = '';
  try {
    const created = await rpc('create_paardenrace_room_fast_v687', tokenPayload(token1, { room_code_input: null, room_name_input: null }));
    code = roomCode(created);
    if (!code) throw new Error('Paardenrace create returned no room code');

    await rpc('join_paardenrace_room_fast_v687', tokenPayload(token2, { room_code_input: code }));
    await rpc('update_paardenrace_room_choice_safe', tokenPayload(token1, { room_code_input: code, selected_suit_input: 'spades', wager_bakken_input: 1, ready_input: false }));
    await rpc('update_paardenrace_room_choice_safe', tokenPayload(token2, { room_code_input: code, selected_suit_input: 'hearts', wager_bakken_input: 1, ready_input: false }));

    let state = await rpc('get_paardenrace_room_state_fast_v687', tokenPayload(token1, { room_code_input: code }));
    for (const player of arrayish(state, 'players')) {
      if (Number(player?.wager_bakken || 0) > 0 && !player?.wager_verified && player?.player_name) {
        await rpc('verify_paardenrace_wager_safe', tokenPayload(token1, { room_code_input: code, target_player_name_input: player.player_name }));
      }
    }

    await rpc('set_paardenrace_ready_safe', tokenPayload(token1, { room_code_input: code, ready_input: true }));
    await rpc('set_paardenrace_ready_safe', tokenPayload(token2, { room_code_input: code, ready_input: true }));
    state = await rpc('get_paardenrace_room_state_fast_v687', tokenPayload(token1, { room_code_input: code }));
    const players = arrayish(state, 'players');
    const suits = new Set(players.map((p) => String(p?.selected_suit || '').trim()).filter(Boolean));
    const ready = players.filter((p) => p?.is_ready).length;
    if (players.length < 2) throw new Error(`Paardenrace has only ${players.length} player(s) visible before start`);
    if (suits.size < 2) throw new Error(`Paardenrace has only ${suits.size} distinct suit(s) before start`);
    if (ready < players.length) throw new Error(`Paardenrace ready count ${ready}/${players.length}`);

    const started = await rpc('start_paardenrace_countdown_safe', tokenPayload(token1, { room_code_input: code }));
    const stage = String(started?.room?.stage || '').toLowerCase();
    if (!/countdown|live|race|nominations|finished/.test(stage)) throw new Error(`Paardenrace unexpected stage after start: ${stage || 'unknown'}`);
    console.log(`Paardenrace two-player flow: ok (${players.length} players, ${suits.size} suits, stage ${stage || 'unknown'})`);
  } finally {
    if (code) {
      try { await rpc('disband_paardenrace_room_fast_v687', tokenPayload(token1, { room_code_input: code })); }
      catch (error) { console.log(`Paardenrace cleanup warning: ${safeMessage(error)}`); }
    }
  }
}

try {
  await publicProbes();
  if (token1 && token2) {
    await runPikkenTwoPlayer();
    await runPaardenraceTwoPlayer();
    console.log('Live two-player game flows ok.');
  } else {
    const msg = 'Two-player game flows skipped: set GEJAST_PLAYER1_TOKEN and GEJAST_PLAYER2_TOKEN to run them.';
    if (requireTwoPlayer) failures.push(msg);
    else console.log(msg);
  }
} catch (error) {
  failures.push(safeMessage(error));
}

if (failures.length) {
  console.error(`Live game-flow check failed for ${failures.length} item(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Live game-flow surface ok.');
