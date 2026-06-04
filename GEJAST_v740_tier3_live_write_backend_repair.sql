-- GEJAST v740: Tier 3 live-write backend repair notes.
-- Symptoms from Tier 3 beta live-write tests:
--   record "new" has no field "lat"
--   record "v_player" has no field "chosen_username"
--   column reference "client_match_id" is ambiguous
--
-- The live drinks trigger/RPC stack expects drink_events rows to expose lat/lng
-- fields. Add the compatible nullable columns instead of changing existing
-- trigger ownership. This is intentionally narrow and reversible.
--
-- The Rad symptom points at an older rad_log_* RPC compiled against
-- players.chosen_username. If the live players table does not have that column,
-- adding a generated-compatible nullable column is the least invasive bridge.
--
-- The Beerpong/Boerenbridge client_match_id ambiguity needs the affected SQL
-- functions to be re-created with disambiguated parameter names or qualified
-- references. Do not paper over that in the frontend; the RPC currently fails
-- before the client can verify stats/vault updates.

begin;

alter table if exists public.drink_events
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists accuracy double precision;

alter table if exists public.players
  add column if not exists chosen_username text;

update public.players
   set chosen_username = coalesce(
     nullif(trim(chosen_username), ''),
     nullif(trim(display_name), '')
   )
 where chosen_username is null or trim(chosen_username) = '';

create index if not exists drink_events_location_pending_idx
  on public.drink_events (site_scope, status, created_at desc)
  where lat is not null and lng is not null;

create index if not exists players_chosen_username_lower_idx
  on public.players (lower(chosen_username))
  where chosen_username is not null;

create or replace function public.save_beerpong_match(
  session_token text default null,
  client_match_id text default null,
  payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_player public.players%rowtype;
  v_client_match_id text := nullif(trim(coalesce(save_beerpong_match.client_match_id, '')), '');
  v_payload jsonb := coalesce(save_beerpong_match.payload, '{}'::jsonb);
  v_match_id bigint;
  v_match_format text := lower(trim(coalesce(v_payload->>'match_format', '1v1')));
  v_team_a text[] := coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_payload->'team_a_player_names', '[]'::jsonb))), '{}'::text[]);
  v_team_b text[] := coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_payload->'team_b_player_names', '[]'::jsonb))), '{}'::text[]);
  v_winner_team text := nullif(lower(trim(coalesce(v_payload->>'winner_team', ''))), '');
  v_team_a_cups_left integer := nullif(v_payload->>'team_a_cups_left', '')::integer;
  v_team_b_cups_left integer := nullif(v_payload->>'team_b_cups_left', '')::integer;
  v_finished_at timestamptz := coalesce(nullif(v_payload->>'finished_at', '')::timestamptz, now());
  v_stats_applied boolean := false;
  v_existing_applied_at timestamptz;
  v_k_factor numeric := 32.0;
  v_team_a_avg numeric;
  v_team_b_avg numeric;
  v_expected_a numeric;
  v_expected_b numeric;
  v_actual_a numeric;
  v_actual_b numeric;
  v_delta_a numeric;
  v_delta_b numeric;
  v_name text;
  v_before numeric;
  v_after numeric;
