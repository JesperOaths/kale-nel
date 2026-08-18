#!/usr/bin/env node
import fs from 'node:fs';

const tokenA = String(process.env.GEJAST_PLAYER1_TOKEN || '').trim();
const tokenB = String(process.env.GEJAST_PLAYER2_TOKEN || '').trim();
const nameA = String(process.env.GEJAST_PLAYER1_NAME || '').trim();
const nameB = String(process.env.GEJAST_PLAYER2_NAME || '').trim();
const clientId = String(process.env.GEJAST_TOEPEN_CLIENT_ID || '').trim();
if (![tokenA, tokenB].every((v) => /^[0-9a-f]{48}$/.test(v)) || !nameA || !nameB || !clientId) {
  throw new Error('missing controlled v801a REST proof fixture configuration');
}

const config = fs.readFileSync('gejast-config.js', 'utf8');
const supabaseUrl = config.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const publishableKey = config.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
if (!supabaseUrl || !publishableKey) throw new Error('checked-in public Supabase configuration not found');

const payload = {
  client_match_id: clientId,
  game_type: 'toepen',
  played_at: new Date().toISOString(),
  target_points: 10,
  ruleset: {},
  participants: [
    { seat_no: 1, name: nameA, start_points: 0, end_points: 0, eliminated: false, finish_rank: 1 },
    { seat_no: 2, name: nameB, start_points: 0, end_points: 1, eliminated: false, finish_rank: 2 },
  ],
  rounds: [{
    round_no: 1,
    dealer_seat: 1,
    winner_seat: 1,
    winner_name: nameA,
    stake_final: 1,
    knock_count: 0,
    special_tags: [],
    note: 'v801a PostgREST production proof',
    results: [
      { seat_no: 1, name: nameA, action: 'win', penalty_points: 0 },
      { seat_no: 2, name: nameB, action: 'stay', penalty_points: 1 },
    ],
  }],
};

async function call(sessionToken, scope = 'friends') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_toepen_game`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
      body: JSON.stringify({ session_token: sessionToken, game_payload: payload, site_scope_input: scope }),
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { status: response.status, ok: response.ok, data, text };
  } finally {
    clearTimeout(timer);
  }
}

function message(result) {
  return String(result?.data?.message || result?.data?.error || result?.text || '');
}
function requireSuccess(result, label) {
  if (!result.ok || result?.data?.ok !== true) {
    throw new Error(`${label} failed status=${result.status} message=${message(result)}`);
  }
}
function requireRejected(result, pattern, label) {
  const msg = message(result);
  if (result.ok || !pattern.test(msg)) {
    throw new Error(`${label} was not rejected as required status=${result.status} message=${msg}`);
  }
}

const first = await call(tokenA, 'friends');
requireSuccess(first, 'owner first save');
if (first.data.already_saved !== false || !first.data.game_id) throw new Error(`first save contract mismatch ${JSON.stringify(first.data)}`);
const gameId = String(first.data.game_id);
console.log(`TOEPEN_V801A_REST_FIRST_SAVE_PASS game_id=${gameId} already_saved=false`);

const replay = await call(tokenA, 'friends');
requireSuccess(replay, 'same-owner replay');
if (String(replay.data.game_id) !== gameId || replay.data.already_saved !== true) throw new Error(`same-owner replay contract mismatch ${JSON.stringify(replay.data)}`);
console.log(`TOEPEN_V801A_REST_SAME_OWNER_REPLAY_PASS game_id=${gameId} already_saved=true`);

const cross = await call(tokenB, 'friends');
requireRejected(cross, /toepen_game_owner_mismatch/i, 'cross-owner replay');
console.log(`TOEPEN_V801A_REST_CROSS_OWNER_REJECT_PASS status=${cross.status}`);

const invalid = await call('f'.repeat(48), 'friends');
requireRejected(invalid, /Niet ingelogd/i, 'invalid session');
console.log(`TOEPEN_V801A_REST_INVALID_SESSION_REJECT_PASS status=${invalid.status}`);

const wrongScope = await call(tokenA, 'family');
requireRejected(wrongScope, /Verkeerde Toepen-scope/i, 'wrong scope');
console.log(`TOEPEN_V801A_REST_SCOPE_REJECT_PASS status=${wrongScope.status}`);

console.log(`RESULT=V805_TOEPEN_V801A_POSTGREST_OWNER_GUARD_PASS game_id=${gameId} same_owner=true cross_owner_rejected=true invalid_session_rejected=true wrong_scope_rejected=true`);
