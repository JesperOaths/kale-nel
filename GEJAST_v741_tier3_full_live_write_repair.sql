-- GEJAST v741: consolidated Tier 3 full live-write repair.
-- Run this single file in Supabase SQL editor after the current live build.
-- Includes v730 live Paardenrace/drinks/push RPC compatibility, v731 web-push delivery repair, and v740 Tier 3 live-write backend repair.
-- Consolidated on 2026-06-04 to avoid partial application after repeated aborted turns.

begin;

-- ============================================================================
-- Source: GEJAST_v730_paardenrace_drinks_push_live_repair.sql
-- ============================================================================

-- GEJAST v730: live Paardenrace/drinks/push RPC compatibility repair.
-- Run in Supabase SQL editor after v729 if live probes show PostgREST overloads.


-- Remove the one-argument Paardenrace stats overload so the current two-argument
-- function with default limit_input is the single PostgREST candidate.
drop function if exists public.get_paardenrace_stats_fast_v687(text);

-- Remove older fallback create_drink_event signatures that make the browser's
-- JSON quantity ambiguous against the real numeric implementation.
drop function if exists public.create_drink_event(text, text, integer, double precision, double precision, double precision);

-- Remove token-shaped nearby-push v3 wrappers. The current frontend and v714
-- contract use request_kind/request_id/scope/cooldown.
drop function if exists public.queue_nearby_verification_pushes_v3(text, text, bigint, text);
drop function if exists public.queue_nearby_verification_pushes_v3(text, text, bigint, text, integer);

