-- GEJAST v755l - Boerenbridge live-write auth guard
-- Scope: SQL-only production repair for the v764 live-write matrix.
-- Fixes two defects proven by BRIDGE-01 unauthorized probes:
--   1) save_boerenbridge_match accepted an invalid/missing player session and
--      inserted rows with created_by_player_id = null.
--   2) public REST table grants allowed direct deletion of boerenbridge_matches.
-- The frontend remains v761; no Worker/admin perimeter changes.

begin;

-- Keep public reads available through existing read paths, but block direct table
-- mutations from the anon/authenticated API roles. Writes must go through guarded RPCs.
revoke insert, update, delete on table public.boerenbridge_matches from anon, authenticated;
revoke insert, update, delete on table public.boerenbridge_match_rounds from anon, authenticated;
revoke insert, update, delete on table public.boerenbridge_player_stats from anon, authenticated;

drop function if exists public.save_boerenbridge_match(text, text, text, text, jsonb);

create or replace function public.save_boerenbridge_match(
  session_token text,
  client_match_id text,
  rules_version text default null,
  app_version text default null,
  match_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  v_client text := nullif(trim(coalesce(save_boerenbridge_match.client_match_id, '')), '');
  v_payload jsonb := coalesce(save_boerenbridge_match.match_payload, '{}'::jsonb);
  v_match_id bigint;
  v_existing public.boerenbridge_matches%rowtype;
begin
  if v_client is null then
    raise exception 'client_match_id ontbreekt';
  end if;

  p := public._tier3_player_from_any_session_v740(save_boerenbridge_match.session_token);
  if p.id is null then
    raise exception 'boerenbridge_session_invalid';
  end if;

  select *
    into v_existing
    from public.boerenbridge_matches m
   where m.client_match_id = v_client
   limit 1
   for update;

  if not found then
    insert into public.boerenbridge_matches(
      client_match_id,
      match_name,
      match_status,
      rules_version,
      app_version,
      created_by_player_id,
      started_at,
      finished_at,
      payload,
      updated_at,
      site_scope
    )
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
      now(),
      case when lower(coalesce(v_payload->>'site_scope', 'friends')) = 'family' then 'family' else 'friends' end
    )
    returning id into v_match_id;
  else
    if v_existing.created_by_player_id is distinct from p.id then
      raise exception 'boerenbridge_match_owner_mismatch';
    end if;

    update public.boerenbridge_matches m
       set payload = v_payload,
           match_status = 'finished',
           finished_at = coalesce(nullif(v_payload->>'finished_at', '')::timestamptz, m.finished_at, now()),
           updated_at = now()
     where m.id = v_existing.id
     returning m.id into v_match_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'match_id', v_match_id,
    'client_match_id', v_client,
    'stats_applied', false
  );
end;
$fn$;

grant execute on function public.save_boerenbridge_match(text, text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
