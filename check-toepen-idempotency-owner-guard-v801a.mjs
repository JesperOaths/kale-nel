import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('./GEJAST_v801a_toepen_idempotency_owner_guard.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('./GEJAST_v801a_toepen_idempotency_owner_guard_ROLLBACK.sql', import.meta.url), 'utf8');

assert.match(sql, /create or replace function public\.create_toepen_game\(\s*session_token text,\s*game_payload jsonb,\s*site_scope_input text default 'friends'\s*\)/i, 'signature must remain stable');
assert.match(sql, /viewer := public\._tier3_player_from_any_session_v740\(session_token\)/i, 'current session validation must remain');
assert.match(sql, /select id, created_by_player_id, lower\(coalesce\(site_scope,'friends'\)\)[\s\S]*into existing_id, existing_owner_id, existing_scope[\s\S]*where client_match_id=client_id/i, 'existing match lookup must load owner and scope');
assert.match(sql, /existing_owner_id is distinct from viewer\.id[\s\S]*coalesce\(existing_scope,''\) <> use_scope[\s\S]*raise exception 'toepen_game_owner_mismatch'/i, 'foreign, wrong-scope and ownerless replays must fail closed');
const viewerAt = sql.indexOf('viewer := public._tier3_player_from_any_session_v740(session_token)');
const lookupAt = sql.indexOf('select id, created_by_player_id');
const mismatchAt = sql.indexOf("raise exception 'toepen_game_owner_mismatch'");
const replayAt = sql.indexOf("return jsonb_build_object('ok',true,'game_id',existing_id,'already_saved',true)");
assert.ok(viewerAt >= 0 && viewerAt < lookupAt, 'session validation must precede existing-match lookup');
assert.ok(lookupAt < mismatchAt && mismatchAt < replayAt, 'owner/scope denial must precede idempotent game_id return');
assert.match(sql, /Alleen een deelnemer mag dit Toepen-potje opslaan/i, 'saver participant guard must remain');
assert.match(sql, /totals_check\.end_points <> totals_check\.calculated_points/i, 'v755o totals consistency guard must remain');
assert.match(sql, /Toepen-eindscore komt niet overeen met rondepunten/i, 'v755o totals mismatch error must remain');
assert.match(sql, /exception when others then\s*if game_id_out is not null then delete from public\.toepen_games where id=game_id_out; end if;/i, 'cleanup-on-error must remain');
assert.match(sql, /revoke all on function public\.create_toepen_game\(text,jsonb,text\) from public;/i, 'PUBLIC execute boundary must remain');
assert.match(sql, /grant execute on function public\.create_toepen_game\(text,jsonb,text\) to anon, authenticated;/i, 'custom-session RPC roles must remain');
for (const table of ['toepen_games','toepen_game_participants','toepen_rounds','toepen_round_results']) {
  assert.match(sql, new RegExp(`revoke insert, update, delete on table public\\.${table} from public, anon, authenticated;`, 'i'), `${table} direct-write boundary must remain`);
  assert.match(rollback, new RegExp(`revoke insert, update, delete on table public\\.${table} from public, anon, authenticated;`, 'i'), `${table} rollback boundary must remain`);
}
assert.match(rollback, /Do not roll back to a function that reveals foreign existing match IDs/i, 'rollback must document the proven authorization defect');
assert.doesNotMatch(rollback, /create or replace function public\.create_toepen_game/i, 'rollback must not restore vulnerable function body');
console.log('PASS Toepen v801a idempotency owner/scope guard contract');