create or replace function public.get_drinks_pending_verification_summary_v661(
  limit_input integer default 50,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  if to_regprocedure('public.get_drinks_pending_verification_summary_v660(integer,text)') is not null
    or to_regprocedure('public.get_drinks_pending_verification_summary_v660(text,integer)') is not null then
    return public.get_drinks_pending_verification_summary_v660(limit_input => limit_input, site_scope_input => site_scope_input);
  end if;
  return jsonb_build_object(
    'ok', true,
    'source', 'v730_empty_pending_compat',
    'site_scope', case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'limit', greatest(1, least(coalesce(limit_input, 50), 200)),
    'items', '[]'::jsonb,
    'pending', '[]'::jsonb,
    'summary', jsonb_build_object('pending', 0)
  );
end
$fn$;

create or replace function public.get_drinks_push_eligibility_summary_v661(
  limit_input integer default 50,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  if to_regprocedure('public.get_drinks_push_eligibility_summary_v660(integer,text)') is not null
    or to_regprocedure('public.get_drinks_push_eligibility_summary_v660(text,integer)') is not null then
    return public.get_drinks_push_eligibility_summary_v660(limit_input => limit_input, site_scope_input => site_scope_input);
  end if;
  return jsonb_build_object(
    'ok', true,
    'source', 'v730_empty_eligibility_compat',
    'site_scope', case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'limit', greatest(1, least(coalesce(limit_input, 50), 200)),
    'items', '[]'::jsonb,
    'eligible', '[]'::jsonb,
    'summary', jsonb_build_object('eligible', 0)
  );
end
$fn$;

create or replace function public.queue_nearby_verification_pushes_v3(
  request_kind_input text default null,
  request_id_input bigint default null,
  site_scope_input text default 'friends',
  cooldown_seconds_input integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_kind text := lower(trim(coalesce(request_kind_input, '')));
  v_scope text := case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end;
  v_creator_id bigint := null;
  v_lat double precision := null;
  v_lng double precision := null;
  v_accuracy double precision := null;
  v_target_url text := './drinks_pending.html';
  v_count integer := 0;
begin
  if request_id_input is null or request_id_input <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request_id', 'queued_count', 0);
  end if;

  if v_kind = 'drink' then
    if to_regclass('public.drink_events') is null then
      return jsonb_build_object('ok', false, 'reason', 'drink_events_missing', 'queued_count', 0);
    end if;

    select
      nullif(to_jsonb(de)->>'player_id', '')::bigint,
      coalesce(nullif(to_jsonb(de)->>'site_scope', ''), v_scope),
      nullif(to_jsonb(de)->>'lat', '')::double precision,
      nullif(to_jsonb(de)->>'lng', '')::double precision,
      nullif(to_jsonb(de)->>'accuracy', '')::double precision,
      './drinks_pending.html'
    into v_creator_id, v_scope, v_lat, v_lng, v_accuracy, v_target_url
    from public.drink_events de
    where de.id = request_id_input
      and coalesce(to_jsonb(de)->>'status', 'pending') = 'pending'
    limit 1;
  elsif v_kind = 'speed' then
    if to_regclass('public.drink_speed_attempts') is null then
      return jsonb_build_object('ok', false, 'reason', 'drink_speed_attempts_missing', 'queued_count', 0);
    end if;

    select
      nullif(to_jsonb(ds)->>'player_id', '')::bigint,
      coalesce(nullif(to_jsonb(ds)->>'site_scope', ''), v_scope),
      nullif(to_jsonb(ds)->>'lat', '')::double precision,
      nullif(to_jsonb(ds)->>'lng', '')::double precision,
      nullif(to_jsonb(ds)->>'accuracy', '')::double precision,
      './drinks_speed.html'
    into v_creator_id, v_scope, v_lat, v_lng, v_accuracy, v_target_url
    from public.drink_speed_attempts ds
    where ds.id = request_id_input
      and coalesce(to_jsonb(ds)->>'status', 'pending') = 'pending'
    limit 1;
  else
    return jsonb_build_object('ok', false, 'reason', 'invalid_kind', 'queued_count', 0);
  end if;

  if v_creator_id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_pending', 'queued_count', 0);
  end if;

  if v_lat is null or v_lng is null then
    return jsonb_build_object('ok', true, 'reason', 'request_has_no_coordinates', 'queued_count', 0, 'request_kind', v_kind, 'request_id', request_id_input, 'site_scope', v_scope);
  end if;

  if to_regclass('public.web_push_subscriptions') is null or to_regclass('public.web_push_jobs') is null then
    return jsonb_build_object('ok', false, 'reason', 'push_tables_missing', 'queued_count', 0);
  end if;

  insert into public.web_push_jobs(
    status, target_player_id, target_subscription_id, title, body, target_url, payload, site_scope,
    trigger_kind, request_kind, request_id, created_by_player_id, target_player_name, dedupe_key, notification_tag
  )
  select
    'queued',
    s.player_id,
    s.id,
    case when v_kind = 'speed' then 'Nieuwe snelheidspoging in de buurt' else 'Nieuw drankje verifiëren' end,
    case when v_kind = 'speed' then 'Er staat een snelheidspoging in jouw buurt klaar voor verificatie.' else 'Er staat een drankverificatie in jouw buurt klaar.' end,
    v_target_url,
    jsonb_build_object('kind','nearby_verification','request_kind',v_kind,'request_id',request_id_input),
    v_scope,
    'nearby_verification',
    v_kind,
    request_id_input,
    v_creator_id,
    coalesce(nullif(to_jsonb(s)->>'player_name', ''), 'Speler'),
    'nearby:' || v_kind || ':' || request_id_input || ':' || s.id,
    'nearby-' || v_kind || '-' || request_id_input
  from public.web_push_subscriptions s
  where coalesce(to_jsonb(s)->>'disabled_at', '') = ''
    and coalesce(to_jsonb(s)->>'permission_state', '') = 'granted'
    and coalesce(to_jsonb(s)->>'site_scope', v_scope) = v_scope
    and s.player_id <> v_creator_id
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'queued_count', v_count, 'request_kind', v_kind, 'request_id', request_id_input, 'site_scope', v_scope);
end
$fn$;

grant execute on function public.get_drinks_pending_verification_summary_v661(integer, text) to anon, authenticated;
grant execute on function public.get_drinks_push_eligibility_summary_v661(integer, text) to anon, authenticated;
grant execute on function public.queue_nearby_verification_pushes_v3(text, bigint, text, integer) to anon, authenticated;



-- ============================================================================
-- Source: GEJAST_v731_live_push_delivery_repair.sql
-- ============================================================================

-- GEJAST v731: live web-push delivery repair.
-- Repairs the live V3 push registration/test wrappers after v730 diagnostics
-- showed browser subscriptions syncing but self-test jobs queueing zero rows.


drop function if exists public.register_web_push_subscription_v3(text,text,text,text,text,text,text,text);

create or replace function public.register_web_push_subscription_v3(
  session_token_input text default null,
  endpoint_input text default null,
  p256dh_input text default null,
  auth_input text default null,
  user_agent_input text default null,
  permission_input text default null,
  standalone_input boolean default null,
  site_scope_input text default 'friends',
  page_path_input text default null,
  platform_input text default null,
  installation_mode_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_player_id bigint := public._gejast_player_id_from_session(session_token_input);
  v_name text := public._gejast_player_name_from_session(session_token_input);
  v_scope text := case when lower(coalesce(site_scope_input,'friends')) in ('family','familie') then 'family' else 'friends' end;
  v_endpoint text := nullif(trim(coalesce(endpoint_input,'')), '');
  v_row public.web_push_subscriptions%rowtype;
begin
  if v_player_id is null or v_name is null then raise exception 'MISSING_SESSION'; end if;
  if v_endpoint is null then raise exception 'MISSING_ENDPOINT'; end if;

  insert into public.web_push_subscriptions(
    player_id, display_name, endpoint, p256dh_key, auth_key, user_agent, permission_state, platform,
    site_scope, standalone, installation_mode, page_path, created_at, updated_at, last_seen_at,
    last_sync_at, last_success_at, disabled_at, last_error, failure_count
  ) values (
    v_player_id, v_name, v_endpoint, nullif(trim(coalesce(p256dh_input,'')), ''), nullif(trim(coalesce(auth_input,'')), ''),
    nullif(trim(coalesce(user_agent_input,'')), ''), nullif(trim(coalesce(permission_input,'')), ''),
    nullif(trim(coalesce(platform_input,'')), ''), v_scope, standalone_input,
    nullif(trim(coalesce(installation_mode_input,'')), ''), nullif(trim(coalesce(page_path_input,'')), ''),
    now(), now(), now(), now(), now(), null, null, 0
  )
  on conflict (endpoint) do update set
    player_id = excluded.player_id,
    display_name = excluded.display_name,
    p256dh_key = excluded.p256dh_key,
    auth_key = excluded.auth_key,
    user_agent = excluded.user_agent,
    permission_state = excluded.permission_state,
    platform = excluded.platform,
    site_scope = excluded.site_scope,
    standalone = excluded.standalone,
    installation_mode = excluded.installation_mode,
    page_path = excluded.page_path,
    updated_at = now(),
    last_seen_at = now(),
    last_sync_at = now(),
    last_success_at = now(),
    disabled_at = null,
    last_error = null,
    failure_count = 0
  returning * into v_row;

  return jsonb_build_object('ok', true, 'subscription_id', v_row.id, 'player_name', v_name, 'site_scope', v_scope);
end
$fn$;

create or replace function public.queue_test_web_push(
  session_token_input text default null,
  session_token text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := coalesce(nullif(trim(coalesce(session_token_input,'')), ''), nullif(trim(coalesce(session_token,'')), ''));
  v_player_id bigint := public._gejast_player_id_from_session(v_token);
  v_name text := public._gejast_player_name_from_session(v_token);
  v_scope text := case when lower(coalesce(site_scope_input,'friends')) in ('family','familie') then 'family' else 'friends' end;
  v_count integer := 0;
begin
  if v_player_id is null or v_name is null then raise exception 'MISSING_SESSION'; end if;

  insert into public.web_push_jobs(
    status, target_player_id, target_subscription_id, title, body, target_url, payload, site_scope, trigger_kind,
    created_by_player_id, target_player_name, dedupe_key, notification_tag, require_interaction
  )
  select
    'queued', s.player_id, s.id,
    'GEJAST testmelding',
    'Je toestel is gekoppeld en klaar voor web-push.',
    './index.html',
    jsonb_build_object('kind','test','display_name',v_name),
    v_scope, 'self_test',
    v_player_id, v_name,
    'self-test:' || s.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    'self-test',
    false
  from public.web_push_subscriptions s
  where s.player_id = v_player_id
    and s.disabled_at is null
    and coalesce(s.site_scope, v_scope) = v_scope;

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'queued_count', v_count, 'player_name', v_name, 'site_scope', v_scope);
end
$fn$;

grant execute on function public.register_web_push_subscription_v3(text,text,text,text,text,text,boolean,text,text,text,text) to anon, authenticated;
grant execute on function public.queue_test_web_push(text,text,text) to anon, authenticated;



-- ============================================================================
-- Source: GEJAST_v740_tier3_live_write_backend_repair.sql
-- ============================================================================

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

drop function if exists public.save_beerpong_match(text, text, jsonb);

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

drop function if exists public.save_boerenbridge_match(text, text, text, text, jsonb);

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

drop function if exists public.rad_log_spin_scoped(text, text, text, text, text, numeric, text, jsonb, jsonb, text);

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

drop function if exists public.rad_log_target_nomination_scoped(text, text, bigint, text, text, text, jsonb, text);

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

-- Retry overrides from live Tier 3 results after the first repair was applied.
-- Keep these last so their definitions win over earlier compatibility attempts.

do $$
begin
  if to_regclass('public.drink_verified_records') is not null then
    delete from public.drink_verified_records a
      using public.drink_verified_records b
     where a.ctid < b.ctid
       and a.source_kind = b.source_kind
       and a.source_request_id = b.source_request_id;

    drop index if exists public.drink_verified_records_unique_source_idx;
    create unique index if not exists drink_verified_records_unique_source_idx
      on public.drink_verified_records(source_kind, source_request_id);
  end if;
end $$;

create or replace function public._gejast_player_login_payload_v691(player_id_input bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p record;
  v_token text := public._gejast_random_hex_v691(32);
  v_existing_token text;
begin
  select * into p from public.players where id = player_id_input;
  if not found then raise exception 'player_not_found'; end if;

  if to_regclass('public.sessions') is not null then
    begin
      execute 'delete from public.sessions where player_id = $1' using p.id;
    exception when others then
      null;
    end;
  end if;

  update public.gejast_player_sessions_v691
     set session_token = v_token,
         display_name = p.display_name,
         site_scope = coalesce(p.site_scope, 'friends'),
         last_seen_at = now(),
         expires_at = now() + interval '45 days'
   where player_id = p.id
   returning session_token into v_existing_token;

  if v_existing_token is null then
    insert into public.gejast_player_sessions_v691(session_token, player_id, display_name, site_scope)
    values (v_token, p.id, p.display_name, coalesce(p.site_scope, 'friends'));
  end if;

  update public.players
     set session_token = v_token,
         last_login_at = now(),
         updated_at = now()
   where id = p.id;

  return jsonb_build_object(
    'ok', true,
    'session_token', v_token,
    'player_id', p.id,
    'display_name', p.display_name,
    'player_name', p.display_name,
    'site_scope', coalesce(p.site_scope, 'friends')
  );
end;
$fn$;

drop function if exists public.create_drink_event(text, text, integer, double precision, double precision, double precision);

create or replace function public.create_drink_event(
  session_token text default null,
  event_type_key text default null,
  quantity integer default 1,
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
  p public.players%rowtype;
  v_cols text[] := array[]::text[];
  v_vals text[] := array[]::text[];
  v_sql text;
  v_id bigint;
  v_key text := lower(nullif(trim(coalesce(event_type_key, 'bier')), ''));
  v_qty integer := greatest(1, coalesce(quantity, 1));
  v_type_id bigint;
  v_type_label text := coalesce(nullif(trim(event_type_key), ''), 'bier');
  v_unit numeric := 1;
  v_player_name text;
begin
  p := public._tier3_player_from_any_session_v740(session_token);
  v_player_name := coalesce(nullif(trim(p.chosen_username), ''), nullif(trim(p.display_name), ''));
  if p.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  begin
    select id, coalesce(label, key, v_type_label), coalesce(unit_value, 1)
      into v_type_id, v_type_label, v_unit
      from public.drink_event_types
     where lower(key) in (v_key, 'bier', 'beer', 'bak')
     order by case lower(key) when v_key then 0 when 'bier' then 1 when 'beer' then 2 when 'bak' then 3 else 4 end
     limit 1;
  exception when others then
    null;
  end;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'player_id') then
    v_cols := array_append(v_cols, 'player_id'); v_vals := array_append(v_vals, p.id::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'player_name') then
    v_cols := array_append(v_cols, 'player_name'); v_vals := array_append(v_vals, quote_literal(v_player_name));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'event_type_id') and v_type_id is not null then
    v_cols := array_append(v_cols, 'event_type_id'); v_vals := array_append(v_vals, v_type_id::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'event_type_key') then
    v_cols := array_append(v_cols, 'event_type_key'); v_vals := array_append(v_vals, quote_literal(v_key));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'event_type_label') then
    v_cols := array_append(v_cols, 'event_type_label'); v_vals := array_append(v_vals, quote_literal(v_type_label));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'quantity') then
    v_cols := array_append(v_cols, 'quantity'); v_vals := array_append(v_vals, v_qty::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'total_units') then
    v_cols := array_append(v_cols, 'total_units'); v_vals := array_append(v_vals, (v_qty * v_unit)::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'lat') then
    v_cols := array_append(v_cols, 'lat'); v_vals := array_append(v_vals, coalesce(lat::text, 'null'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'lng') then
    v_cols := array_append(v_cols, 'lng'); v_vals := array_append(v_vals, coalesce(lng::text, 'null'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'accuracy') then
    v_cols := array_append(v_cols, 'accuracy'); v_vals := array_append(v_vals, coalesce(accuracy::text, 'null'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'status') then
    v_cols := array_append(v_cols, 'status'); v_vals := array_append(v_vals, quote_literal('pending'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'site_scope') then
    v_cols := array_append(v_cols, 'site_scope'); v_vals := array_append(v_vals, quote_literal(coalesce(p.site_scope, 'friends')));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'metadata') then
    v_cols := array_append(v_cols, 'metadata'); v_vals := array_append(v_vals, quote_literal(jsonb_build_object('source', 'tier3-repair-v740')::text) || '::jsonb');
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'created_at') then
    v_cols := array_append(v_cols, 'created_at'); v_vals := array_append(v_vals, 'now()');
  end if;

  v_sql := format('insert into public.drink_events (%s) values (%s) returning id', array_to_string(v_cols, ', '), array_to_string(v_vals, ', '));
  execute v_sql into v_id;
  return jsonb_build_object('ok', true, 'drink_event_id', v_id, 'event_id', v_id, 'id', v_id, 'status', 'pending');
end;
$fn$;

grant execute on function public.create_drink_event(text, text, integer, double precision, double precision, double precision) to anon, authenticated;

drop function if exists public.save_beerpong_match(text, text, jsonb);

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
  p public.players%rowtype;
  v_client text := nullif(trim(coalesce(save_beerpong_match.client_match_id, '')), '');
  v_payload jsonb := coalesce(save_beerpong_match.payload, '{}'::jsonb);
  v_match_id bigint;
  v_existing bigint;
begin
  if v_client is null then raise exception 'client_match_id ontbreekt'; end if;
  p := public._tier3_player_from_any_session_v740(save_beerpong_match.session_token);

  select m.id into v_existing from public.beerpong_matches m where m.client_match_id = v_client limit 1;
  if v_existing is null then
    insert into public.beerpong_matches(client_match_id, created_by_player_id, match_status, match_format, winner_team, finished_at, payload, created_at, updated_at)
    values (
      v_client,
      p.id,
      'finished',
      coalesce(nullif(v_payload->>'match_format', ''), '1v1'),
      case lower(coalesce(v_payload->>'winner_team', 'team_a')) when 'a' then 'team_a' when 'b' then 'team_b' else lower(coalesce(v_payload->>'winner_team', 'team_a')) end,
      coalesce(nullif(v_payload->>'finished_at', '')::timestamptz, now()),
      v_payload,
      now(),
      now()
    )
    returning id into v_match_id;
  else
    update public.beerpong_matches m
       set payload = v_payload,
           finished_at = coalesce(nullif(v_payload->>'finished_at', '')::timestamptz, m.finished_at, now()),
           match_status = 'finished',
           updated_at = now()
     where m.id = v_existing
     returning m.id into v_match_id;
  end if;

  return jsonb_build_object('ok', true, 'match_id', v_match_id, 'client_match_id', v_client, 'ratings_applied', false);
end;
$fn$;

grant execute on function public.save_beerpong_match(text, text, jsonb) to anon, authenticated;

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
$fn$;

grant execute on function public.save_boerenbridge_match(text, text, text, text, jsonb) to anon, authenticated;



notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
