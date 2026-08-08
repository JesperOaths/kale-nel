-- GEJAST v755r — Klaverjas current save contract + legacy write boundary hardening
--
-- Production evidence (2026-08-08):
-- - save_klaverjas_match_v687 is not deployed, so the current scorer falls back;
-- - the deployed legacy fallback accepts session_token but never validates it;
-- - the fallback uses bigint match IDs while the current scorer generates text/UUID client IDs;
-- - klaverjas_matches already has client_match_id text UNIQUE and created_by_player_id;
-- - direct web-role DML exists on legacy/classic/online Klaverjas persistence tables.
--
-- This migration:
-- 1. hardens klaverjas_upsert_match_state_scoped with real session + owner checks;
-- 2. preserves the existing legacy scoring/progress calculations;
-- 3. installs save_klaverjas_match_v687 with the exact frontend argument names;
-- 4. makes client_match_id the idempotency key for current scorer saves;
-- 5. rejects cross-player replay/overwrite;
-- 6. revokes direct web-role table writes while preserving SELECT and guarded RPC access;
-- 7. does NOT call create_jas_game, rating rebuilds, or jas_game_entries triggers.

begin;

create or replace function public.klaverjas_upsert_match_state_scoped(
  session_token text default null,
  match_id_input bigint default null,
  site_scope_input text default 'friends',
  team_w_player_ids_input jsonb default '[]'::jsonb,
  team_z_player_ids_input jsonb default '[]'::jsonb,
  team_w_player_names_input jsonb default '[]'::jsonb,
  team_z_player_names_input jsonb default '[]'::jsonb,
  rounds_input jsonb default '[]'::jsonb,
  payload_snapshot_input jsonb default '{}'::jsonb,
  status_input text default 'active',
  started_at_input timestamp with time zone default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor public.players%rowtype;
  v_match_id bigint := match_id_input;
  v_scope text := public._klaverjas_safe_scope(site_scope_input);
  v_client_match_id text := nullif(trim(coalesce(payload_snapshot_input ->> 'client_match_id','')), '');
  v_existing_owner bigint;
  v_existing_client text;
  v_round_count integer := 0;
  v_tak_count integer := 0;
  v_progress numeric(8,4) := 0;
  v_elo_scale numeric(8,4) := 0;
  v_score_w integer := 0;
  v_score_z integer := 0;
  v_raw_w integer := 0;
  v_raw_z integer := 0;
  v_roem_w integer := 0;
  v_roem_z integer := 0;
  v_winner text := null;
  v_status text := case when lower(coalesce(status_input,'')) = 'finished' then 'finished' when lower(coalesce(status_input,'')) = 'abandoned' then 'abandoned' else 'active' end;
  v_player_order jsonb := coalesce(payload_snapshot_input -> 'playerOrder', payload_snapshot_input -> 'player_order', '[]'::jsonb);
  v_snapshot_no integer := 0;
  v_round jsonb;
  v_i integer := 0;
  v_round_score_state jsonb;
begin
  -- Authorization must happen before any persistent write.
  v_actor := public._jas_session_player(session_token);

  if jsonb_typeof(coalesce(rounds_input, '[]'::jsonb)) <> 'array' then
    raise exception 'rounds_input must be a json array';
  end if;

  -- Resolve/allocate the persistent numeric row while using client_match_id as the
  -- stable idempotency key whenever it is present.
  if v_match_id is null then
    if v_client_match_id is not null then
      select id, created_by_player_id
        into v_match_id, v_existing_owner
        from public.klaverjas_matches
       where client_match_id = v_client_match_id
       for update;

      if found then
        if v_existing_owner is null then
          raise exception 'klaverjas_match_owner_unknown';
        end if;
        if v_existing_owner <> v_actor.id then
          raise exception 'klaverjas_match_owner_mismatch';
        end if;
      end if;
    end if;

    if v_match_id is null then
      v_client_match_id := coalesce(v_client_match_id, 'legacy-' || gen_random_uuid()::text);
      insert into public.klaverjas_matches(
        client_match_id,
        created_by_player_id,
        site_scope,
        started_at,
        status,
        team_w_player_ids,
        team_z_player_ids,
        team_w_player_names,
        team_z_player_names,
        payload_snapshot
      ) values (
        v_client_match_id,
        v_actor.id,
        v_scope,
        coalesce(started_at_input, now()),
        v_status,
        coalesce(team_w_player_ids_input, '[]'::jsonb),
        coalesce(team_z_player_ids_input, '[]'::jsonb),
        coalesce(team_w_player_names_input, '[]'::jsonb),
        coalesce(team_z_player_names_input, '[]'::jsonb),
        coalesce(payload_snapshot_input, '{}'::jsonb)
      )
      returning id into v_match_id;
    end if;
  else
    select created_by_player_id, client_match_id
      into v_existing_owner, v_existing_client
      from public.klaverjas_matches
     where id = v_match_id
     for update;

    if found then
      if v_existing_owner is null then
        raise exception 'klaverjas_match_owner_unknown';
      end if;
      if v_existing_owner <> v_actor.id then
        raise exception 'klaverjas_match_owner_mismatch';
      end if;
      if v_client_match_id is not null and v_existing_client <> v_client_match_id then
        raise exception 'klaverjas_match_client_id_mismatch';
      end if;
      v_client_match_id := v_existing_client;
    else
      v_client_match_id := coalesce(v_client_match_id, 'legacy-id-' || v_match_id::text);
      insert into public.klaverjas_matches(
        id,
        client_match_id,
        created_by_player_id,
        site_scope,
        started_at,
        status,
        team_w_player_ids,
        team_z_player_ids,
        team_w_player_names,
        team_z_player_names,
        payload_snapshot
      ) values (
        v_match_id,
        v_client_match_id,
        v_actor.id,
        v_scope,
        coalesce(started_at_input, now()),
        v_status,
        coalesce(team_w_player_ids_input, '[]'::jsonb),
        coalesce(team_z_player_ids_input, '[]'::jsonb),
        coalesce(team_w_player_names_input, '[]'::jsonb),
        coalesce(team_z_player_names_input, '[]'::jsonb),
        coalesce(payload_snapshot_input, '{}'::jsonb)
      );
    end if;
  end if;

  update public.klaverjas_matches
     set site_scope = v_scope,
         started_at = coalesce(started_at_input, started_at, now()),
         status = v_status,
         team_w_player_ids = coalesce(team_w_player_ids_input, '[]'::jsonb),
         team_z_player_ids = coalesce(team_z_player_ids_input, '[]'::jsonb),
         team_w_player_names = coalesce(team_w_player_names_input, '[]'::jsonb),
         team_z_player_names = coalesce(team_z_player_names_input, '[]'::jsonb),
         payload_snapshot = coalesce(payload_snapshot_input, '{}'::jsonb),
         updated_at = now()
   where id = v_match_id
     and created_by_player_id = v_actor.id;

  if not found then
    raise exception 'klaverjas_match_owner_mismatch';
  end if;

  delete from public.klaverjas_rounds where match_id = v_match_id;
  delete from public.klaverjas_match_snapshots where match_id = v_match_id;

  for v_round in
    select value from jsonb_array_elements(coalesce(rounds_input, '[]'::jsonb))
  loop
    v_i := v_i + 1;
    insert into public.klaverjas_rounds(
      match_id, round_no, tak_no, round_in_tak,
      bid_team, bid_value, suit,
      base_points_w, base_points_z,
      roem_w, roem_z,
      nat_by, pit_by, verzaakt_by,
      awarded_raw_w, awarded_raw_z,
      awarded_ladder_w, awarded_ladder_z,
      dealer_player, forehand_player, payload
    ) values (
      v_match_id,
      coalesce(nullif((v_round ->> 'round')::int, null), nullif((v_round ->> 'roundNo')::int, null), v_i),
      coalesce(nullif((v_round ->> 'tak')::int, null), public._klaverjas_tak_count(v_i)),
      coalesce(nullif((v_round ->> 'roundInTak')::int, null), ((v_i - 1) % 4) + 1),
      coalesce(v_round ->> 'team', 'W'),
      coalesce((v_round ->> 'bid')::int, 80),
      coalesce(v_round ->> 'suit', 'S'),
      coalesce((v_round ->> 'baseW')::int, 0),
      coalesce((v_round ->> 'baseZ')::int, 0),
      coalesce((v_round ->> 'roemW')::int, 0),
      coalesce((v_round ->> 'roemZ')::int, 0),
      nullif(v_round ->> 'natBy', ''),
      nullif(v_round ->> 'pitBy', ''),
      nullif(v_round ->> 'verzaaktBy', ''),
      coalesce((v_round ->> 'fw')::int, 0),
      coalesce((v_round ->> 'fz')::int, 0),
      coalesce((v_round ->> 'fw')::int, 0),
      coalesce((v_round ->> 'fz')::int, 0),
      coalesce(v_round ->> 'dealer', public._klaverjas_dealer_name(v_player_order, v_i)),
      coalesce(v_round ->> 'forehand', public._klaverjas_forehand_name(v_player_order, v_i)),
      coalesce(v_round, '{}'::jsonb)
    );
  end loop;

  select count(*)::int,
         public._klaverjas_tak_count(count(*)::int),
         least(1::numeric, count(*)::numeric / 16::numeric),
         public._klaverjas_progress_scale(count(*)::int),
         coalesce(sum(awarded_ladder_w),0),
         coalesce(sum(awarded_ladder_z),0),
         coalesce(sum(awarded_raw_w),0),
         coalesce(sum(awarded_raw_z),0),
         coalesce(sum(roem_w),0),
         coalesce(sum(roem_z),0)
    into v_round_count, v_tak_count, v_progress, v_elo_scale, v_score_w, v_score_z, v_raw_w, v_raw_z, v_roem_w, v_roem_z
    from public.klaverjas_rounds
   where match_id = v_match_id;

  if v_score_w > v_score_z then v_winner := 'wij';
  elsif v_score_z > v_score_w then v_winner := 'zij';
  else v_winner := 'draw';
  end if;

  update public.klaverjas_matches
     set status = v_status,
         finished_at = case when v_status in ('finished','abandoned') then now() else null end,
         total_rounds_played = v_round_count,
         total_takken_played = v_tak_count,
         progress_ratio = v_progress,
         elo_scale_applied = v_elo_scale,
         final_score_w = v_score_w,
         final_score_z = v_score_z,
         final_raw_w = v_raw_w,
         final_raw_z = v_raw_z,
         total_roem_w = v_roem_w,
         total_roem_z = v_roem_z,
         kruipen_side = public._klaverjas_kruip_side(v_score_w, v_score_z),
         naakt_kruipen_side = public._klaverjas_naakt_kruip_side(v_score_w, v_score_z),
         winner_side = v_winner,
         theoretical_full_delta = case when v_winner = 'wij' then greatest(1, v_score_w - v_score_z) when v_winner = 'zij' then greatest(1, v_score_z - v_score_w) else 0 end,
         actual_delta = case when v_winner = 'draw' then 0 else round((case when v_winner = 'wij' then greatest(1, v_score_w - v_score_z) else greatest(1, v_score_z - v_score_w) end) * v_elo_scale)::int end,
         payload_snapshot = coalesce(payload_snapshot_input, '{}'::jsonb),
         updated_at = now()
   where id = v_match_id
     and created_by_player_id = v_actor.id;

  if v_round_count >= 8 then
    for v_i in 8..v_round_count loop
      v_snapshot_no := v_snapshot_no + 1;
      select jsonb_build_object(
        'match_id', v_match_id,
        'round_count', v_i,
        'tak_count', public._klaverjas_tak_count(v_i),
        'progress_ratio', least(1::numeric, v_i::numeric / 16::numeric),
        'elo_scale', public._klaverjas_progress_scale(v_i),
        'players', jsonb_build_object('W', team_w_player_names_input, 'Z', team_z_player_names_input),
        'totals', jsonb_build_object(
          'W', coalesce((select sum(awarded_ladder_w) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i),0),
          'Z', coalesce((select sum(awarded_ladder_z) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i),0)
        ),
        'rawTotals', jsonb_build_object(
          'W', coalesce((select sum(awarded_raw_w) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i),0),
          'Z', coalesce((select sum(awarded_raw_z) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i),0)
        ),
        'rounds', coalesce((select jsonb_agg(payload order by round_no) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i), '[]'::jsonb)
      ) into v_round_score_state;

      insert into public.klaverjas_match_snapshots(match_id, snapshot_no, round_count, tak_count, progress_ratio, elo_scale, serialized_score_state)
      values (
        v_match_id,
        v_snapshot_no,
        v_i,
        public._klaverjas_tak_count(v_i),
        least(1::numeric, v_i::numeric / 16::numeric),
        public._klaverjas_progress_scale(v_i),
        v_round_score_state
      );
    end loop;
  end if;

  return public._klaverjas_build_match_json(v_match_id);
end;
$function$;

create or replace function public.save_klaverjas_match_v687(
  session_token text default null,
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
  v_token text := coalesce(nullif(trim(coalesce(session_token_input,'')),''), nullif(trim(coalesce(session_token,'')),''));
  v_actor public.players%rowtype;
  v_client_match_id text := nullif(trim(coalesce(client_match_id_input,'')), '');
  v_existing_id bigint;
  v_existing_owner bigint;
  v_team_w_names jsonb := coalesce(match_payload -> 'team_a_names', match_payload -> 'team_w_names', '[]'::jsonb);
  v_team_z_names jsonb := coalesce(match_payload -> 'team_b_names', match_payload -> 'team_z_names', '[]'::jsonb);
  v_score_w integer := coalesce((match_payload ->> 'team_a_score')::integer, (match_payload ->> 'score_a')::integer, 0);
  v_score_z integer := coalesce((match_payload ->> 'team_b_score')::integer, (match_payload ->> 'score_b')::integer, 0);
  v_roem_w integer := coalesce((match_payload ->> 'roem_a')::integer, 0);
  v_roem_z integer := coalesce((match_payload ->> 'roem_b')::integer, 0);
  v_notes text := coalesce(match_payload ->> 'notes', match_payload ->> 'note', '');
  v_rounds jsonb;
  v_snapshot jsonb;
  v_result jsonb;
  v_distinct_names integer;
  v_already_saved boolean := false;
begin
  v_actor := public._jas_session_player(v_token);

  if v_client_match_id is null then
    raise exception 'klaverjas_client_match_id_required';
  end if;
  if jsonb_typeof(v_team_w_names) <> 'array' or jsonb_array_length(v_team_w_names) <> 2 then
    raise exception 'Klaverjassen verwacht precies twee spelers per team.';
  end if;
  if jsonb_typeof(v_team_z_names) <> 'array' or jsonb_array_length(v_team_z_names) <> 2 then
    raise exception 'Klaverjassen verwacht precies twee spelers per team.';
  end if;

  select count(distinct lower(trim(value)))::integer
    into v_distinct_names
    from jsonb_array_elements_text(v_team_w_names || v_team_z_names) x(value);
  if v_distinct_names <> 4 then
    raise exception 'Elke speler mag maar één keer meedoen.';
  end if;
  if v_score_w = v_score_z then
    raise exception 'Een Klaverjas-pot kan niet gelijk eindigen.';
  end if;

  select id, created_by_player_id
    into v_existing_id, v_existing_owner
    from public.klaverjas_matches
   where client_match_id = v_client_match_id
   for update;

  if found then
    if v_existing_owner is null then
      raise exception 'klaverjas_match_owner_unknown';
    end if;
    if v_existing_owner <> v_actor.id then
      raise exception 'klaverjas_match_owner_mismatch';
    end if;
    v_already_saved := true;
  end if;

  v_rounds := jsonb_build_array(jsonb_build_object(
    'round', 1,
    'roundNo', 1,
    'team', 'W',
    'bid', 80,
    'suit', 'S',
    'baseW', v_score_w,
    'baseZ', v_score_z,
    'roemW', v_roem_w,
    'roemZ', v_roem_z,
    'fw', v_score_w,
    'fz', v_score_z,
    'note', v_notes
  ));

  v_snapshot := coalesce(match_payload, '{}'::jsonb) || jsonb_build_object(
    'client_match_id', v_client_match_id,
    'team_a_names', v_team_w_names,
    'team_b_names', v_team_z_names,
    'team_a_score', v_score_w,
    'team_b_score', v_score_z,
    'roem_a', v_roem_w,
    'roem_b', v_roem_z,
    'notes', v_notes,
    'source', coalesce(nullif(trim(match_payload ->> 'source'),''), 'klaverjas_scorer_v687')
  );

  v_result := public.klaverjas_upsert_match_state_scoped(
    v_token,
    v_existing_id,
    site_scope_input,
    '[]'::jsonb,
    '[]'::jsonb,
    v_team_w_names,
    v_team_z_names,
    v_rounds,
    v_snapshot,
    'finished',
    now()
  );

  select id into v_existing_id
    from public.klaverjas_matches
   where client_match_id = v_client_match_id;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'ok', true,
    'match_id', v_existing_id,
    'client_match_id', v_client_match_id,
    'already_saved', v_already_saved
  );
end;
$function$;

-- Close direct-write paths. Reads are deliberately untouched.
revoke insert, update, delete on table public.klaverjas_matches from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_rounds from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_match_snapshots from public, anon, authenticated;
revoke insert, update, delete on table public.jas_games from public, anon, authenticated;
revoke insert, update, delete on table public.jas_game_entries from public, anon, authenticated;
revoke insert, update, delete on table public.game_rating_rebuild_queue from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_online_games from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_online_player_stats from public, anon, authenticated;

-- Guarded RPCs remain callable by the normal PostgREST web roles; PUBLIC is removed.
revoke execute on function public.save_klaverjas_match_v687(text,text,text,jsonb,text) from public;
grant execute on function public.save_klaverjas_match_v687(text,text,text,jsonb,text) to anon, authenticated;

revoke execute on function public.klaverjas_upsert_match_state_scoped(text,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamp with time zone) from public;
grant execute on function public.klaverjas_upsert_match_state_scoped(text,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamp with time zone) to anon, authenticated;

revoke execute on function public.create_jas_game(text,jsonb) from public;
grant execute on function public.create_jas_game(text,jsonb) to anon, authenticated;

commit;
