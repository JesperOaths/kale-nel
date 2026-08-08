#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v755m_profile_rpc_session_token_repair.sql', 'utf8');
const rollback = fs.readFileSync('GEJAST_v755m_profile_rpc_session_token_repair_ROLLBACK.sql', 'utf8');
const page = fs.readFileSync('my_profile.html', 'utf8');

const lower = sql.toLowerCase();
const updateStart = lower.indexOf('create or replace function public.update_my_profile_settings(');
assert.notEqual(updateStart, -1, 'update function exists');
const updateBody = sql.slice(updateStart, lower.indexOf('$fn$;', updateStart));

// Actual frontend RPC contract remains unchanged.
assert.match(page, /rpc\/get_my_profile_settings/);
assert.match(page, /rpc\/update_my_profile_settings/);
assert.match(page, /JSON\.stringify\(\{session_token:token\(\),display_name_input:/, 'my_profile.html still uses the 3-arg RPC path');
assert.match(sql, /create or replace function public\.get_my_profile_settings\(\s*session_token text default null\s*\)/i);
assert.match(sql, /create or replace function public\.update_my_profile_settings\(\s*session_token text default null,\s*display_name_input text default null,\s*avatar_url_input text default null\s*\)/i);
assert.doesNotMatch(sql, /drop function if exists public\.get_my_profile_settings\(text\);/i, 'must not drop exact get signature');
assert.doesNotMatch(sql, /drop function if exists public\.update_my_profile_settings\(text, text, text\);/i, 'must not drop exact update signature');
assert.match(sql, /drop function if exists public\.get_my_profile_settings\(text, text\);/i, 'obsolete get overload may be dropped');
assert.match(sql, /drop function if exists public\.update_my_profile_settings\(text, text, jsonb\);/i, 'obsolete update overload may be dropped');

// Existing schema is required; narrow repair must not silently create it.
assert.doesNotMatch(sql, /create table if not exists public\.gejast_profile_settings/i);
assert.match(sql, /to_regclass\('public\.gejast_profile_settings'\) is null/i, 'preflight requires existing settings table');
assert.match(sql, /c\.conname = 'gejast_profile_settings_pkey'/i, 'preflight requires existing pkey constraint');

// Ambiguous qualified parameter references are gone from repaired SQL.
assert.match(sql, /v_token text := nullif\(trim\(coalesce\(\$1, ''\)\), ''\);/);
assert.doesNotMatch(sql, /update_my_profile_settings\.session_token/);
assert.doesNotMatch(sql, /get_my_profile_settings\.session_token/);

// Authentication and player resolution must precede every write in update function.
const validateIdx = updateBody.indexOf('if v_token is null then');
const resolveIdx = updateBody.indexOf('v_player := public._tier3_player_from_any_session_v740(v_token);');
const nonNullIdx = updateBody.indexOf('if v_player.id is null then');
const settingsWriteIdx = updateBody.indexOf('insert into public.gejast_profile_settings');
const playerWriteIdx = updateBody.indexOf("execute 'update public.players set");
for (const [name, idx] of Object.entries({ validateIdx, resolveIdx, nonNullIdx, settingsWriteIdx, playerWriteIdx })) {
  assert.ok(idx >= 0, `${name} exists`);
}
assert.ok(validateIdx < resolveIdx, 'session input validation precedes player resolution');
assert.ok(resolveIdx < nonNullIdx, 'player resolution precedes non-null guard');
assert.ok(nonNullIdx < settingsWriteIdx, 'non-null player guard precedes profile settings write');
assert.ok(nonNullIdx < playerWriteIdx, 'non-null player guard precedes player-field writes');
assert.match(updateBody, /exception when others then\s+raise exception 'profile_settings_session_invalid';/i, 'stale/invalid session resolution raises before writes');
assert.match(sql, /on conflict on constraint gejast_profile_settings_pkey/i, 'avoid bare session_token conflict target');

// Function ACL hardening.
assert.match(sql, /revoke all on function public\.get_my_profile_settings\(text\) from public;/i, 'PUBLIC execute revoked for get');
assert.match(sql, /revoke all on function public\.update_my_profile_settings\(text, text, text\) from public;/i, 'PUBLIC execute revoked for update');
assert.match(sql, /grant execute on function public\.get_my_profile_settings\(text\) to anon, authenticated;/i, 'anon/auth get execute granted');
assert.match(sql, /grant execute on function public\.update_my_profile_settings\(text, text, text\) to anon, authenticated;/i, 'anon/auth update execute granted');
assert.match(sql, /notify pgrst, 'reload schema';/i);

assert.match(rollback, /create or replace function public\.update_my_profile_settings/i);
assert.match(rollback, /update_my_profile_settings\.session_token/, 'rollback should restore pre-v755m definition');
assert.match(rollback, /on conflict \(session_token\)/i, 'rollback restores previous conflict target');

console.log('PASS profile RPC v755m hardened static repair contract');
