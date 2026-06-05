#!/usr/bin/env node
/* Controlled live-write beta test for the drinks flow.
   Refuses to mutate unless explicit approval and two beta player logins are present.
   Never prints session tokens or PINs. */
import fs from 'node:fs';

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
const configText = fs.readFileSync('gejast-config.js', 'utf8');
const approvalName = checklist.approval_env?.name || 'GEJAST_ALLOW_LIVE_WRITE_BETA';
const approvalValue = checklist.approval_env?.required_value || 'I_APPROVE_LIVE_BETA_WRITES';

const approved = process.env[approvalName] === approvalValue;
const player1Name = clean(process.env.GEJAST_BETA_PLAYER1_NAME);
const player1Pin = clean(process.env.GEJAST_BETA_PLAYER1_PIN);
const player2Name = clean(process.env.GEJAST_BETA_PLAYER2_NAME);
const player2Pin = clean(process.env.GEJAST_BETA_PLAYER2_PIN);
const scope = normalizeScope(process.env.GEJAST_BETA_SCOPE || 'friends');
const drinkType = clean(process.env.GEJAST_BETA_DRINK_TYPE || 'bier');
const lat = numberEnv('GEJAST_BETA_LAT', 52.3676);
const lng = numberEnv('GEJAST_BETA_LNG', 4.9041);
const accuracy = numberEnv('GEJAST_BETA_ACCURACY', 25);

const SUPABASE_URL = extractConfig('SUPABASE_URL');
const KEY = extractConfig('SUPABASE_PUBLISHABLE_KEY');

const missing = [];
if (!approved) missing.push(`${approvalName}=${approvalValue}`);
if (!player1Name) missing.push('GEJAST_BETA_PLAYER1_NAME');
if (!/^\d{4}$/.test(player1Pin)) missing.push('GEJAST_BETA_PLAYER1_PIN');
if (!player2Name) missing.push('GEJAST_BETA_PLAYER2_NAME');
if (!/^\d{4}$/.test(player2Pin)) missing.push('GEJAST_BETA_PLAYER2_PIN');
if (!SUPABASE_URL || !KEY) missing.push('public Supabase config');

console.log(`Kale Nel drinks live-write beta: ${checklist.site_version || 'unknown version'}`);
console.log(`Target: drinks_create_verify_reject`);
console.log(`Scope: ${scope}`);
console.log(`Drink type: ${drinkType}`);
console.log('');

if (missing.length) {
  console.log('State: blocked. No data was changed.');
  console.log(`Missing: ${missing.join(', ')}`);
  process.exit(0);
}

const evidence = {
  created: null,
  queue: null,
  rejected: null,
  cancelled: null,
  postcheck: null,
};

try {
  const p1 = await login(player1Name, player1Pin);
  const p2 = await login(player2Name, player2Pin);

  const created = await createDrinkEvent(p1.token);
  const eventId = eventIdFrom(created);
  if (!eventId) throw new Error('Created drink response did not include an event id.');
  evidence.created = sanitizeCreated(created, eventId);

  evidence.queue = await queueNearby(eventId).catch((err) => ({ ok:false, reason: err.message || 'queue-check-failed' }));

  const beforeReject = await loadDrinks(p2.token);
  const visibleBeforeReject = findEvent(beforeReject, eventId);
  if (!visibleBeforeReject) throw new Error(`Created drink event ${eventId} was not visible in player2 pending/verify views.`);

  const rejected = await rejectDrinkEvent(p2.token, eventId);
  evidence.rejected = sanitizeResult(rejected);

  evidence.cancelled = await cancelDrinkEvent(p1.token, eventId)
    .then(sanitizeResult)
    .catch((err) => ({ ok:false, reason: err.message || 'cancel-cleanup-failed' }));

  const [afterP1, afterP2] = await Promise.all([
    loadDrinks(p1.token).catch((err) => ({ error: err.message })),
    loadDrinks(p2.token).catch((err) => ({ error: err.message })),
  ]);
  evidence.postcheck = {
    player1_pending: !!findPendingMine(afterP1, eventId),
    player2_verify_visible: !!findEvent(afterP2, eventId),
    rejected_visible: !!findRejected(afterP2, eventId),
    player1_error: afterP1.error || null,
    player2_error: afterP2.error || null,
  };

  console.log('State: complete.');
  console.log(JSON.stringify(evidence, null, 2));
} catch (err) {
  console.error('State: failed.');
  console.error(err?.message || String(err));
  if (evidence.created?.event_id) {
    console.error(`Created event before failure: ${evidence.created.event_id}`);
  }
  process.exit(1);
}

function clean(value) {
  return String(value || '').trim();
}

