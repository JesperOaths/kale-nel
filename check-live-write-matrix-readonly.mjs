#!/usr/bin/env node
/* Read-only/unauthorized production matrix proof.
   This script intentionally avoids valid player/admin credentials. It performs
   production reads plus invalid-caller RPC probes and verifies accessible row
   counts do not change. It never prints secrets, tokens, cookies, or push endpoints. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const configText = fs.readFileSync('gejast-config.js', 'utf8');
const SUPABASE_URL = extractConfig('SUPABASE_URL');
const KEY = extractConfig('SUPABASE_PUBLISHABLE_KEY');
const invalidPlayerToken = 'OC_V764_MATRIX_INVALID_PLAYER_TOKEN';
const invalidAdminToken = 'OC_V764_MATRIX_INVALID_ADMIN_TOKEN';
const testLabel = `OC_V764_MATRIX_20260803_READONLY`;
const scope = 'friends';
const geo = { lat: 53.2194, lng: 6.5665, accuracy: 25 };

if (!SUPABASE_URL || !KEY) throw new Error('Missing public Supabase config');

const proof = {
  at: new Date().toISOString(),
  branch: (await shell('git rev-parse --abbrev-ref HEAD')).trim(),
  head: (await shell('git rev-parse --short HEAD')).trim(),
  production: {},
  baselineCounts: {},
  finalCounts: {},
  rows: [],
};

await preconditions();
await captureBaseline();

await row('DRINK-01 unauthorized create rejection', ['drink_events', 'web_push_jobs'], async () => {
  const out = await rpc('create_drink_event', { session_token: invalidPlayerToken, event_type_key: 'ice', quantity: 1, ...geo });
  return rejectionSummary(out);
});

await row('DRINK-04 unauthorized verify rejection', ['drink_events'], async () => {
  const out = await rpc('verify_drink_event_public', { session_token: invalidPlayerToken, drink_event_id: 0, approved: true, ...geo });
  return rejectionSummary(out);
});

await row('DRINK-05 unauthorized cancel/correction rejection', ['drink_events'], async () => {
  const out = await rpc('cancel_my_pending_drink_event', { session_token: invalidPlayerToken, drink_event_id: 0 });
  return rejectionSummary(out);
});

await row('PROFILE-01/04 invalid session profile update rejection', ['gejast_profile_settings', 'players'], async () => {
  const out = await rpc('update_my_profile_settings', { session_token: invalidPlayerToken, display_name_input: testLabel, avatar_url_input: '' });
  return rejectionSummary(out);
});

await row('ADMIN-02 invalid admin session rejection', ['allowed_usernames', 'web_push_jobs'], async () => {
  const checks = [];
  checks.push(rejectionSummary(await rpc('admin_check_session', { admin_session_token: invalidAdminToken })));
  checks.push(rejectionSummary(await rpc('admin_reserve_allowed_username', { admin_session_token: invalidAdminToken, desired_name_input: testLabel, site_scope_input: scope })));
  checks.push(rejectionSummary(await rpc('admin_queue_targeted_web_push_test_v763', { admin_session_token: invalidAdminToken, target_player_id_input: 0, title_input: testLabel, body_input: 'blocked', dry_run_input: true })));
  return { rejected: checks.every((x) => x.rejected), checks };
});

await row('ADMIN-05 protected admin/vault data access', ['allowed_usernames'], async () => {
  const adminSessions = await rest('admin_sessions?select=*&limit=1');
  const toepenGames = await rest('toepen_games?select=*&limit=1');
  const adminPage = await fetch('https://admin.kalenel.nl/admin.html', { redirect: 'manual', cache: 'no-store' });
  return {
    rejected: adminSessions.status === 401 && toepenGames.status === 401 && [200, 302, 303, 307, 308, 401, 403].includes(adminPage.status),
    table_denials: { admin_sessions: adminSessions.status, toepen_games: toepenGames.status },
    admin_route_status: adminPage.status,
  };
});

await row('TOE-01 invalid session create rejection', [], async () => {
  const out = await rpc('create_toepen_game', { session_token: invalidPlayerToken, site_scope_input: scope, game_payload: { client_match_id: testLabel, participants: ['Test A', 'Test B'], rounds: [] } });
  return rejectionSummary(out);
});

await row('BRIDGE-01 invalid session save rejection', ['boerenbridge_matches'], async () => {
  const out = await rpc('save_boerenbridge_match', { session_token: invalidPlayerToken, client_match_id: `${testLabel}_BRIDGE`, rules_version: 'matrix', app_version: 'v810', match_payload: { source: testLabel, players: ['Test A', 'Test B'], totals: [] } });
  return rejectionSummary(out);
});

await row('KLAVER-01 invalid session online room rejection', ['klaverjas_online_games'], async () => {
  const out = await rpc('klaverjas_online_create', { session_token: invalidPlayerToken, site_scope_input: scope, settings_input: { source: testLabel } });
  return rejectionSummary(out);
});

await row('BEER-01 invalid session save rejection', ['beerpong_matches'], async () => {
  const out = await rpc('save_beerpong_match', { session_token: invalidPlayerToken, client_match_id: `${testLabel}_BEER`, payload: { source: testLabel, match_format: '1v1' } });
  return rejectionSummary(out);
});

await row('RAD-01 invalid session spin rejection', ['rad_spin_events'], async () => {
  const out = await rpc('rad_log_spin_scoped', { session_token: invalidPlayerToken, segment_key_input: testLabel, segment_label_input: testLabel, segment_type_input: 'matrix', chance_input: 1, copy_text_input: 'blocked', drinks_input: [], meta_input: { source: testLabel }, site_scope_input: scope });
  return rejectionSummary(out);
});

await row('PAARD-01 invalid session room rejection', ['paardenrace_rooms'], async () => {
  const out = await rpc('create_paardenrace_room_fast_v687', { session_token: invalidPlayerToken, site_scope_input: scope, settings_input: { source: testLabel } });
  return rejectionSummary(out);
});

await row('PIKKEN-01 invalid session lobby rejection', ['pikken_games'], async () => {
  const out = await rpc('pikken_create_lobby_fast_v722', { session_token: invalidPlayerToken, site_scope_input: scope, settings_input: { source: testLabel } });
  return rejectionSummary(out);
});

await row('NOTIFY-01 service-role dispatcher claim denied to public key', ['web_push_jobs'], async () => {
  const out = await rpc('claim_web_push_jobs_targeted_v763', { batch_size_input: 1, worker_id_input: testLabel });
  return rejectionSummary(out);
});

await captureFinal();

for (const item of proof.rows) {
  assert.equal(item.finalStatus, 'PASS', `${item.id} did not pass: ${JSON.stringify(item)}`);
}

console.log(JSON.stringify(proof, null, 2));

async function preconditions() {
  assert.equal(proof.branch, 'agent/v764-live-write-matrix', 'must run on matrix branch');
  const version = await fetch('https://kalenel.nl/VERSION', { cache: 'no-store' }).then((r) => r.text()).then((t) => t.trim());
  assert.equal(version, 'v761', 'production public frontend version must remain v761');
  const ice = await rest('drink_event_types?select=key,label,unit_value&key=eq.ice');
  assert.equal(ice.status, 200, 'Ice type public read must succeed');
  assert.equal(Array.isArray(ice.data), true, 'Ice read returns rows');
  assert.equal(ice.data.length, 1, 'exactly one Ice type row visible');
  assert.equal(Number(ice.data[0].unit_value), 2.8, 'Ice unit value remains exactly 2.8');
  proof.production = { version, ice_unit_value: Number(ice.data[0].unit_value) };
}

async function captureBaseline() {
  proof.baselineCounts = await counts(['drink_events','web_push_jobs','allowed_usernames','players','gejast_profile_settings','boerenbridge_matches','klaverjas_online_games','jas_games','beerpong_matches','rad_spin_events','paardenrace_rooms','pikken_games']);
}

async function captureFinal() {
  proof.finalCounts = await counts(Object.keys(proof.baselineCounts));
}

async function row(id, tables, fn) {
  const before = await counts(tables);
  const result = await fn();
  const after = await counts(tables);
  const unchanged = sameCounts(before, after);
  const pass = !!result.rejected && unchanged;
  proof.rows.push({
    id,
    actor: id.includes('ADMIN') ? 'invalid-admin/anonymous' : 'invalid-player/anonymous',
    before,
    action: 'production RPC/route probe with invalid or anonymous caller only',
    expected: 'specific safe rejection and zero row-count delta for accessible tables',
    actual: sanitize(result),
    unauthorizedResult: result.rejected ? 'rejected' : 'not rejected',
    duplicateReplayResult: 'not applicable in read-only unauthorized harness; valid replay remains blocked pending authorized test account',
    rollbackResult: unchanged ? 'not required; accessible counts unchanged' : 'FAILED: count changed',
    finalStatus: pass ? 'PASS' : 'FAIL — FIX REQUIRED',
    after,
  });
}

async function counts(tables) {
  const out = {};
  for (const table of tables) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=0`, { headers: { ...headers(), Prefer: 'count=exact' } });
    out[table] = { status: r.status, count: countFromRange(r.headers.get('content-range')) };
    await r.text();
  }
  return out;
}

function sameCounts(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key]?.status || null) !== (b[key]?.status || null)) return false;
    if ((a[key]?.count ?? null) !== (b[key]?.count ?? null)) return false;
  }
  return true;
}

function countFromRange(range) {
  const m = String(range || '').match(/\/(\d+|\*)$/);
  return m && m[1] !== '*' ? Number(m[1]) : null;
}

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers(), body: JSON.stringify(body || {}) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: 'non-json-response' }; }
  return { status: res.status, ok: res.ok, data: sanitizeData(data) };
}

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: 'non-json-response' }; }
  return { status: res.status, ok: res.ok, data: sanitizeData(data) };
}

function rejectionSummary(out) {
  const rejected = !out.ok || out.data?.ok === false || !!out.data?.error || /invalid|missing|permission|unauthorized|session|auth|not found|does not exist/i.test(JSON.stringify(out.data || {}));
  return { rejected, status: out.status, ok: out.ok, code: out.data?.code || null, error: safeError(out.data) };
}

function safeError(data) {
  const msg = data?.message || data?.error || data?.details || data?.hint || null;
  return msg ? String(msg).replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]') : null;
}

function sanitizeData(value) {
  if (Array.isArray(value)) return value.map(sanitizeData);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/token|secret|password|cookie|endpoint|p256dh|auth/i.test(k)) out[k] = '[redacted]';
      else out[k] = sanitizeData(v);
    }
    return out;
  }
  if (typeof value === 'string') return value.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]');
  return value;
}

function sanitize(value) { return sanitizeData(value); }

function headers() {
  return { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' };
}

function extractConfig(name) {
  return configText.match(new RegExp(`${name}\\s*:\\s*['\"]([^'\"]+)['\"]`))?.[1] || '';
}

async function shell(cmd) {
  const { execFile } = await import('node:child_process');
  return await new Promise((resolve, reject) => execFile('powershell', ['-NoProfile', '-Command', cmd], { cwd: process.cwd() }, (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
}
