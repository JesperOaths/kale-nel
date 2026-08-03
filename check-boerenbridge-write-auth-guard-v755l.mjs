import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('GEJAST_v755l_boerenbridge_write_auth_guard.sql', 'utf8');

assert.match(sql, /revoke\s+insert,\s*update,\s*delete\s+on\s+table\s+public\.boerenbridge_matches\s+from\s+public,\s*anon,\s*authenticated/i, 'direct public writes to boerenbridge_matches are revoked');
assert.match(sql, /revoke\s+insert,\s*update,\s*delete\s+on\s+table\s+public\.boerenbridge_match_rounds\s+from\s+public,\s*anon,\s*authenticated/i, 'direct public writes to boerenbridge_match_rounds are revoked');
assert.match(sql, /revoke\s+insert,\s*update,\s*delete\s+on\s+table\s+public\.boerenbridge_player_stats\s+from\s+public,\s*anon,\s*authenticated/i, 'direct public writes to boerenbridge_player_stats are revoked');
assert.match(sql, /p\s*:=\s*public\._tier3_player_from_any_session_v740\(save_boerenbridge_match\.session_token\)/i, 'RPC resolves player from session');
assert.match(sql, /if\s+p\.id\s+is\s+null\s+then[\s\S]*boerenbridge_session_invalid/i, 'RPC rejects invalid sessions before writing');
assert.match(sql, /v_existing\.created_by_player_id\s+is\s+distinct\s+from\s+p\.id/i, 'RPC blocks cross-player/idempotency overwrite');
assert.match(sql, /v_persisted_owner\s+is\s+null\s+or\s+v_persisted_owner\s+is\s+distinct\s+from\s+p\.id/i, 'RPC asserts persisted owner before success');
assert.doesNotMatch(sql, /created_by_player_id\s*=\s*coalesce\([^;]*excluded\.created_by_player_id/i, 'RPC must not take over existing null-owned rows');
assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.save_boerenbridge_match\(text,\s*text,\s*text,\s*text,\s*jsonb\)\s+from\s+public/i, 'PUBLIC execute is explicitly revoked from the function');
assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.save_boerenbridge_match\(text,\s*text,\s*text,\s*text,\s*jsonb\)\s+to\s+anon,\s*authenticated/i, 'frontend may still execute the guarded RPC');

console.log('Boerenbridge v755l write auth guard regression ok.');
