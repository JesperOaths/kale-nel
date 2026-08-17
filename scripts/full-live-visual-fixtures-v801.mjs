#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';

const command = String(process.argv[2] || '').trim().toLowerCase();
const SUPABASE_URL = String(process.env.SUPABASE_URL || 'https://uiqntazgnrxwliaidkmy.supabase.co').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const DATABASE_NAME = String(process.env.GEJAST_VISUAL_DB_NAME || 'postgres').trim() || 'postgres';
const RETRY_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 20000;

const configText = fs.readFileSync('gejast-config.js', 'utf8');
const PUBLIC_KEY = configText.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1] || '';
if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
if (!PUBLIC_KEY) throw new Error('Could not resolve checked-in Supabase publishable key');
if (!['provision', 'cleanup'].includes(command)) throw new Error('Usage: node scripts/full-live-visual-fixtures-v801.mjs <provision|cleanup>');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeMessage = (value) => String(value?.message || value || 'unknown').replaceAll(SERVICE_ROLE_KEY, '[SERVICE_ROLE_KEY]').replaceAll(PUBLIC_KEY, '[PUBLIC_KEY]');
const inFilter = (values) => `in.(${values.map((value) => String(value)).join(',')})`;

function fixtureNames() {
  // GITHUB_RUN_ATTEMPT changes on every rerun. Together with GITHUB_RUN_ID this
  // makes each provisioning attempt a fresh namespace, so provision never needs
  // a speculative cleanup/read sweep before the first write.
  const suffix = `${process.env.GITHUB_RUN_ID || 'local'}${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
  return {
    friend1: String(process.env.GEJAST_PLAYER1_NAME || `VisualA_${suffix}`).trim(),
    friend2: String(process.env.GEJAST_PLAYER2_NAME || `VisualB_${suffix}`).trim(),
    family: String(process.env.GEJAST_FAMILY_NAME || `VisualFamily_${suffix}`).trim(),
  };
}

function appendGithubEnv(values) {
  const envPath = String(process.env.GITHUB_ENV || '').trim();
  if (!envPath) return;
  fs.appendFileSync(envPath, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''), 'utf8');
}

async function request(path, { method = 'GET', body = undefined, key = SERVICE_ROLE_KEY, prefer = '' } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (prefer) headers.Prefer = prefer;
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!response.ok) {
        const detail = typeof data === 'string' ? data : (data?.message || data?.error || data?.details || data?.hint || `HTTP ${response.status}`);
        const error = new Error(`${method} ${path}: ${detail}`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }
      return data;
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'AbortError' || error?.retryable !== false;
      if (!retryable || attempt === RETRY_ATTEMPTS) break;
      const delay = attempt * 3000;
      console.error(`fixture REST attempt ${attempt}/${RETRY_ATTEMPTS} failed; retrying in ${delay / 1000}s: ${safeMessage(error)}`);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`${method} ${path} failed`);
}

function queryPath(table, params) {
  const qs = new URLSearchParams(params);
  return `${table}?${qs.toString()}`;
}

async function selectRows(table, params) {
  const data = await request(queryPath(table, params));
  return Array.isArray(data) ? data : [];
}

async function deleteRows(table, params) {
  await request(queryPath(table, params), { method: 'DELETE' });
}

async function collectRoomIds(names, playerIds) {
  const ids = new Set();
  const add = (rows) => rows.forEach((row) => { if (row?.id) ids.add(String(row.id)); });
  add(await selectRows('paardenrace_rooms', { select: 'id', host_name: inFilter(names) }));
  if (playerIds.length) {
    add(await selectRows('paardenrace_rooms', { select: 'id', host_player_id: inFilter(playerIds) }));
    add(await selectRows('paardenrace_rooms', { select: 'id', created_by_player_id: inFilter(playerIds) }));
  }
  return [...ids];
}

async function cleanupState(names, { verify = true } = {}) {
  const players = await selectRows('players', { select: 'id,display_name,is_dummy,hidden_from_public', display_name: inFilter(names) });
  const playerIds = players.map((row) => String(row.id || '')).filter(Boolean);
  const roomIds = await collectRoomIds(names, playerIds);

  if (roomIds.length) await deleteRows('paardenrace_match_history', { room_id: inFilter(roomIds) });
  await deleteRows('klaverjas_online_games', { created_by_player_name: inFilter(names) });
  await deleteRows('pikken_games', { created_by_player_name: inFilter(names) });
  if (playerIds.length) {
    await deleteRows('klaverjas_online_games', { created_by_player_id: inFilter(playerIds) });
    await deleteRows('pikken_games', { created_by_player_id: inFilter(playerIds) });
  }
  if (roomIds.length) await deleteRows('paardenrace_rooms', { id: inFilter(roomIds) });

  await deleteRows('gejast_active_player_metadata_v679', { player_name: inFilter(names) });
  await deleteRows('gejast_player_sessions_v746', { display_name: inFilter(names) });
  if (playerIds.length) await deleteRows('gejast_player_sessions_v746', { player_id: inFilter(playerIds) });
  if (playerIds.length) await deleteRows('players', { id: inFilter(playerIds), is_dummy: 'eq.true', hidden_from_public: 'eq.true' });

  if (!verify) return;
  const residue = [];
  residue.push((await selectRows('players', { select: 'id', display_name: inFilter(names), limit: '1' })).length);
  residue.push((await selectRows('gejast_player_sessions_v746', { select: 'session_token', display_name: inFilter(names), limit: '1' })).length);
  residue.push((await selectRows('gejast_active_player_metadata_v679', { select: 'player_name', player_name: inFilter(names), limit: '1' })).length);
  residue.push((await selectRows('klaverjas_online_games', { select: 'id', created_by_player_name: inFilter(names), limit: '1' })).length);
  residue.push((await selectRows('pikken_games', { select: 'id', created_by_player_name: inFilter(names), limit: '1' })).length);
  residue.push((await selectRows('paardenrace_rooms', { select: 'id', host_name: inFilter(names), limit: '1' })).length);
  if (residue.some(Boolean)) throw new Error(`Visual-audit cleanup residue remains: ${residue.join('|')}`);
  console.log('Visual-audit cleanup PASS with zero residue.');
}

function pinHash(pin) {
  return `md5:${crypto.createHash('md5').update(`${pin}:${DATABASE_NAME}`, 'utf8').digest('hex')}`;
}

function unwrapRpc(data, name) {
  if (data && typeof data === 'object' && !Array.isArray(data) && data[name] !== undefined) return data[name];
  if (Array.isArray(data) && data.length === 1 && data[0] && data[0][name] !== undefined) return data[0][name];
  return data;
}

async function login(displayName, pin, scope) {
  const name = 'account_login_v687';
  const data = unwrapRpc(await request(`rpc/${name}`, {
    method: 'POST',
    key: PUBLIC_KEY,
    body: { desired_name: displayName, entered_pin: pin, site_scope_input: scope, client_meta: {} },
  }), name);
  const token = String(data?.session_token || '').trim();
  if (!/^[0-9a-f]{48}$/.test(token)) throw new Error(`${name} returned no canonical 48-hex session token for ${displayName}`);
  return token;
}

async function provision() {
  const names = fixtureNames();
  const nameList = [names.friend1, names.friend2, names.family];
  if (new Set(nameList.map((name) => name.toLowerCase())).size !== 3) throw new Error('Visual-audit fixture names must be distinct');
  const pins = { friend1: '4826', friend2: '7314', family: '2597' };
  Object.values(pins).forEach((pin) => console.log(`::add-mask::${pin}`));
  // Export names before the first write so the workflow's always() cleanup step can
  // target a partially provisioned attempt if the insert succeeds but a later login fails.
  appendGithubEnv({ GEJAST_PLAYER1_NAME: names.friend1, GEJAST_PLAYER2_NAME: names.friend2, GEJAST_FAMILY_NAME: names.family });

  // Do not perform a cleanup/read sweep before provisioning. The run-id + attempt-id
  // namespace is unique, so such a sweep cannot find legitimate prior state and only
  // multiplies database pressure before the required write. Cleanup remains unconditional
  // after the workflow step and still verifies zero residue.
  const rows = [
    { slug: `visual-a-${names.friend1.toLowerCase()}`, display_name: names.friend1, active: true, pin_hash: pinHash(pins.friend1), approved: true, hidden_from_public: true, is_dummy: true, site_scope: 'friends' },
    { slug: `visual-b-${names.friend2.toLowerCase()}`, display_name: names.friend2, active: true, pin_hash: pinHash(pins.friend2), approved: true, hidden_from_public: true, is_dummy: true, site_scope: 'friends' },
    { slug: `visual-family-${names.family.toLowerCase()}`, display_name: names.family, active: true, pin_hash: pinHash(pins.family), approved: true, hidden_from_public: true, is_dummy: true, site_scope: 'family' },
  ];
  const inserted = await request('players?select=id,display_name,site_scope', { method: 'POST', body: rows, prefer: 'return=representation' });
  if (!Array.isArray(inserted) || inserted.length !== 3) throw new Error('Disposable visual-audit player provisioning did not return exactly three players');

  const token1 = await login(names.friend1, pins.friend1, 'friends');
  const token2 = await login(names.friend2, pins.friend2, 'friends');
  const familyToken = await login(names.family, pins.family, 'family');
  [token1, token2, familyToken].forEach((token) => console.log(`::add-mask::${token}`));
  appendGithubEnv({ GEJAST_PLAYER1_TOKEN: token1, GEJAST_PLAYER2_TOKEN: token2, GEJAST_FAMILY_TOKEN: familyToken });
  console.log('Current Friends + Family visual-audit sessions provisioned through service-role REST fixtures + public login RPC.');
}

const names = fixtureNames();
if (command === 'provision') await provision();
else await cleanupState([names.friend1, names.friend2, names.family], { verify: true });
