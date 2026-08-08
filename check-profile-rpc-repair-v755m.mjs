#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v755m_profile_rpc_session_token_repair.sql', 'utf8');
const rollback = fs.readFileSync('GEJAST_v755m_profile_rpc_session_token_repair_ROLLBACK.sql', 'utf8');
const page = fs.readFileSync('my_profile.html', 'utf8');

assert.match(page, /rpc\/get_my_profile_settings/);
assert.match(page, /rpc\/update_my_profile_settings/);
assert.match(page, /JSON\.stringify\(\{session_token:token\(\),display_name_input:/, 'my_profile.html still uses the 3-arg RPC path');

assert.match(sql, /create or replace function public\.get_my_profile_settings\(\s*session_token text default null\s*\)/i);
assert.match(sql, /create or replace function public\.update_my_profile_settings\(\s*session_token text default null,\s*display_name_input text default null,\s*avatar_url_input text default null\s*\)/i);
assert.match(sql, /v_token text := nullif\(trim\(coalesce\(\$1, ''\)\), ''\);/);
assert.doesNotMatch(sql, /update_my_profile_settings\.session_token/);
assert.doesNotMatch(sql, /get_my_profile_settings\.session_token/);
assert.match(sql, /raise exception 'profile_settings_session_invalid';[\s\S]*insert into public\.gejast_profile_settings/, 'invalid session guard must precede write');
assert.match(sql, /on conflict on constraint gejast_profile_settings_pkey/i, 'avoid bare session_token conflict target');
assert.match(sql, /grant execute on function public\.get_my_profile_settings\(text\) to anon, authenticated;/i);
assert.match(sql, /grant execute on function public\.update_my_profile_settings\(text, text, text\) to anon, authenticated;/i);
assert.match(sql, /notify pgrst, 'reload schema';/i);

assert.match(rollback, /create or replace function public\.update_my_profile_settings/i);
assert.match(rollback, /update_my_profile_settings\.session_token/, 'rollback should restore pre-v755m definition');
assert.match(rollback, /on conflict \(session_token\)/i, 'rollback restores previous conflict target');

console.log('PASS profile RPC v755m static repair contract');
