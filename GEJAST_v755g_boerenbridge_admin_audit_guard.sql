-- GEJAST v755g: Boerenbridge admin audit session guard.
-- The live admin_get_boerenbridge_shared_stats_audit_v643 accepted invalid
-- admin_session_token values. Keep output unchanged for valid admins, but
-- require admin_check_session(...).ok before returning protected audit data.

begin;

create or replace function public.admin_get_boerenbridge_shared_stats_audit_v643(admin_session_token text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_admin_state jsonb;
begin
  if to_regprocedure('public.admin_check_session(text)') is null then
    raise exception 'admin_session_checker_missing';
  end if;

  select to_jsonb(public.admin_check_session(admin_session_token)) into v_admin_state;
  if coalesce((v_admin_state->>'ok')::boolean, false) is not true then
    raise exception 'admin_session_invalid';
  end if;

  return jsonb_build_array(
    jsonb_build_object('check_name','cache_table','status','ok','detail',(select count(*) from public.boerenbridge_shared_stats_cache_v643)::text || ' cached players'),
    jsonb_build_object('check_name','match_facts','status','ok','detail',(select count(*) from public.boerenbridge_match_player_facts_v643)::text || ' match-player facts'),
    jsonb_build_object('check_name','source_boerenbridge_matches','status',case when to_regclass('public.boerenbridge_matches') is null then 'missing' else 'present' end,'detail',coalesce(to_regclass('public.boerenbridge_matches')::text,'not found')),
    jsonb_build_object('check_name','source_game_match_summaries','status',case when to_regclass('public.game_match_summaries') is null then 'missing' else 'present' end,'detail',coalesce(to_regclass('public.game_match_summaries')::text,'not found')),
    jsonb_build_object('check_name','rpc_version','status','ok','detail','v643')
  );
end;
$fn$;

revoke all on function public.admin_get_boerenbridge_shared_stats_audit_v643(text) from public;
grant execute on function public.admin_get_boerenbridge_shared_stats_audit_v643(text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
