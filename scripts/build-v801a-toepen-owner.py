from pathlib import Path

src = Path('GEJAST_v755o_toepen_totals_consistency_guard.sql').read_text()
src = src.replace(
    '-- GEJAST v755o: Toepen totals consistency guard.\n-- SQL-only forward fix after controlled v764 matrix proof.\n-- Requires the saving player to match the requested scope and participant end_points to match round penalties.\n',
    "-- GEJAST v801a: Toepen idempotency owner/scope guard.\n-- SQL-only forward fix after exact-v801 live proof showed an unrelated valid player could replay another player's client_match_id.\n-- Preserves the complete v755o totals/payload/write-boundary contract and fails closed for foreign or ownerless existing rows.\n"
)
src = src.replace(
    '  existing_id bigint;\n  participant jsonb;',
    '  existing_id bigint;\n  existing_owner_id bigint;\n  existing_scope text;\n  participant jsonb;'
)
old = """  select id into existing_id from public.toepen_games where client_match_id=client_id limit 1;
  if existing_id is not null then
    return jsonb_build_object('ok',true,'game_id',existing_id,'already_saved',true);
  end if;"""
new = """  select id, created_by_player_id, lower(coalesce(site_scope,'friends'))
    into existing_id, existing_owner_id, existing_scope
    from public.toepen_games
   where client_match_id=client_id
   limit 1;
  if existing_id is not null then
    if existing_owner_id is distinct from viewer.id
       or coalesce(existing_scope,'') <> use_scope then
      raise exception 'toepen_game_owner_mismatch';
    end if;
    return jsonb_build_object('ok',true,'game_id',existing_id,'already_saved',true);
  end if;"""
if old not in src:
    raise SystemExit('Expected v755o idempotency block not found')
src = src.replace(old, new, 1)
Path('GEJAST_v801a_toepen_idempotency_owner_guard.sql').write_text(src)

rollback = """-- GEJAST v801a safe rollback / forward-fix note for Toepen idempotency ownership.
--
-- Exact-v801 live proof demonstrated that the pre-v801a idempotency branch returned
-- an existing Toepen game_id to an unrelated valid same-scope player who supplied
-- the creator's client_match_id and a structurally valid payload.
-- Do not roll back to a function that reveals foreign existing match IDs.
--
-- Any forward repair must preserve:
--   * valid player session + site-scope validation before save/replay handling
--   * existing client_match_id rows are idempotent only for their owning player and scope
--   * ownerless historical rows fail closed rather than becoming replayable
--   * saver-participant validation and all v755o payload/totals consistency checks
--   * direct Toepen table writes remain closed to PUBLIC/anon/authenticated

begin;

revoke all on function public.create_toepen_game(text,jsonb,text) from public;
grant execute on function public.create_toepen_game(text,jsonb,text) to anon, authenticated;

revoke insert, update, delete on table public.toepen_games from public, anon, authenticated;
revoke insert, update, delete on table public.toepen_game_participants from public, anon, authenticated;
revoke insert, update, delete on table public.toepen_rounds from public, anon, authenticated;
revoke insert, update, delete on table public.toepen_round_results from public, anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
"""
Path('GEJAST_v801a_toepen_idempotency_owner_guard_ROLLBACK.sql').write_text(rollback)

checker = r"""import fs from 'node:fs';
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
"""
Path('check-toepen-idempotency-owner-guard-v801a.mjs').write_text(checker)

p = Path('package.json')
text = p.read_text()
needle = 'node check-toepen-totals-guard-v755o.mjs && node check-beerpong-save-auth-guard-v755p.mjs'
replacement = 'node check-toepen-totals-guard-v755o.mjs && node check-toepen-idempotency-owner-guard-v801a.mjs && node check-beerpong-save-auth-guard-v755p.mjs'
if needle not in text:
    raise SystemExit('Canonical static verify insertion point missing')
p.write_text(text.replace(needle, replacement, 1))
