#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v755n_admin_allowed_username_security_guard.sql', 'utf8');
const rollback = fs.readFileSync('GEJAST_v755n_admin_allowed_username_security_guard_ROLLBACK.sql', 'utf8');

for (const fn of ['admin_remove_allowed_username', 'admin_permanently_delete_allowed_username']) {
  assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`, 'i'), `${fn} exists`);
}
assert.match(sql, /select to_jsonb\(public\.admin_check_session\(admin_session_token\)\) into v_admin_state;/i);
assert.match(sql, /coalesce\(\(v_admin_state->>'ok'\)::boolean, false\) is not true/i, 'must require admin_check_session ok=true');
assert.match(sql, /revoke insert, update, delete on table public\.allowed_usernames from public, anon, authenticated;/i, 'must remove direct web-role DML');
assert.match(sql, /grant execute on function public\.admin_remove_allowed_username\(text, bigint\) to anon, authenticated;/i);
assert.match(sql, /grant execute on function public\.admin_permanently_delete_allowed_username\(text, bigint\) to anon, authenticated;/i);
assert.match(sql, /notify pgrst, 'reload schema';/i);

assert.match(rollback, /perform public\.admin_check_session\(admin_session_token\);/i, 'rollback restores old perform-only guard');
assert.match(rollback, /grant insert, update, delete on table public\.allowed_usernames to anon, authenticated;/i, 'rollback restores direct DML grants');

console.log('PASS admin allowed-username v755n guard contract');
