-- Rollback for GEJAST_v755l_boerenbridge_write_auth_guard.sql
-- Captured from live pg_get_functiondef on 2026-08-03 before v755l apply.
-- SAFETY RULE: this rollback intentionally does NOT restore insecure direct
-- INSERT/UPDATE/DELETE grants to anon/authenticated/PUBLIC on Boerenbridge
-- tables. Restoring those grants would recreate the confirmed vulnerability.
-- Use only if the guarded RPC itself must be reverted while table-write grants
-- remain locked down.

begin;

drop function if exists public.save_boerenbridge_match(text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.save_boerenbridge_match(session_token text, client_match_id text, rules_version text DEFAULT NULL::text, app_version text DEFAULT NULL::text, match_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.players%rowtype;
  v_client text := nullif(trim(coalesce(save_boerenbridge_match.client_match_id, '')), '');
  v_payload jsonb := coalesce(save_boerenbridge_match.match_payload, '{}'::jsonb);
  v_match_id bigint;
  v_existing bigint;
begin
  if v_client is null then raise exception 'client_match_id ontbreekt'; end if;
  p := public._tier3_player_from_any_session_v740(save_boerenbridge_match.session_token);

  select m.id into v_existing from public.boerenbridge_matches m where m.client_match_id = v_client limit 1;
  if v_existing is null then
    insert into public.boerenbridge_matches(client_match_id, match_name, match_status, rules_version, app_version, created_by_player_id, started_at, finished_at, payload, updated_at)
    values (
      v_client,
      nullif(trim(coalesce(v_payload->>'match_name', '')), ''),
      'finished',
      save_boerenbridge_match.rules_version,
      save_boerenbridge_match.app_version,
      p.id,
      coalesce(nullif(v_payload->>'started_at', '')::timestamptz, now()),
      coalesce(nullif(v_payload->>'finished_at', '')::timestamptz, now()),
      v_payload,
      now()
    )
    returning id into v_match_id;
  else
    update public.boerenbridge_matches m
       set payload = v_payload,
           match_status = 'finished',
           finished_at = coalesce(nullif(v_payload->>'finished_at', '')::timestamptz, m.finished_at, now()),
           updated_at = now()
     where m.id = v_existing
     returning m.id into v_match_id;
  end if;

  return jsonb_build_object('ok', true, 'match_id', v_match_id, 'client_match_id', v_client, 'stats_applied', false);
end;
$function$;

revoke all on function public.save_boerenbridge_match(text, text, text, text, jsonb) from public;
grant execute on function public.save_boerenbridge_match(text, text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