begin
  if v_client_match_id is null then
    raise exception 'client_match_id ontbreekt';
  end if;
  if v_match_format not in ('1v1', '2v2') then
    raise exception 'match_format ongeldig';
  end if;
  if coalesce(array_length(v_team_a, 1), 0) not in (1, 2) then
    raise exception 'team A ongeldig';
  end if;
  if coalesce(array_length(v_team_b, 1), 0) not in (1, 2) then
    raise exception 'team B ongeldig';
  end if;
  if v_winner_team not in ('a', 'b', 'team_a', 'team_b') then
    raise exception 'winner_team ongeldig';
  end if;
  if v_winner_team = 'team_a' then v_winner_team := 'a'; end if;
  if v_winner_team = 'team_b' then v_winner_team := 'b'; end if;

  begin
    if nullif(trim(coalesce(save_beerpong_match.session_token, '')), '') is not null then
      select * into v_player from public._gejast_player_from_session(save_beerpong_match.session_token);
    end if;
  exception when others then
    null;
  end;

  insert into public.beerpong_matches (
    client_match_id, created_by_player_id, match_format, team_a_player_names, team_b_player_names,
    winner_team, team_a_cups_left, team_b_cups_left, finished_at, payload, updated_at
  ) values (
    v_client_match_id, v_player.id, v_match_format, v_team_a, v_team_b,
    v_winner_team, v_team_a_cups_left, v_team_b_cups_left, v_finished_at, v_payload, now()
  )
  on conflict (client_match_id)
  do update set
    created_by_player_id = coalesce(public.beerpong_matches.created_by_player_id, excluded.created_by_player_id),
    match_format = excluded.match_format,
    team_a_player_names = excluded.team_a_player_names,
    team_b_player_names = excluded.team_b_player_names,
    winner_team = excluded.winner_team,
    team_a_cups_left = excluded.team_a_cups_left,
    team_b_cups_left = excluded.team_b_cups_left,
    finished_at = excluded.finished_at,
    payload = excluded.payload,
    updated_at = now()
  returning id, nullif(public.beerpong_matches.payload->>'ratings_applied_at', '')::timestamptz
  into v_match_id, v_existing_applied_at;

  if v_existing_applied_at is null then
    foreach v_name in array v_team_a loop perform public._beerpong_ensure_rating_row(v_name); end loop;
    foreach v_name in array v_team_b loop perform public._beerpong_ensure_rating_row(v_name); end loop;

    select avg(r.elo_rating) into v_team_a_avg from public.beerpong_player_ratings r where r.player_name = any(v_team_a);
    select avg(r.elo_rating) into v_team_b_avg from public.beerpong_player_ratings r where r.player_name = any(v_team_b);

    v_expected_a := public._beerpong_expected_score(v_team_a_avg, v_team_b_avg);
    v_expected_b := public._beerpong_expected_score(v_team_b_avg, v_team_a_avg);
    v_actual_a := case when v_winner_team = 'a' then 1 else 0 end;
    v_actual_b := case when v_winner_team = 'b' then 1 else 0 end;
    v_delta_a := v_k_factor * (v_actual_a - v_expected_a);
    v_delta_b := v_k_factor * (v_actual_b - v_expected_b);

    foreach v_name in array v_team_a loop
      select r.elo_rating into v_before from public.beerpong_player_ratings r where r.player_name = v_name;
      update public.beerpong_player_ratings r
         set elo_rating = r.elo_rating + (v_delta_a / greatest(coalesce(array_length(v_team_a, 1), 1), 1)),
             games_played = r.games_played + 1,
             wins = r.wins + case when v_winner_team = 'a' then 1 else 0 end,
             losses = r.losses + case when v_winner_team = 'b' then 1 else 0 end,
             last_match_at = v_finished_at,
             updated_at = now()
       where r.player_name = v_name;
      select r.elo_rating into v_after from public.beerpong_player_ratings r where r.player_name = v_name;
      insert into public.beerpong_player_rating_history(match_id, player_name, rating_before, rating_after, created_at)
      values (v_match_id, v_name, coalesce(v_before, 1000), coalesce(v_after, 1000), v_finished_at);
    end loop;

    foreach v_name in array v_team_b loop
      select r.elo_rating into v_before from public.beerpong_player_ratings r where r.player_name = v_name;
      update public.beerpong_player_ratings r
         set elo_rating = r.elo_rating + (v_delta_b / greatest(coalesce(array_length(v_team_b, 1), 1), 1)),
             games_played = r.games_played + 1,
             wins = r.wins + case when v_winner_team = 'b' then 1 else 0 end,
             losses = r.losses + case when v_winner_team = 'a' then 1 else 0 end,
             last_match_at = v_finished_at,
             updated_at = now()
       where r.player_name = v_name;
      select r.elo_rating into v_after from public.beerpong_player_ratings r where r.player_name = v_name;
      insert into public.beerpong_player_rating_history(match_id, player_name, rating_before, rating_after, created_at)
      values (v_match_id, v_name, coalesce(v_before, 1000), coalesce(v_after, 1000), v_finished_at);
    end loop;

    update public.beerpong_matches
       set payload = jsonb_set(coalesce(public.beerpong_matches.payload, '{}'::jsonb), '{ratings_applied_at}', to_jsonb(now()::text), true),
           updated_at = now()
     where id = v_match_id;
    v_stats_applied := true;
  end if;

  return jsonb_build_object('ok', true, 'match_id', v_match_id, 'client_match_id', v_client_match_id, 'ratings_applied', v_stats_applied);
end;
$fn$;

grant execute on function public.save_beerpong_match(text, text, jsonb) to anon, authenticated;

create or replace function public.save_boerenbridge_match(
  session_token text,
  client_match_id text,
  rules_version text,
  app_version text,
  match_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player public.players%rowtype;
  v_client_match_id text := nullif(trim(coalesce(save_boerenbridge_match.client_match_id, '')), '');
  v_payload jsonb := coalesce(save_boerenbridge_match.match_payload, '{}'::jsonb);
  v_match_id bigint;
  v_totals jsonb := coalesce(v_payload->'totals', '[]'::jsonb);
  v_summary jsonb := coalesce(v_payload->'match_summary', '{}'::jsonb);
  v_participants text[] := coalesce(
    (select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_payload->'participants', v_payload->'players', '[]'::jsonb))),
    '{}'::text[]
  );
  v_winners text[] := coalesce(
    (select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_summary->'winner_names', v_payload->'winner_names', '[]'::jsonb))),
    '{}'::text[]
  );
  v_round jsonb;
  v_player_name text;
  v_points integer;
  v_exact integer;
  v_slagen integer;
