import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('./GEJAST_v755o_toepen_totals_consistency_guard.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('./GEJAST_v755o_toepen_totals_consistency_guard_ROLLBACK.sql', import.meta.url), 'utf8');

assert.match(sql, /create or replace function public\.create_toepen_game\(\s*session_token text,\s*game_payload jsonb,\s*site_scope_input text default 'friends'\s*\)/i, 'must preserve create_toepen_game signature');
assert.match(sql, /viewer := public\._tier3_player_from_any_session_v740\(session_token\)/i, 'must keep session validation');
assert.match(sql, /Alleen een deelnemer mag dit Toepen-potje opslaan/i, 'must keep saver participant guard');
assert.match(sql, /select p\.seat_no,[\s\S]*coalesce\(sum\(rr\.penalty_points\),0\)::integer as calculated_points[\s\S]*from public\.toepen_game_participants p[\s\S]*left join public\.toepen_round_results rr on rr\.game_id = p\.game_id and rr\.seat_no = p\.seat_no[\s\S]*where p\.game_id = game_id_out/i, 'must calculate persisted round penalty totals per participant');
assert.match(sql, /totals_check\.end_points <> totals_check\.calculated_points/i, 'must reject forged participant end_points');
assert.match(sql, /Toepen-eindscore komt niet overeen met rondepunten/i, 'must use explicit totals mismatch error');
assert.match(sql, /exception when others then\s*if game_id_out is not null then delete from public\.toepen_games where id=game_id_out; end if;/i, 'must keep cleanup-on-error path');
assert.match(sql, /revoke all on function public\.create_toepen_game\(text,jsonb,text\) from public;/i, 'must revoke PUBLIC function execute');
assert.match(sql, /grant execute on function public\.create_toepen_game\(text,jsonb,text\) to anon, authenticated;/i, 'must preserve intended RPC execute grants');
assert.match(rollback, /Do not roll back to a function that accepts inconsistent totals/i, 'rollback must not restore known totals vulnerability');
assert.doesNotMatch(rollback, /create or replace function public\.create_toepen_game/i, 'rollback must not restore vulnerable function body');
for (const table of ['toepen_games', 'toepen_game_participants', 'toepen_rounds', 'toepen_round_results']) {
  assert.match(
    rollback,
    new RegExp(`revoke insert, update, delete on table public\\.${table} from public, anon, authenticated;`, 'i'),
    `rollback must preserve ${table} write boundary without stripping read grants`,
  );
}
assert.doesNotMatch(rollback, /revoke all on public\.toepen_/i, 'forward-fix must not unnecessarily revoke legitimate read grants');

console.log('PASS Toepen v755o totals consistency guard static contract');
