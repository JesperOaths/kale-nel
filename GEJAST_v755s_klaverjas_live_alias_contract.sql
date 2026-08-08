-- GEJAST v755s — Klaverjas v687 live alias contract
--
-- Production preflight 2026-08-08 proved:
-- - start/update/finish/get v687 live RPCs are absent;
-- - v755r save/upsert session/owner/client-id guards are deployed;
-- - direct web-role DML on Klaverjas persistence tables is already closed;
-- - legacy public getter is bigint-only and cannot serve UUID client IDs.
--
-- This migration adds the missing text/UUID live contract without touching classic
-- jas_games / jas_game_entries / rating rebuild behavior.

begin;

create or replace function public.get_klaverjas_live_state_public_v687(
  client_match_id_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_scope text := public._klaverjas_safe_scope(site_scope_input);
  v_client text := nullif(trim(coalesce(client_match_id_input,'')), '');
  v_row jsonb;
begin
  select jsonb_build_object(
    'client_match_id', m.client_match_id,
    'status', m.status,
    'updated_at', coalesce(m.updated_at, m.finished_at, m.started_at),
    'team_a_names', coalesce(m.team_w_player_names, '[]'::jsonb),
    'team_b_names', coalesce(m.team_z_player_names, '[]'::jsonb),
    'team_a_score', coalesce(m.final_score_w, 0),
    'team_b_score', coalesce(m.final_score_z, 0),
    'round_no', case
      when coalesce(m.payload_snapshot ->> 'round_no','') ~ '^\d+$'
        then (m.payload_snapshot ->> 'round_no')::integer
      else coalesce(m.total_rounds_played, 0)
    end,
    'payload', coalesce(m.payload_snapshot, '{}'::jsonb)
  )
  into v_row
  from public.klaverjas_matches m
  where m.site_scope = v_scope
    and (
      (v_client is not null and m.client_match_id = v_client)
      or
      (v_client is null and m.status = 'active')
    )
  order by
    case when v_client is not null and m.client_match_id = v_client then 0 else 1 end,
    coalesce(m.updated_at, m.started_at) desc,
    m.id desc
  limit 1;

  if v_row is null then
    return jsonb_build_object('live_match', null, 'live_matches', '[]'::jsonb);
  end if;

  return jsonb_build_object('live_match', v_row, 'live_matches', jsonb_build_array(v_row));
end;
$function$;

create or replace function public.start_klaverjas_live_match_v687(
  session_token_input text default null,
  client_match_id_input text default null,
  match_payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor public.players%rowtype;
  v_scope text := public._klaverjas_safe_scope(site_scope_input);
  v_client text := nullif(trim(coalesce(client_match_id_input,'')), '');
  v_existing_id bigint;
  v_existing_owner bigint;
  v_existing_status text;
  v_existing_scope text;
  v_team_w jsonb := coalesce(match_payload -> 'team_a_names', match_payload -> 'team_w_names', '[]'::jsonb);
  v_team_z jsonb := coalesce(match_payload -> 'team_b_names', match_payload -> 'team_z_names', '[]'::jsonb);
  v_distinct_names integer;
  v_snapshot jsonb;
begin
  v_actor := public._jas_session_player(session_token_input);

  if v_client is null then
    raise exception 'klaverjas_client_match_id_required';
  end if;
  if jsonb_typeof(v_team_w) <> 'array' or jsonb_array_length(v_team_w) <> 2
     or jsonb_typeof(v_team_z) <> 'array' or jsonb_array_length(v_team_z) <> 2 then
    raise exception 'Klaverjassen verwacht precies twee spelers per team.';
  end if;

  select count(distinct lower(trim(value)))::integer
    into v_distinct_names
    from jsonb_array_elements_text(v_team_w || v_team_z) x(value);
  if v_distinct_names <> 4 then
    raise exception 'Elke speler mag maar één keer meedoen.';
  end if;

  select id, created_by_player_id, status, site_scope
    into v_existing_id, v_existing_owner, v_existing_status, v_existing_scope
    from public.klaverjas_matches
   where client_match_id = v_client
   for update;

  if found then
    if v_existing_owner is null then raise exception 'klaverjas_match_owner_unknown'; end if;
    if v_existing_owner <> v_actor.id then raise exception 'klaverjas_match_owner_mismatch'; end if;
    if v_existing_scope is distinct from v_scope then raise exception 'klaverjas_match_scope_mismatch'; end if;
    if v_existing_status <> 'active' then raise exception 'klaverjas_live_match_not_active'; end if;
    return public.get_klaverjas_live_state_public_v687(v_client, v_scope)
      || jsonb_build_object('ok', true, 'already_started', true);
  end if;

  v_snapshot := coalesce(match_payload, '{}'::jsonb) || jsonb_build_object(
    'client_match_id', v_client,
    'team_a_names', v_team_w,
    'team_b_names', v_team_z,
    'team_a_score', 0,
    'team_b_score', 0,
    'round_no', 0,
    'source', coalesce(nullif(trim(match_payload ->> 'source'),''), 'klaverjas_live_v687')
  );

  perform public.klaverjas_upsert_match_state_scoped(
    session_token_input,
    null,
    v_scope,
    '[]'::jsonb,
    '[]'::jsonb,
    v_team_w,
    v_team_z,
    '[]'::jsonb,
    v_snapshot,
    'active',
    now()
  );

  return public.get_klaverjas_live_state_public_v687(v_client, v_scope)
    || jsonb_build_object('ok', true, 'already_started', false);
end;
$function$;

create or replace function public.update_klaverjas_live_match_v687(
  session_token_input text default null,
  client_match_id_input text default null,
  patch_payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor public.players%rowtype;
  v_scope text := public._klaverjas_safe_scope(site_scope_input);
  v_client text := nullif(trim(coalesce(client_match_id_input,'')), '');
  v_id bigint;
  v_owner bigint;
  v_status text;
  v_existing_scope text;
  v_team_w jsonb;
  v_team_z jsonb;
  v_snapshot jsonb;
  v_rounds jsonb := '[]'::jsonb;
  v_score_w integer;
  v_score_z integer;
  v_roem_w integer;
  v_roem_z integer;
  v_round_no integer;
  v_note text;
begin
  v_actor := public._jas_session_player(session_token_input);
  if v_client is null then raise exception 'klaverjas_client_match_id_required'; end if;

  select m.id, m.created_by_player_id, m.status, m.site_scope,
         coalesce(m.team_w_player_names,'[]'::jsonb),
         coalesce(m.team_z_player_names,'[]'::jsonb),
         coalesce(m.payload_snapshot,'{}'::jsonb),
         coalesce(m.final_score_w,0), coalesce(m.final_score_z,0),
         coalesce(m.total_roem_w,0), coalesce(m.total_roem_z,0)
    into v_id, v_owner, v_status, v_existing_scope,
         v_team_w, v_team_z, v_snapshot,
         v_score_w, v_score_z, v_roem_w, v_roem_z
    from public.klaverjas_matches m
   where m.client_match_id = v_client
   for update;

  if not found then raise exception 'klaverjas_live_match_not_found'; end if;
  if v_owner is null then raise exception 'klaverjas_match_owner_unknown'; end if;
  if v_owner <> v_actor.id then raise exception 'klaverjas_match_owner_mismatch'; end if;
  if v_existing_scope is distinct from v_scope then raise exception 'klaverjas_match_scope_mismatch'; end if;
  if v_status <> 'active' then raise exception 'klaverjas_live_match_not_active'; end if;

  if patch_payload ? 'team_a_score' then v_score_w := (patch_payload ->> 'team_a_score')::integer; end if;
  if patch_payload ? 'team_b_score' then v_score_z := (patch_payload ->> 'team_b_score')::integer; end if;
  if patch_payload ? 'roem_a' then v_roem_w := (patch_payload ->> 'roem_a')::integer; end if;
  if patch_payload ? 'roem_b' then v_roem_z := (patch_payload ->> 'roem_b')::integer; end if;

  v_round_no := case
    when coalesce(patch_payload ->> 'round_no','') ~ '^\d+$' then (patch_payload ->> 'round_no')::integer
    when coalesce(v_snapshot ->> 'round_no','') ~ '^\d+$' then (v_snapshot ->> 'round_no')::integer
    else 0
  end;
  v_note := coalesce(patch_payload ->> 'note', patch_payload ->> 'notes', v_snapshot ->> 'note', v_snapshot ->> 'notes', '');

  v_snapshot := v_snapshot || coalesce(patch_payload,'{}'::jsonb) || jsonb_build_object(
    'client_match_id', v_client,
    'team_a_names', v_team_w,
    'team_b_names', v_team_z,
    'team_a_score', v_score_w,
    'team_b_score', v_score_z,
    'roem_a', v_roem_w,
    'roem_b', v_roem_z,
    'round_no', greatest(v_round_no,0),
    'note', v_note,
    'source', coalesce(nullif(trim(v_snapshot ->> 'source'),''), 'klaverjas_live_v687')
  );

  if v_round_no > 0 or v_score_w <> 0 or v_score_z <> 0 or v_roem_w <> 0 or v_roem_z <> 0 then
    v_rounds := jsonb_build_array(jsonb_build_object(
      'round', greatest(v_round_no,1),
      'roundNo', greatest(v_round_no,1),
      'team', 'W', 'bid', 80, 'suit', 'S',
      'baseW', v_score_w, 'baseZ', v_score_z,
      'roemW', v_roem_w, 'roemZ', v_roem_z,
      'fw', v_score_w, 'fz', v_score_z,
      'note', v_note
    ));
  end if;

  perform public.klaverjas_upsert_match_state_scoped(
    session_token_input, v_id, v_scope,
    '[]'::jsonb, '[]'::jsonb,
    v_team_w, v_team_z,
    v_rounds, v_snapshot, 'active', null
  );

  return public.get_klaverjas_live_state_public_v687(v_client, v_scope)
    || jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.finish_klaverjas_live_match_v687(
  session_token_input text default null,
  client_match_id_input text default null,
  patch_payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor public.players%rowtype;
  v_scope text := public._klaverjas_safe_scope(site_scope_input);
  v_client text := nullif(trim(coalesce(client_match_id_input,'')), '');
  v_id bigint;
  v_owner bigint;
  v_status text;
  v_existing_scope text;
  v_team_w jsonb;
  v_team_z jsonb;
  v_snapshot jsonb;
  v_rounds jsonb;
  v_score_w integer;
  v_score_z integer;
  v_roem_w integer;
  v_roem_z integer;
  v_round_no integer;
  v_note text;
begin
  v_actor := public._jas_session_player(session_token_input);
  if v_client is null then raise exception 'klaverjas_client_match_id_required'; end if;

  select m.id, m.created_by_player_id, m.status, m.site_scope,
         coalesce(m.team_w_player_names,'[]'::jsonb),
         coalesce(m.team_z_player_names,'[]'::jsonb),
         coalesce(m.payload_snapshot,'{}'::jsonb),
         coalesce(m.final_score_w,0), coalesce(m.final_score_z,0),
         coalesce(m.total_roem_w,0), coalesce(m.total_roem_z,0)
    into v_id, v_owner, v_status, v_existing_scope,
         v_team_w, v_team_z, v_snapshot,
         v_score_w, v_score_z, v_roem_w, v_roem_z
    from public.klaverjas_matches m
   where m.client_match_id = v_client
   for update;

  if not found then raise exception 'klaverjas_live_match_not_found'; end if;
  if v_owner is null then raise exception 'klaverjas_match_owner_unknown'; end if;
  if v_owner <> v_actor.id then raise exception 'klaverjas_match_owner_mismatch'; end if;
  if v_existing_scope is distinct from v_scope then raise exception 'klaverjas_match_scope_mismatch'; end if;
  if v_status = 'finished' then
    return public.get_klaverjas_live_state_public_v687(v_client, v_scope)
      || jsonb_build_object('ok', true, 'already_finished', true);
  end if;
  if v_status <> 'active' then raise exception 'klaverjas_live_match_not_active'; end if;

  if patch_payload ? 'team_a_score' then v_score_w := (patch_payload ->> 'team_a_score')::integer; end if;
  if patch_payload ? 'team_b_score' then v_score_z := (patch_payload ->> 'team_b_score')::integer; end if;
  if patch_payload ? 'roem_a' then v_roem_w := (patch_payload ->> 'roem_a')::integer; end if;
  if patch_payload ? 'roem_b' then v_roem_z := (patch_payload ->> 'roem_b')::integer; end if;
  if v_score_w = v_score_z then raise exception 'Een Klaverjas-pot kan niet gelijk eindigen.'; end if;

  v_round_no := case
    when coalesce(patch_payload ->> 'round_no','') ~ '^\d+$' then (patch_payload ->> 'round_no')::integer
    when coalesce(v_snapshot ->> 'round_no','') ~ '^\d+$' then (v_snapshot ->> 'round_no')::integer
    else 1
  end;
  v_note := coalesce(patch_payload ->> 'note', patch_payload ->> 'notes', v_snapshot ->> 'note', v_snapshot ->> 'notes', '');

  v_snapshot := v_snapshot || coalesce(patch_payload,'{}'::jsonb) || jsonb_build_object(
    'client_match_id', v_client,
    'team_a_names', v_team_w,
    'team_b_names', v_team_z,
    'team_a_score', v_score_w,
    'team_b_score', v_score_z,
    'roem_a', v_roem_w,
    'roem_b', v_roem_z,
    'round_no', greatest(v_round_no,1),
    'note', v_note,
    'source', coalesce(nullif(trim(v_snapshot ->> 'source'),''), 'klaverjas_live_v687')
  );

  v_rounds := jsonb_build_array(jsonb_build_object(
    'round', greatest(v_round_no,1),
    'roundNo', greatest(v_round_no,1),
    'team', 'W', 'bid', 80, 'suit', 'S',
    'baseW', v_score_w, 'baseZ', v_score_z,
    'roemW', v_roem_w, 'roemZ', v_roem_z,
    'fw', v_score_w, 'fz', v_score_z,
    'note', v_note
  ));

  perform public.klaverjas_upsert_match_state_scoped(
    session_token_input, v_id, v_scope,
    '[]'::jsonb, '[]'::jsonb,
    v_team_w, v_team_z,
    v_rounds, v_snapshot, 'finished', null
  );

  return public.get_klaverjas_live_state_public_v687(v_client, v_scope)
    || jsonb_build_object('ok', true, 'already_finished', false);
end;
$function$;

-- v755r direct-write boundary remains mandatory.
revoke insert, update, delete on table public.klaverjas_matches from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_rounds from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_match_snapshots from public, anon, authenticated;
revoke insert, update, delete on table public.jas_games from public, anon, authenticated;
revoke insert, update, delete on table public.jas_game_entries from public, anon, authenticated;
revoke insert, update, delete on table public.game_rating_rebuild_queue from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_online_games from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_online_player_stats from public, anon, authenticated;

-- Write aliases are guarded and never PUBLIC executable.
revoke execute on function public.start_klaverjas_live_match_v687(text,text,jsonb,text) from public;
grant execute on function public.start_klaverjas_live_match_v687(text,text,jsonb,text) to anon, authenticated;
revoke execute on function public.update_klaverjas_live_match_v687(text,text,jsonb,text) from public;
grant execute on function public.update_klaverjas_live_match_v687(text,text,jsonb,text) to anon, authenticated;
revoke execute on function public.finish_klaverjas_live_match_v687(text,text,jsonb,text) from public;
grant execute on function public.finish_klaverjas_live_match_v687(text,text,jsonb,text) to anon, authenticated;

-- Public live state is intentionally read-only and scope filtered.
grant execute on function public.get_klaverjas_live_state_public_v687(text,text) to public, anon, authenticated;

commit;
