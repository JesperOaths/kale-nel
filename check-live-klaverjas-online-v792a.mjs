import fs from 'node:fs';
import vm from 'node:vm';

if (process.env.GEJAST_ALLOW_LIVE_WRITE !== '1') {
  throw new Error('Set GEJAST_ALLOW_LIVE_WRITE=1 to run the controlled live-write smoke.');
}

const configText = fs.readFileSync('gejast-config.js', 'utf8');
const fixtureSql = fs.readFileSync('GEJAST_v744_beta_test_accounts.sql', 'utf8');
const url = configText.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
const key = configText.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1];
const pin = fixtureSql.match(/v_pin text := '([^']+)'/)?.[1];
const fixtureBlock = fixtureSql.match(/foreach v_name in array array\[([^\]]+)\]/i)?.[1] || '';
const names = [...fixtureBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]).slice(0, 4);
if (!url || !key || !pin || names.length < 4) throw new Error('Controlled beta fixtures are unavailable.');

const window = {
  GEJAST_CONFIG: {},
  localStorage: { getItem: () => null },
  sessionStorage: { getItem: () => null },
  location: { search: '' }
};
vm.runInNewContext(fs.readFileSync('gejast-klaverjas-online.js', 'utf8'), { window, URLSearchParams, fetch, console });
const K = window.GEJAST_KLAVERJAS_ONLINE;

async function rpc(name, body) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${String(data?.message || '').slice(0, 160)}`);
  return data;
}

async function listOpen(token) {
  const rows = await rpc('klaverjas_online_list_open', { session_token: token, site_scope_input: 'friends' });
  return Array.isArray(rows) ? rows : [];
}

async function closeFixtureHostedRooms(sessions, reason) {
  const seen = new Set();
  let closed = 0;
  for (const session of sessions) {
    for (const row of await listOpen(session.token)) {
      if (!row?.is_host || seen.has(row.id)) continue;
      await rpc('klaverjas_online_delete_room', {
        session_token: session.token,
        game_id_input: row.id,
        lobby_code_input: null,
        site_scope_input: 'friends'
      });
      seen.add(row.id);
      closed += 1;
    }
  }
  console.log(`${reason}: closed ${closed} fixture-hosted room(s)`);
}

async function fixtureResidue(sessions) {
  const found = [];
  for (const session of sessions) {
    for (const row of await listOpen(session.token)) {
      if (row?.has_me) found.push(`${session.name}:${row.lobby_code}`);
    }
  }
  return [...new Set(found)];
}

const sessions = [];
for (const name of names) {
  const login = await rpc('account_login_bridge_v687', {
    display_name_input: name,
    entered_pin: pin,
    site_scope_input: 'friends'
  });
  if (!login?.session_token) throw new Error(`No session returned for ${name}.`);
  sessions.push({ name, token: login.session_token });
}

await closeFixtureHostedRooms(sessions, 'preflight');
const stale = await fixtureResidue(sessions);
if (stale.length) throw new Error(`Fixture account is still seated in an existing room: ${stale.join(', ')}`);

let roomId = null;
try {
  const room = await rpc('klaverjas_online_create', {
    session_token: sessions[0].token,
    site_scope_input: 'friends',
    settings_input: { finish_mode: 'fixed_rounds', bot_count: 0 }
  });
  roomId = room.game.id;

  for (let i = 1; i < 4; i += 1) {
    await rpc('klaverjas_online_join', {
      session_token: sessions[i].token,
      lobby_code_input: room.game.lobby_code,
      site_scope_input: 'friends'
    });
  }

  const joined = await rpc('klaverjas_online_get_state', {
    session_token: sessions[0].token,
    game_id_input: roomId,
    lobby_code_input: null,
    site_scope_input: 'friends'
  });
  if ((joined.players || []).length !== 4) throw new Error('Controlled room did not reach four players.');

  const state = K.newClientState(
    joined.players.map((p) => ({ name: p.name, is_bot: false })),
    Number(joined.game.dealer_index || 0),
    null,
    { finish_mode: 'fixed_rounds', bot_count: 0 }
  );
  state.recovery_snapshot = {
    reason: 'v792a-live-privacy-proof',
    hands: state.hands.map((hand) => hand.map((card) => ({ ...card })))
  };

  await rpc('klaverjas_online_save_state', {
    session_token: sessions[0].token,
    game_id_input: roomId,
    state_input: state,
    summary_payload: K.publicSummary(state, joined.game),
    final_jas_payload: null
  });

  for (let i = 0; i < 4; i += 1) {
    const view = await rpc('klaverjas_online_get_state', {
      session_token: sessions[i].token,
      game_id_input: roomId,
      lobby_code_input: null,
      site_scope_input: 'friends'
    });
    if (view.viewer?.seat !== i) throw new Error(`Viewer seat mismatch for fixture ${i}.`);

    const top = view.game?.state?.hands || [];
    const recovery = view.game?.state?.recovery_snapshot?.hands || [];
    const topLengths = top.map((hand) => hand.length);
    const recoveryLengths = recovery.map((hand) => hand.length);
    const ownOnly = (lengths) => lengths[i] === 8 && lengths.every((n, seat) => seat === i || n === 0);
    if (!ownOnly(topLengths)) throw new Error(`Top-level hand projection failed for seat ${i}.`);
    if (!ownOnly(recoveryLengths)) throw new Error(`Recovery hand projection failed for seat ${i}.`);
  }

  console.log('v792a live privacy proof: four seated viewers receive only their own human hand in both state copies');
} finally {
  if (roomId) {
    try {
      await rpc('klaverjas_online_delete_room', {
        session_token: sessions[0].token,
        game_id_input: roomId,
        lobby_code_input: null,
        site_scope_input: 'friends'
      });
    } catch (error) {
      console.log(`controlled room close after proof: ${error.message}`);
    }
  }
  await closeFixtureHostedRooms(sessions, 'postflight');
  const leftovers = await fixtureResidue(sessions);
  if (leftovers.length) throw new Error(`Controlled fixture residue remains: ${leftovers.join(', ')}`);
}

console.log('cleanup: controlled fixture rooms removed; unrelated rooms were never closed');
