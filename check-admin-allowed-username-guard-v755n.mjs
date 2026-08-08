#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v755n_admin_allowed_username_security_guard.sql', 'utf8');
const rollback = fs.readFileSync('GEJAST_v755n_admin_allowed_username_security_guard_ROLLBACK.sql', 'utf8');

for (const fn of ['admin_remove_allowed_username', 'admin_permanently_delete_allowed_username']) {
  assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`, 'i'), `${fn} exists`);
  assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(text, bigint\\) from public;`, 'i'), `${fn} PUBLIC execute revoked`);
  assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(text, bigint\\) to anon, authenticated;`, 'i'), `${fn} intended execute grants`);
}

assert.match(sql, /select to_jsonb\(public\.admin_check_session\(admin_session_token\)\) into v_admin_state;/i);
assert.match(sql, /coalesce\(\(v_admin_state->>'ok'\)::boolean, false\) is not true/i, 'must require admin_check_session ok=true');
assert.doesNotMatch(sql, /perform public\.admin_check_session\(admin_session_token\);/i, 'must not use PERFORM-only admin check');
assert.match(sql, /revoke insert, update, delete on table public\.allowed_usernames from public, anon, authenticated;/i, 'must remove direct web-role DML');
assert.match(sql, /set status = 'blocked'/i, 'remove action must use live-allowed blocked status');
assert.match(sql, /'mode', 'blocked_account'/i, 'remove action keeps live blocked_account behavior');
assert.doesNotMatch(sql, /set status = 'archived'/i, 'archived violates current live status constraint');
assert.doesNotMatch(sql, /set status = 'retired_permanently'/i, 'retired_permanently violates current live status constraint');
assert.doesNotMatch(sql, /grant insert, update, delete on table public\.allowed_usernames to (public|anon|authenticated)/i, 'migration must not grant direct web-role DML');
assert.match(sql, /notify pgrst, 'reload schema';/i);

// Safe rollback must preserve proven security boundaries.
assert.match(rollback, /proven security boundary must not be rolled back/i);
assert.match(rollback, /revoke insert, update, delete on table public\.allowed_usernames from public, anon, authenticated;/i, 'rollback preserves direct-DML revoke');
assert.match(rollback, /revoke all on function public\.admin_remove_allowed_username\(text, bigint\) from public;/i);
assert.match(rollback, /revoke all on function public\.admin_permanently_delete_allowed_username\(text, bigint\) from public;/i);
assert.doesNotMatch(rollback, /perform public\.admin_check_session\(admin_session_token\);/i, 'rollback must not restore old perform-only guard');
assert.doesNotMatch(rollback, /grant insert, update, delete on table public\.allowed_usernames to (public|anon|authenticated)/i, 'rollback must not restore direct web-role DML grants');
assert.doesNotMatch(rollback, /create or replace function public\.admin_remove_allowed_username/i, 'rollback should not overwrite hardened function body');
assert.doesNotMatch(rollback, /create or replace function public\.admin_permanently_delete_allowed_username/i, 'rollback should not overwrite hardened function body');

console.log('PASS admin allowed-username v755n hardened guard contract');
