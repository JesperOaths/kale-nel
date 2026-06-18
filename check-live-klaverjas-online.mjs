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
const names = [...fixtureBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]).slice(0, 4);

if (!url || !key || !pin || names.length < 4) {
  throw new Error('Controlled beta fixtures are unavailable.');
}

const window = {
  GEJAST_CONFIG: {},
  localStorage: { getItem: () => null },
  sessionStorage: { getItem: () => null },
  location: { search: '' }
};
vm.runInNewContext(
  fs.readFileSync('gejast-klaverjas-online.js', 'utf8'),
  { window, URLSearchParams, fetch, console }
);
const K = window.GEJAST_KLAVERJAS_ONLINE;

async function rpc(name, body) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(`${name} HTTP ${response.status}: ${String(data?.message || '').slice(0, 140)}`);
  }
  return data;
}

const sessions = [];
for (const name of names) {
  const data = await rpc('account_login_bridge_v687', {
    display_name_input: name,
    entered_pin: pin,
    site_scope_input: 'friends'
  });
  if (!data?.session_token) throw new Error('Login returned no session.');
  const accountState = await rpc('account_public_state_v687', {
    session_token_input: data.session_token
  });
  const appState = await rpc('get_jas_app_state', {
    session_token: data.session_token
  });
  if ((accountState.display_name || accountState.my_name) !== name || appState.my_name !== name) {
    throw new Error('Login session is not recognized by account/home state.');
  }
  sessions.push({ name, token: data.session_token });
}
console.log('login: 4/4 sessions valid across account and home state');

const bot = await rpc('klaverjas_online_create', {
  session_token: sessions[0].token,
  site_scope_input: 'friends',
  settings_input: { finish_mode: 'fixed_rounds', bot_count: 3 }
});
await rpc('klaverjas_online_save_state', {
  session_token: sessions[0].token,
  game_id_input: bot.game.id,
  state_input: { ...bot.game.state, phase: 'finished', finished_at: new Date().toISOString() },
  summary_payload: null,
  final_jas_payload: null
});
console.log('bot room: create/save/finish ok');

const room = await rpc('klaverjas_online_create', {
  session_token: sessions[0].token,
  site_scope_input: 'friends',
  settings_input: { finish_mode: 'fixed_rounds', bot_count: 0 }
});
for (let index = 1; index < 4; index += 1) {
  await rpc('klaverjas_online_join', {
    session_token: sessions[index].token,
    lobby_code_input: room.game.lobby_code,
    site_scope_input: 'friends'
  });
}

let full = await rpc('klaverjas_online_get_state', {
  session_token: sessions[0].token,
  game_id_input: room.game.id,
  lobby_code_input: null,
  site_scope_input: 'friends'
});
if ((full.players || []).length !== 4) throw new Error('Four-human join failed.');

const players = full.players.map((player) => ({ name: player.name, is_bot: false }));
const started = K.newClientState(
  players,
  Number(full.game.dealer_index || 0),
  null,
  { finish_mode: 'fixed_rounds', bot_count: 0 }
);
await rpc('klaverjas_online_save_state', {
  session_token: sessions[0].token,
  game_id_input: room.game.id,
  state_input: started,
  summary_payload: K.publicSummary(started, full.game),
  final_jas_payload: null
});

for (let index = 0; index < 4; index += 1) {
  const view = await rpc('klaverjas_online_get_state', {
    session_token: sessions[index].token,
    game_id_input: room.game.id,
    lobby_code_input: null,
    site_scope_input: 'friends'
  });
  if (view.viewer?.seat !== index) throw new Error('Viewer seat mismatch.');
  const handLengths = (view.game?.state?.hands || []).map((hand) => hand.length);
  if (handLengths[index] !== 8 || handLengths.some((length, handIndex) => handIndex !== index && length !== 0)) {
    throw new Error('Private hand redaction failed.');
  }
}
console.log('four-human room: join/deal/rejoin/private hands ok');

full = await rpc('klaverjas_online_get_state', {
  session_token: sessions[0].token,
  game_id_input: room.game.id,
  lobby_code_input: null,
  site_scope_input: 'friends'
});
await rpc('klaverjas_online_save_state', {
  session_token: sessions[0].token,
  game_id_input: room.game.id,
  state_input: { ...full.game.state, phase: 'finished', finished_at: new Date().toISOString() },
  summary_payload: null,
  final_jas_payload: null
});
console.log('cleanup: test room finished');