begin
  if v_client_match_id is null then
    raise exception 'client_match_id ontbreekt';
  end if;

  begin
    if nullif(trim(coalesce(save_boerenbridge_match.session_token, '')), '') is not null then
      v_player := public._gejast_player_from_session(save_boerenbridge_match.session_token);
    end if;
  exception when others then
    null;
  end;

  insert into public.boerenbridge_matches (
    client_match_id,
    created_by_player_id,
    app_version,
    rules_version,
    created_at,
    finished_at,
    participant_names,
    player_count,
    winner_names,
    top_score,
    totals,
    match_payload
  )
  values (
    v_client_match_id,
    v_player.id,
    coalesce(save_boerenbridge_match.app_version, v_payload->>'app_version'),
    coalesce(save_boerenbridge_match.rules_version, v_payload->>'rules_version'),
    coalesce((v_payload->>'created_at')::timestamptz, now()),
    (v_payload->>'finished_at')::timestamptz,
    v_participants,
    coalesce((v_payload->>'player_count')::integer, coalesce(array_length(v_participants, 1), 0)),
    v_winners,
    nullif(v_summary->>'top_score', '')::integer,
    v_totals,
    v_payload
  )
  on conflict (client_match_id)
  do update set
    created_by_player_id = excluded.created_by_player_id,
    app_version = excluded.app_version,
    rules_version = excluded.rules_version,
    finished_at = excluded.finished_at,
    participant_names = excluded.participant_names,
    player_count = excluded.player_count,
    winner_names = excluded.winner_names,
    top_score = excluded.top_score,
    totals = excluded.totals,
    match_payload = excluded.match_payload
  returning id into v_match_id;

  delete from public.boerenbridge_match_rounds where match_id = v_match_id;

  for v_round in select value from jsonb_array_elements(coalesce(v_payload->'rounds', '[]'::jsonb))
  loop
    insert into public.boerenbridge_match_rounds (
      match_id, round_index, label, trick_count, dealer_index, special_name, round_payload
    ) values (
      v_match_id,
      coalesce((v_round->>'round_index')::integer, 0),
      coalesce(v_round->>'label', '?'),
      coalesce((v_round->>'trick_count')::integer, 0),
      nullif(v_round->>'dealer_index', '')::integer,
      nullif(v_round->>'special', ''),
      v_round
    );
  end loop;

  for v_player_name, v_points, v_exact, v_slagen in
    select
      coalesce(value->>'name', ''),
      coalesce((value->>'final_total_points')::integer, 0),
      coalesce((value->>'exact_bid_count')::integer, 0),
      coalesce((value->>'total_slagen')::integer, 0)
    from jsonb_array_elements(v_totals)
  loop
    if nullif(trim(v_player_name), '') is null then
      continue;
    end if;

    insert into public.boerenbridge_player_stats (
      player_name, games_played, wins, total_points, exact_bid_count, total_slagen, updated_at
    ) values (
      v_player_name,
      1,
      case when v_player_name = any(v_winners) then 1 else 0 end,
      v_points,
      v_exact,
      v_slagen,
      now()
    )
    on conflict (player_name)
    do update set
      games_played = public.boerenbridge_player_stats.games_played + 1,
      wins = public.boerenbridge_player_stats.wins + case when excluded.wins > 0 then 1 else 0 end,
      total_points = public.boerenbridge_player_stats.total_points + excluded.total_points,
      exact_bid_count = public.boerenbridge_player_stats.exact_bid_count + excluded.exact_bid_count,
      total_slagen = public.boerenbridge_player_stats.total_slagen + excluded.total_slagen,
      updated_at = now();
  end loop;

  return jsonb_build_object('ok', true, 'match_id', v_match_id, 'client_match_id', v_client_match_id, 'stats_applied', true);
end;
$function$;

grant execute on function public.save_boerenbridge_match(text, text, text, text, jsonb) to anon, authenticated;

create or replace function public._tier3_player_from_any_session_v740(session_token_input text)
returns public.players
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := nullif(trim(coalesce(session_token_input, '')), '');
  v_player public.players%rowtype;
begin
  if v_token is null then
    return v_player;
  end if;

  begin
    v_player := public._gejast_player_from_session(v_token);
    if v_player.id is not null then
      return v_player;
    end if;
  exception when others then
    null;
  end;

  if to_regclass('public.gejast_player_sessions_v691') is not null then
    select p.* into v_player
      from public.gejast_player_sessions_v691 s
      join public.players p on p.id = s.player_id
     where s.session_token = v_token
       and coalesce(s.expires_at, now() + interval '1 minute') > now()
     limit 1;
    if v_player.id is not null then
      update public.gejast_player_sessions_v691
         set last_seen_at = now()
       where session_token = v_token;
      return v_player;
    end if;
  end if;

  select * into v_player
    from public.players p
   where p.session_token = v_token
   limit 1;

  return v_player;
