import fs from 'node:fs';

const file = 'GEJAST_v812c_game_summary_write_boundary.sql';
const sql = fs.readFileSync(file, 'utf8');
const lower = sql.toLowerCase();
const klaverjasProvenance = fs.readFileSync('GEJAST_v812d_restore_klaverjas_runtime_bundle_v687_compat.sql', 'utf8');
const klaverjasLower = klaverjasProvenance.toLowerCase();

const requireText = (needle, message) => {
  if (!lower.includes(needle.toLowerCase())) throw new Error(message);
};
const rejectText = (needle, message) => {
  if (lower.includes(needle.toLowerCase())) throw new Error(message);
};
const requireKlaverjas = (needle, message) => {
  if (!klaverjasLower.includes(needle.toLowerCase())) throw new Error(message);
};

requireText('unique (site_scope, game_type, client_match_id)', 'v812c must scope generic match identity');
requireText('save_game_match_summary_scoped', 'v812c scoped summary writer missing');
requireText("if v_player.id is null then", 'v812c must reject missing/invalid player sessions');
requireText('game_summary_scope_mismatch', 'v812c must bind requested scope to the session player');
requireText('game_summary_participant_scope_mismatch', 'v812c must validate participant scope');
requireText('game_summary_owner_not_participant', 'v812c must require the submitter to participate');
requireText('game_summary_winner_not_participant', 'v812c must validate winners against participants');
requireText('on conflict on constraint game_match_summaries_scope_game_match_key', 'v812c must use the named scope-aware conflict target');
requireText('where g.created_by_player_id = excluded.created_by_player_id', 'v812c must make replay owner-safe even under races');
requireText('game_summary_owner_mismatch', 'v812c must fail closed on cross-owner replay');
requireText('return public.save_game_match_summary_scoped(', 'unscoped summary writer must delegate to the guarded scoped writer');
requireText('v_result := public.save_game_match_summary_scoped(', 'contract_live_write_v1 must use the guarded scoped writer');
requireText('revoke all on table public.game_match_summaries from anon, authenticated', 'direct base-table access must be revoked');
requireText('revoke all on table public.live_match_summaries from anon, authenticated', 'direct live-view access must be revoked');
requireText('revoke execute on function public.save_game_match_summary(text,text,text,jsonb) from public', 'generic writer must not retain PUBLIC execute');
requireText('revoke execute on function public.save_game_match_summary_scoped(text,text,text,jsonb,text) from public', 'scoped writer must not retain PUBLIC execute');
requireText('grant execute on function public.save_game_match_summary_scoped(text,text,text,jsonb,text) to anon, authenticated, service_role', 'PostgREST roles must retain guarded RPC execution');
rejectText('insert into public.live_match_summaries', 'v812c must never write through the compatibility view');
rejectText('on conflict (game_type, client_match_id)', 'global cross-scope conflict target must not return');
rejectText('set site_scope = v_scope', 'contract wrapper must not rewrite scope after persistence');

requireKlaverjas('20260818202647 restore_klaverjas_runtime_bundle_v687_compat', 'v812d must record the exact deployed migration identity');
requireKlaverjas('create or replace function public.get_klaverjas_runtime_bundle_v687(', 'v812d compatibility wrapper missing');
requireKlaverjas('select public.get_klaverjas_runtime_bundle_v673(site_scope_input)', 'v812d wrapper must delegate exactly to v673');
requireKlaverjas("set search_path to 'public'", 'v812d wrapper must retain fixed search_path');
requireKlaverjas('revoke execute on function public.get_klaverjas_runtime_bundle_v687(text) from public', 'v812d must not leave PUBLIC execute');
requireKlaverjas('grant execute on function public.get_klaverjas_runtime_bundle_v687(text) to anon, authenticated, service_role', 'v812d must preserve expected callable roles');

console.log('PASS v812c game summary boundary + v812d Klaverjas migration provenance');
