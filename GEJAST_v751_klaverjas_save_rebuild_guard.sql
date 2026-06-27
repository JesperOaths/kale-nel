-- GEJAST v751: keep Klaverjas result saving live when rating rebuilds fail.
-- The live beta write harness found that create_jas_game can roll back the
-- saved jas_games/jas_game_entries rows when the queued rating rebuild hits a
-- database safe-update guard. Saving the match is the primary user action, so
-- keep that atomic save successful and mark the rebuild queue error separately.

begin;

create or replace function public.verify_drink_event_public(
  session_token text default null,
  drink_event_id bigint default null,
  approved boolean default null,
  approve boolean default null,
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  verifier public.players%rowtype;
  event_row jsonb;
  next_status text := case when coalesce(approved, approve, true) then 'verified' else 'rejected' end;
  update_sets text[] := array[]::text[];
  insert_cols text[] := array[]::text[];
  insert_vals text[] := array[]::text[];
begin
  if drink_event_id is null then
    raise exception 'drink_event_id_required';
  end if;

  verifier := public._tier3_player_from_any_session_v740(session_token);
  if verifier.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select to_jsonb(de)
    into event_row
    from public.drink_events de
   where de.id = drink_event_id
   limit 1;
  if event_row is null then
    raise exception 'Drankverzoek niet gevonden.';
  end if;
  if nullif(event_row->>'player_id', '')::bigint = verifier.id then
    raise exception 'Je kunt je eigen drankje niet bevestigen.';
  end if;

  if coalesce(event_row->>'status', 'pending') <> 'pending' then
    return jsonb_build_object('ok', true, 'id', drink_event_id, 'drink_event_id', drink_event_id, 'status', event_row->>'status', 'already', true);
  end if;

  if to_regclass('public.drink_event_verifications') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='drink_event_id') then
      insert_cols := array_append(insert_cols, 'drink_event_id');
      insert_vals := array_append(insert_vals, drink_event_id::text);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='verifier_player_id') then
      insert_cols := array_append(insert_cols, 'verifier_player_id');
      insert_vals := array_append(insert_vals, verifier.id::text);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='verifier_player_name') then
      insert_cols := array_append(insert_cols, 'verifier_player_name');
      insert_vals := array_append(insert_vals, quote_literal(coalesce(nullif(trim(verifier.display_name), ''), nullif(trim(verifier.slug), ''), 'Beta verifier')));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='player_name') then
      insert_cols := array_append(insert_cols, 'player_name');
      insert_vals := array_append(insert_vals, quote_literal(coalesce(nullif(trim(verifier.display_name), ''), nullif(trim(verifier.slug), ''), 'Beta verifier')));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='approved') then
      insert_cols := array_append(insert_cols, 'approved');
      insert_vals := array_append(insert_vals, case when next_status = 'verified' then 'true' else 'false' end);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='reason') then
      insert_cols := array_append(insert_cols, 'reason');
      insert_vals := array_append(insert_vals, quote_literal('public'));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='lat') and lat is not null then
      insert_cols := array_append(insert_cols, 'lat');
      insert_vals := array_append(insert_vals, lat::text);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='lng') and lng is not null then
      insert_cols := array_append(insert_cols, 'lng');
      insert_vals := array_append(insert_vals, lng::text);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='accuracy') and accuracy is not null then
      insert_cols := array_append(insert_cols, 'accuracy');
      insert_vals := array_append(insert_vals, accuracy::text);
    end if;
    if coalesce(array_length(insert_cols, 1), 0) > 0 then
      execute format(
        'insert into public.drink_event_verifications (%s) values (%s)',
        array_to_string(insert_cols, ', '),
        array_to_string(insert_vals, ', ')
      );
    end if;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='status') then
    update_sets := array_append(update_sets, format('%I = %L', 'status', next_status));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_at') and next_status = 'verified' then
    update_sets := array_append(update_sets, 'verified_at = now()');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='resolved_at') then
    update_sets := array_append(update_sets, 'resolved_at = now()');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='rejection_reason') and next_status = 'rejected' then
    update_sets := array_append(update_sets, format('%I = %L', 'rejection_reason', 'public'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_by_player_id') and next_status = 'verified' then
    update_sets := array_append(update_sets, format('%I = %s', 'verified_by_player_id', verifier.id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_by_player_name') and next_status = 'verified' then
    update_sets := array_append(update_sets, format('%I = %L', 'verified_by_player_name', coalesce(nullif(trim(verifier.display_name), ''), nullif(trim(verifier.slug), ''), 'Beta verifier')));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='updated_at') then
    update_sets := array_append(update_sets, 'updated_at = now()');
  end if;

  execute format(
    'update public.drink_events set %s where id = %s and coalesce(status, %L) = %L',
    array_to_string(update_sets, ', '),
    drink_event_id,
    'pending',
    'pending'
  );

  return jsonb_build_object('ok', true, 'id', drink_event_id, 'drink_event_id', drink_event_id, 'status', next_status);
end;
$fn$;

grant execute on function public.verify_drink_event_public(text, bigint, boolean, boolean, double precision, double precision, double precision) to anon, authenticated;

create or replace function public.rebuild_klaverjas_ratings()
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  g record;
  team1_players text[];
  team2_players text[];
  team1_avg numeric;
  team2_avg numeric;
  expected_1 numeric;
  actual_1 numeric;
  k_factor numeric := 30.0;
  margin_factor numeric;
  delta_total numeric;
  p text;
  before_rating numeric;
  after_rating numeric;
  ts timestamptz;
begin
  if to_regclass('public.klaverjas_player_rating_history') is not null then
    delete from public.klaverjas_player_rating_history where true;
  end if;
  if to_regclass('public.klaverjas_player_ratings') is not null then
    delete from public.klaverjas_player_ratings where true;
  end if;

  for g in
    with per_game as (
      select
        j.id,
        j.played_at,
        j.created_at,
        array_agg(e.display_name order by e.seat_no) filter (where e.team_no = 1) as team1_players,
        array_agg(e.display_name order by e.seat_no) filter (where e.team_no = 2) as team2_players,
        max(e.total_points) filter (where e.team_no = 1) as team1_points,
        max(e.total_points) filter (where e.team_no = 2) as team2_points
      from public.jas_games j
      join public.jas_game_entries e on e.game_id = j.id
      where coalesce(j.deleted_at, 'infinity'::timestamptz) = 'infinity'::timestamptz
      group by j.id, j.played_at, j.created_at
    )
    select * from per_game order by played_at, created_at, id
  loop
    team1_players := coalesce(g.team1_players, '{}'::text[]);
    team2_players := coalesce(g.team2_players, '{}'::text[]);
    if coalesce(array_length(team1_players, 1), 0) = 0 or coalesce(array_length(team2_players, 1), 0) = 0 then
      continue;
    end if;

    ts := coalesce(g.created_at, now());
    foreach p in array team1_players loop
      insert into public.klaverjas_player_ratings(player_name)
      values (p)
      on conflict (player_name) do nothing;
    end loop;
    foreach p in array team2_players loop
      insert into public.klaverjas_player_ratings(player_name)
      values (p)
      on conflict (player_name) do nothing;
    end loop;

    select avg(elo_rating) into team1_avg from public.klaverjas_player_ratings where player_name = any(team1_players);
    select avg(elo_rating) into team2_avg from public.klaverjas_player_ratings where player_name = any(team2_players);

    expected_1 := public._elo_expected(coalesce(team1_avg, 1000), coalesce(team2_avg, 1000));
    actual_1 := case
      when coalesce(g.team1_points, 0) > coalesce(g.team2_points, 0) then 1
      when coalesce(g.team1_points, 0) < coalesce(g.team2_points, 0) then 0
      else 0.5
    end;
    margin_factor := least(1.5, greatest(1.0, 1.0 + abs(coalesce(g.team1_points, 0) - coalesce(g.team2_points, 0))::numeric / 600.0));
    delta_total := k_factor * margin_factor * (actual_1 - expected_1);

    foreach p in array team1_players loop
      select elo_rating into before_rating from public.klaverjas_player_ratings where player_name = p;
      update public.klaverjas_player_ratings
         set elo_rating = elo_rating + (delta_total / greatest(coalesce(array_length(team1_players, 1), 1), 1)),
             games_played = games_played + 1,
             wins = wins + case when actual_1 = 1 then 1 else 0 end,
             losses = losses + case when actual_1 = 0 then 1 else 0 end,
             draws = draws + case when actual_1 = 0.5 then 1 else 0 end,
             last_match_at = ts,
             updated_at = now()
       where player_name = p;
      select elo_rating into after_rating from public.klaverjas_player_ratings where player_name = p;
      insert into public.klaverjas_player_rating_history(game_id, player_name, rating_before, rating_after, created_at)
      values (g.id, p, coalesce(before_rating, 1000), coalesce(after_rating, 1000), ts);
    end loop;

    foreach p in array team2_players loop
      select elo_rating into before_rating from public.klaverjas_player_ratings where player_name = p;
      update public.klaverjas_player_ratings
         set elo_rating = elo_rating - (delta_total / greatest(coalesce(array_length(team2_players, 1), 1), 1)),
             games_played = games_played + 1,
             wins = wins + case when actual_1 = 0 then 1 else 0 end,
             losses = losses + case when actual_1 = 1 then 1 else 0 end,
             draws = draws + case when actual_1 = 0.5 then 1 else 0 end,
             last_match_at = ts,
             updated_at = now()
       where player_name = p;
      select elo_rating into after_rating from public.klaverjas_player_ratings where player_name = p;
      insert into public.klaverjas_player_rating_history(game_id, player_name, rating_before, rating_after, created_at)
      values (g.id, p, coalesce(before_rating, 1000), coalesce(after_rating, 1000), ts);
    end loop;
  end loop;
end;
$fn$;

grant execute on function public.rebuild_klaverjas_ratings() to anon, authenticated;

create or replace function public.process_game_rating_rebuild_queue(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  q record;
  processed integer := 0;
  failed integer := 0;
begin
  for q in
    select id, game_type
      from public.game_rating_rebuild_queue
     where status = 'pending'
     order by requested_at, id
     limit greatest(coalesce(p_limit, 10), 1)
     for update skip locked
  loop
    update public.game_rating_rebuild_queue
       set status = 'processing'
     where id = q.id;
    begin
      if q.game_type = 'beerpong' then
        perform public.rebuild_beerpong_ratings();
      elsif q.game_type = 'klaverjas' then
        perform public.rebuild_klaverjas_ratings();
      elsif q.game_type = 'boerenbridge' then
        perform public.rebuild_boerenbridge_ratings();
      else
        raise exception 'Onbekend speltype: %', q.game_type;
      end if;

      update public.game_rating_rebuild_queue
         set status = 'done',
             processed_at = now(),
             last_error = null
       where id = q.id;
      processed := processed + 1;
    exception when others then
      update public.game_rating_rebuild_queue
         set status = 'error',
             processed_at = now(),
             last_error = sqlerrm
       where id = q.id;
      failed := failed + 1;
    end;
  end loop;

  return jsonb_build_object('ok', failed = 0, 'processed', processed, 'failed', failed);
end;
$fn$;

grant execute on function public.process_game_rating_rebuild_queue(integer) to anon, authenticated;

create or replace function public.create_jas_game(session_token text, game_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  session_player public.players%rowtype;
  game_id_out bigint;
  participant jsonb;
  resolved_player_id bigint;
  payload_participants jsonb;
  participant_count integer;
  distinct_player_count integer;
  seat_arr integer[];
  team_arr integer[];
  missing_name text;
  rebuild_result jsonb := null;
  rebuild_error text := null;
begin
  session_player := public._jas_session_player(session_token);
  payload_participants := coalesce(game_payload -> 'participants', '[]'::jsonb);

  if coalesce(nullif(trim(game_payload ->> 'variant'), ''), '4_player') <> '4_player' then
    raise exception 'Alleen 4-speler klaverjas wordt ondersteund in deze versie';
  end if;
  if coalesce(nullif(trim(game_payload ->> 'scoreboard_mode'), ''), 'teams') <> 'teams' then
    raise exception 'Alleen teamscore wordt ondersteund in deze versie';
  end if;
  if jsonb_typeof(payload_participants) <> 'array' then
    raise exception 'Deelnemers ontbreken';
  end if;

  participant_count := jsonb_array_length(payload_participants);
  if participant_count <> 4 then
    raise exception 'Kies precies 4 geregistreerde spelers';
  end if;

  select count(distinct lower(trim(value ->> 'name')))
    into distinct_player_count
    from jsonb_array_elements(payload_participants) value;
  if distinct_player_count <> 4 then
    raise exception 'Elke speler mag maar een keer gekozen worden';
  end if;

  select array_agg((value ->> 'seat_no')::integer order by (value ->> 'seat_no')::integer),
         array_agg((value ->> 'team_no')::integer order by (value ->> 'seat_no')::integer)
    into seat_arr, team_arr
    from jsonb_array_elements(payload_participants) value;
  if seat_arr is distinct from array[1,2,3,4] then
    raise exception 'Stoelen moeten 1 t/m 4 zijn';
  end if;
  if team_arr is distinct from array[1,2,1,2] then
    raise exception 'Teams moeten stoel 1+3 en 2+4 gebruiken';
  end if;

  for participant in select * from jsonb_array_elements(payload_participants)
  loop
    select p.id
      into resolved_player_id
      from public.players p
     where lower(p.display_name) = lower(trim(participant ->> 'name'))
     limit 1;

    if resolved_player_id is null then
      missing_name := coalesce(participant ->> 'name', 'Onbekend');
      raise exception 'Speler niet gevonden of niet geregistreerd: %', missing_name;
    end if;
  end loop;

  insert into public.jas_games(title, played_at, variant, scoreboard_mode, created_by_player_id, created_by_name, payload, updated_at)
  values (
    coalesce(nullif(trim(game_payload ->> 'title'), ''), 'Klaverjas potje'),
    coalesce(nullif(game_payload ->> 'played_at', '')::date, current_date),
    '4_player',
    'teams',
    session_player.id,
    session_player.display_name,
    coalesce(game_payload, '{}'::jsonb),
    now()
  )
  returning id into game_id_out;

  for participant in select * from jsonb_array_elements(payload_participants)
  loop
    select p.id
      into resolved_player_id
      from public.players p
     where lower(p.display_name) = lower(trim(participant ->> 'name'))
     limit 1;

    insert into public.jas_game_entries(game_id, player_id, display_name, seat_no, team_no, total_points, is_winner)
    values (
      game_id_out,
      resolved_player_id,
      coalesce(nullif(trim(participant ->> 'name'), ''), 'Onbekend'),
      (participant ->> 'seat_no')::integer,
      (participant ->> 'team_no')::integer,
      coalesce((participant ->> 'total_points')::integer, 0),
      coalesce((participant ->> 'is_winner')::boolean, false)
    );
  end loop;

  begin
    perform public._enqueue_rating_rebuild('klaverjas', 'new_match', game_id_out::text, 'player', session_player.display_name);
    rebuild_result := public.process_game_rating_rebuild_queue(10);
  exception when others then
    rebuild_error := sqlerrm;
    begin
      update public.game_rating_rebuild_queue
         set status = 'error',
             processed_at = now(),
             last_error = rebuild_error
       where game_type = 'klaverjas'
         and match_ref = game_id_out::text
         and status in ('pending', 'processing');
    exception when others then
      null;
    end;
  end;

  return jsonb_build_object(
    'ok', true,
    'game_id', game_id_out,
    'rating_rebuild_ok', rebuild_error is null,
    'rating_rebuild_result', rebuild_result,
    'rating_rebuild_error', rebuild_error
  );
end;
$fn$;

grant execute on function public.create_jas_game(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