end;
$fn$;

create or replace function public.rad_log_spin_scoped(
  session_token text default null,
  session_token_input text default null,
  segment_key_input text default null,
  segment_label_input text default null,
  segment_type_input text default null,
  chance_input numeric default null,
  copy_text_input text default null,
  drinks_input jsonb default '[]'::jsonb,
  meta_input jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_player public.players%rowtype;
  v_token text := nullif(trim(coalesce(rad_log_spin_scoped.session_token, rad_log_spin_scoped.session_token_input, '')), '');
  v_spin_id bigint;
  v_key text := nullif(trim(coalesce(segment_key_input, '')), '');
  v_label text := nullif(trim(coalesce(segment_label_input, '')), '');
  v_player_name text;
begin
  if v_token is null then
    raise exception 'Log eerst in als speler.';
  end if;

  v_player := public._tier3_player_from_any_session_v740(v_token);
  v_player_name := coalesce(
    nullif(trim(v_player.chosen_username), ''),
    nullif(trim(v_player.display_name), '')
  );
  if v_player.id is null or v_player_name is null then
    raise exception 'Log eerst in als speler.';
  end if;

  if v_key is null then
    v_key := lower(regexp_replace(coalesce(v_label, 'rad-spin'), '[^a-z0-9]+', '_', 'gi'));
  end if;
  if v_label is null then
    v_label := replace(initcap(replace(v_key, '_', ' ')), ' Adt', ' adt');
  end if;

  insert into public.rad_spin_events(
    site_scope, player_id, player_name, segment_key, segment_label, segment_type, chance, copy_text, drinks, meta
  ) values (
    v_scope, v_player.id, v_player_name, v_key, v_label, nullif(trim(coalesce(segment_type_input, '')), ''), chance_input, nullif(trim(coalesce(copy_text_input, '')), ''), coalesce(drinks_input, '[]'::jsonb), coalesce(meta_input, '{}'::jsonb)
  ) returning spin_id into v_spin_id;

  return jsonb_build_object(
    'spin_id', v_spin_id,
    'player_name', v_player_name,
    'segment_key', v_key,
    'segment_label', v_label,
    'site_scope', v_scope
  );
end;
$fn$;

grant execute on function public.rad_log_spin_scoped(text, text, text, text, text, numeric, text, jsonb, jsonb, text) to anon, authenticated;

create or replace function public.rad_log_target_nomination_scoped(
  session_token text default null,
  session_token_input text default null,
  spin_id_input bigint default null,
  segment_key_input text default null,
  segment_label_input text default null,
  target_player_name_input text default null,
  meta_input jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_player public.players%rowtype;
  v_token text := nullif(trim(coalesce(rad_log_target_nomination_scoped.session_token, rad_log_target_nomination_scoped.session_token_input, '')), '');
  v_target text := nullif(trim(coalesce(target_player_name_input, '')), '');
  v_id bigint;
  v_spin public.rad_spin_events%rowtype;
  v_player_name text;
begin
  if v_token is null then
    raise exception 'Log eerst in als speler.';
  end if;
  if v_target is null then
    raise exception 'Kies eerst een speler.';
  end if;

  v_player := public._tier3_player_from_any_session_v740(v_token);
  v_player_name := coalesce(
    nullif(trim(v_player.chosen_username), ''),
    nullif(trim(v_player.display_name), '')
  );
  if v_player.id is null or v_player_name is null then
    raise exception 'Log eerst in als speler.';
  end if;

  if spin_id_input is not null then
    select * into v_spin
      from public.rad_spin_events
     where spin_id = spin_id_input
       and site_scope = v_scope;
  end if;

  insert into public.rad_target_events(
    spin_id, site_scope, nominator_player_name, target_player_name, segment_key, segment_label, meta
  ) values (
    v_spin.spin_id,
    v_scope,
    v_player_name,
    v_target,
    coalesce(nullif(trim(coalesce(segment_key_input, '')), ''), v_spin.segment_key, 'target'),
    coalesce(nullif(trim(coalesce(segment_label_input, '')), ''), v_spin.segment_label, 'Uitdeel-opdracht'),
    coalesce(meta_input, '{}'::jsonb)
  ) returning target_event_id into v_id;

  return jsonb_build_object('target_event_id', v_id, 'target_player_name', v_target, 'site_scope', v_scope);
end;
$fn$;

grant execute on function public.rad_log_target_nomination_scoped(text, text, bigint, text, text, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