function normalizeScope(value) {
  return String(value || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
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
    { name:'account_login_bridge_v687', body:{ desired_name:name, entered_pin:pin, display_name_input:name, input_pin:pin, input_username:name, site_scope_input:scope, client_meta:{ source:'check-beta-live-write-drinks' } } },
    { name:'account_login_v687', body:{ desired_name:name, entered_pin:pin, site_scope_input:scope, client_meta:{ source:'check-beta-live-write-drinks' } } },
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

async function contractWrite(token, action, payload) {
  const body = { session_token: token, action, payload: { session_token: token, ...payload }, site_scope_input: scope };
  const data = await rpcFirst([
    { name:'contract_drinks_write_v664', body },
    { name:'contract_drinks_write_v663', body },
    { name:'contract_drinks_write_v391', body },
    { name:'contract_drinks_write_v386', body },
    { name:'contract_drinks_write_v1', body },
  ]);
  if (data && typeof data.ok === 'boolean' && !data.ok) throw new Error(data?.error?.message || data?.message || `${action} failed`);
  return data?.data || data || {};
}

async function createDrinkEvent(token) {
  const payload = { event_type_key: drinkType, quantity: 1, lat, lng, accuracy };
  try {
    return await contractWrite(token, 'create_event', payload);
  } catch (_) {
    return await rpcFirst([
      { name:'create_drink_event_v382', body:{ session_token:token, ...payload } },
      { name:'create_drink_event', body:{ session_token:token, ...payload } },
      { name:'create_drink_event', body:{ session_token_input:token, event_type_key_input:drinkType, quantity_input:1, lat_input:lat, lng_input:lng, accuracy_input:accuracy } },
    ]);
  }
}

async function rejectDrinkEvent(token, eventId) {
  const payload = { drink_event_id: Number(eventId), approve:false, approved:false, lat, lng, accuracy };
  try {
    return await contractWrite(token, 'verify_event', payload);
  } catch (_) {
    return await rpcFirst([
      { name:'verify_drink_event_public', body:{ session_token:token, drink_event_id:Number(eventId), approved:false } },
      { name:'verify_drink_event', body:{ session_token:token, drink_event_id:Number(eventId), approve:false, approved:false, lat, lng, accuracy } },
    ]);
  }
}

async function cancelDrinkEvent(token, eventId) {
  const payload = { drink_event_id: Number(eventId) };
  try {
    return await contractWrite(token, 'cancel_event', payload);
  } catch (_) {
    return await rpcFirst([
      { name:'cancel_my_pending_drink_event', body:{ session_token:token, drink_event_id:Number(eventId) } },
      { name:'cancel_my_pending_drink_event', body:{ session_token_input:token, drink_event_id_input:Number(eventId) } },
    ]);
  }
}

async function queueNearby(eventId) {
  return await rpc('queue_nearby_verification_pushes_v3', {
    request_kind_input: 'drink',
    request_id_input: Number(eventId),
    site_scope_input: scope,
    cooldown_seconds_input: 300,
  });
}

async function loadDrinks(token) {
  const data = await rpcFirst([
    { name:'contract_drinks_read_v664', body:{ session_token:token, viewer_lat:lat, viewer_lng:lng, history_limit:40, site_scope_input:scope } },
    { name:'contract_drinks_read_v663', body:{ session_token:token, viewer_lat:lat, viewer_lng:lng, history_limit:40, site_scope_input:scope } },
    { name:'get_drinks_page_bundle_public_scoped', body:{ session_token:token, viewer_lat:lat, viewer_lng:lng, history_limit:40, site_scope_input:scope } },
    { name:'get_drinks_workflow_public', body:{ session_token:token, viewer_lat:lat, viewer_lng:lng, history_limit:40 } },
  ]);
  return data?.data || data || {};
}

function eventIdFrom(data) {
  return Number(data?.drink_event_id || data?.event_id || data?.id || data?.drink?.id || 0) || null;
}

function rowsFrom(data, names) {
  const out = [];
  for (const name of names) {
    const value = data?.[name] || data?.page?.[name] || data?.bundle?.[name];
    if (Array.isArray(value)) out.push(...value);
  }
  return out;
}

function findEvent(data, eventId) {
  return rowsFrom(data, ['verify_queue', 'all_pending_verifications', 'my_pending_events', 'recent_events'])
    .find((row) => Number(row?.id || row?.drink_event_id) === Number(eventId));
}

function findPendingMine(data, eventId) {
  return rowsFrom(data, ['my_pending_events'])
    .find((row) => Number(row?.id || row?.drink_event_id) === Number(eventId) && String(row?.status || 'pending') === 'pending');
}

function findRejected(data, eventId) {
  return rowsFrom(data, ['recent_rejected', 'recent_events', 'rejected_events'])
    .find((row) => Number(row?.id || row?.drink_event_id) === Number(eventId) && /reject|afgekeurd/i.test(String(row?.status || row?.state || '')));
}

function sanitizeCreated(data, eventId) {
  return {
    event_id: Number(eventId),
    status: data?.status || data?.state || null,
    drink_type: drinkType,
    quantity: 1,
    scope,
  };
}

function sanitizeResult(data) {
  return {
    ok: data?.ok ?? true,
    status: data?.status || data?.state || data?.vote_state || null,
    message: data?.message || null,
  };
}
