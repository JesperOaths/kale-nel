-- GEJAST v714: Paardenrace start compatibility, Despinoza Pikken lobbies, Pikken archive/ELO, and Web Push v3 wrappers.

begin;

-- 1) Paardenrace start button compatibility with the exact PostgREST argument set shown by the screenshot.
drop function if exists public.start_paardenrace_room_safe(text,text,text,text);
drop function if exists public.start_paardenrace_countdown_safe(text,text,text,text);
drop function if exists public.start_paardenrace_countdown_fast_v687(text,text,text,text);

create or replace function public.start_paardenrace_room_safe(
  room_code_input text default null,
  session_token text default null,
  session_token_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name text := public._paardenrace_require_name(session_token, session_token_input);
  v_room public.paardenrace_rooms%rowtype;
begin
  select * into v_room
  from public.paardenrace_rooms
  where upper(trim(coalesce(room_code,''))) = upper(trim(coalesce(room_code_input,'')))
    and coalesce(stage,'lobby') not in ('closed','deleted','archived')
  order by updated_at desc nulls last, id desc
  limit 1;

  if v_room.id is null then raise exception 'Room niet gevonden.'; end if;
  if lower(coalesce(v_room.host_name,'')) <> lower(coalesce(v_name,'')) then raise exception 'Alleen de host mag starten.'; end if;
  if not public._paardenrace_all_ready(v_room.id) then raise exception 'Nog niet iedereen is ready.'; end if;

  update public.paardenrace_rooms
     set stage = 'countdown',
         countdown_ends_at = now() + interval '5 seconds',
         updated_at = now()
   where id = v_room.id;

  return public._paardenrace_build_room_state(v_room.room_code, session_token, session_token_input);
end
$fn$;

create or replace function public.start_paardenrace_countdown_safe(
  room_code_input text default null,
  session_token text default null,
  session_token_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  return public.start_paardenrace_room_safe(room_code_input, session_token, session_token_input, site_scope_input);
end
$fn$;

create or replace function public.start_paardenrace_countdown_fast_v687(
  room_code_input text default null,
  session_token text default null,
  session_token_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.start_paardenrace_room_safe(room_code_input, session_token, session_token_input, site_scope_input)
$fn$;

-- 2) Pikken lobby codes/names: Despinoza 1, Despinoza 2, ...
create or replace function public._pikken_next_despinoza_lobby_code_v714(site_scope_input text default 'friends')
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
  v_n integer := 1;
  v_code text;
begin
  loop
    v_code := 'DESPINOZA ' || v_n::text;
    if not exists (
      select 1
      from public.pikken_games g
      where upper(trim(coalesce(g.lobby_code,''))) = upper(v_code)
        and coalesce(g.site_scope,'friends') = v_scope
        and coalesce(g.status, g.state->>'phase', 'lobby') not in ('finished','deleted','closed')
        and coalesce(g.updated_at, g.created_at, now()) > now() - interval '15 minutes'
    ) then
      return v_code;
    end if;
    v_n := v_n + 1;
    if v_n > 999 then
      return 'DESPINOZA ' || floor(1000 + random() * 8999)::integer::text;
    end if;
  end loop;
end
$fn$;

create or replace function public.pikken_create_lobby_fast_v687(
  session_token text default null,
  session_token_input text default null,
  config_input jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  v_token text := coalesce(session_token_input, session_token);
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
  v_start_dice integer := greatest(1, least(coalesce(nullif(config_input->>'start_dice','')::integer, 6), 10));
  v_code text := public._pikken_next_despinoza_lobby_code_v714(v_scope);
  v_game_id uuid;
  v_name text;
begin
  select * into p from public._gejast_player_from_session(v_token);
  if p.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  v_name := coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', 'Speler');

  insert into public.pikken_games(lobby_code, site_scope, status, config, state, created_by_player_id, created_by_player_name, updated_at)
  values (
    v_code,
    v_scope,
    'lobby',
    coalesce(config_input,'{}'::jsonb) || jsonb_build_object('start_dice', v_start_dice),
    jsonb_build_object('phase','lobby','round_no',0),
    p.id,
    v_name,
    now()
  )
  returning id into v_game_id;

  insert into public.pikken_game_players(game_id, player_id, player_name, seat_index, is_ready, dice_count)
  values (v_game_id, p.id, v_name, 1, false, v_start_dice);

  return jsonb_build_object('ok', true, 'game_id', v_game_id, 'id', v_game_id, 'lobby_code', v_code, 'code', v_code, 'start_dice', v_start_dice);
end
$fn$;

-- 3) Pikken archival savepoints and stats/ELO application.
create table if not exists public.pikken_match_archive_v709 (
  game_id uuid primary key,
  lobby_code text,
  site_scope text not null default 'friends',
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  winner_player_id bigint,
  winner_name text,
  round_count integer not null default 0,
  player_count integer not null default 0,
  final_state jsonb not null default '{}'::jsonb,
  players jsonb not null default '[]'::jsonb,
  reveal jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now()
);

create table if not exists public.pikken_player_stats_v709 (
  site_scope text not null default 'friends',
  player_id bigint not null,
  player_name text not null,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  dice_lost integer not null default 0,
  rounds_played integer not null default 0,
  last_game_id uuid,
  last_played_at timestamptz not null default now(),
  primary key(site_scope, player_id)
);

create table if not exists public.game_elo_ratings (
  game_key text not null,
  player_name text not null,
  elo_rating numeric(10,2) not null default 1000,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  last_match_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (game_key, player_name)
);

create table if not exists public.game_elo_history (
  id bigint generated by default as identity primary key,
  game_key text not null,
  match_ref text not null,
  player_name text not null,
  rating_before numeric(10,2) not null,
  rating_after numeric(10,2) not null,
  delta numeric(10,2) not null,
  finish_position numeric(10,2),
  actual_score numeric(10,4),
  event_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create unique index if not exists game_elo_history_unique_match_player_idx
  on public.game_elo_history (game_key, match_ref, lower(player_name));

create or replace function public._pikken_apply_elo_v714(game_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  g public.pikken_games%rowtype;
  v_match_ref text;
  v_player_count integer;
  rec record;
  v_before numeric;
  v_after numeric;
  v_delta numeric;
begin
  select * into g from public.pikken_games where id = game_id_input limit 1;
  if g.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if coalesce(g.status, g.state->>'phase', '') <> 'finished' then return jsonb_build_object('ok', false, 'reason', 'not_finished'); end if;

  v_match_ref := g.id::text;
  if exists(select 1 from public.game_elo_history where game_key='pikken' and match_ref=v_match_ref) then
    return jsonb_build_object('ok', true, 'already_applied', true);
  end if;

  select count(*)::integer into v_player_count from public.pikken_game_players where game_id = g.id;

  for rec in
    select
      gp.player_name,
      gp.player_id,
      row_number() over (
        order by case when coalesce(gp.dice_count,0) > 0 and gp.eliminated_at is null then 0 else 1 end,
                 coalesce(gp.dice_count,0) desc,
                 gp.seat_index
      ) as finish_position,
      coalesce(gp.dice_count,0) as dice_count
    from public.pikken_game_players gp
    where gp.game_id = g.id
      and nullif(trim(coalesce(gp.player_name,'')), '') is not null
  loop
    insert into public.game_elo_ratings(game_key, player_name)
    values ('pikken', rec.player_name)
    on conflict (game_key, player_name) do nothing;

    select elo_rating into v_before
    from public.game_elo_ratings
    where game_key='pikken' and player_name=rec.player_name;

    v_delta := case
      when rec.finish_position = 1 then 24
      else - greatest(8, round(24::numeric / greatest(v_player_count - 1, 1), 2))
    end;
    v_after := greatest(100, coalesce(v_before,1000) + v_delta);

    update public.game_elo_ratings
       set elo_rating = v_after,
           games_played = games_played + 1,
           wins = wins + case when rec.finish_position = 1 then 1 else 0 end,
           losses = losses + case when rec.finish_position = 1 then 0 else 1 end,
           last_match_at = coalesce(g.finished_at, now()),
           updated_at = now()
     where game_key='pikken' and player_name=rec.player_name;

    insert into public.game_elo_history(game_key, match_ref, player_name, rating_before, rating_after, delta, finish_position, actual_score, event_at, payload)
    values ('pikken', v_match_ref, rec.player_name, coalesce(v_before,1000), v_after, v_after - coalesce(v_before,1000), rec.finish_position, case when rec.finish_position=1 then 1 else 0 end, coalesce(g.finished_at, now()), jsonb_build_object('dice_remaining', rec.dice_count, 'game_id', g.id))
    on conflict do nothing;
  end loop;

  return jsonb_build_object('ok', true, 'applied', true, 'game_id', g.id);
end
$fn$;

create or replace function public.pikken_record_completed_match_v709(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  g public.pikken_games%rowtype;
  v_scope text := coalesce(nullif(site_scope_input,''),'friends');
  v_players jsonb := '[]'::jsonb;
  v_reveal jsonb := '{}'::jsonb;
  v_winner_id bigint;
  v_winner_name text;
  v_round_count integer := 0;
  v_player_count integer := 0;
  v_finished boolean := false;
  v_elo jsonb := '{}'::jsonb;
begin
  if game_id_input is null then raise exception 'Pikken game_id ontbreekt.'; end if;
  select * into g from public.pikken_games where id = game_id_input limit 1;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;

  v_scope := coalesce(nullif(g.site_scope,''), v_scope, 'friends');
  v_finished := coalesce(g.status, g.state->>'phase', '') = 'finished';
  v_reveal := coalesce(g.state->'last_reveal', '{}'::jsonb);
  v_round_count := greatest(0, coalesce(nullif(v_reveal->>'round_no','')::integer, nullif(g.state->>'round_no','')::integer, 0));

  if not v_finished and v_round_count < 10 then
    return jsonb_build_object('ok', false, 'saved', false, 'reason', 'not_finished_or_checkpoint');
  end if;

  select gp.player_id, gp.player_name into v_winner_id, v_winner_name
  from public.pikken_game_players gp
  where gp.game_id = g.id
    and gp.eliminated_at is null
    and coalesce(gp.dice_count,0) > 0
  order by coalesce(gp.dice_count,0) desc, gp.seat_index
  limit 1;

  select count(*)::integer, coalesce(jsonb_agg(to_jsonb(gp) order by gp.seat_index), '[]'::jsonb)
    into v_player_count, v_players
  from public.pikken_game_players gp
  where gp.game_id = g.id;

  insert into public.pikken_match_archive_v709(
    game_id, lobby_code, site_scope, status, started_at, finished_at,
    winner_player_id, winner_name, round_count, player_count, final_state, players, reveal, saved_at
  )
  values (
    g.id, g.lobby_code, v_scope, case when v_finished then 'finished' else 'checkpoint' end, g.created_at, case when v_finished then coalesce(g.finished_at, now()) else null end,
    case when v_finished then v_winner_id else null end, case when v_finished then v_winner_name else null end, v_round_count, v_player_count, coalesce(g.state,'{}'::jsonb), v_players, v_reveal, now()
  )
  on conflict (game_id) do update set
    status = excluded.status,
    finished_at = excluded.finished_at,
    winner_player_id = excluded.winner_player_id,
    winner_name = excluded.winner_name,
    round_count = excluded.round_count,
    player_count = excluded.player_count,
    final_state = excluded.final_state,
    players = excluded.players,
    reveal = excluded.reveal,
    saved_at = now();

  if v_finished then
    insert into public.pikken_player_stats_v709(site_scope, player_id, player_name, games_played, wins, losses, dice_lost, rounds_played, last_game_id, last_played_at)
    select
      v_scope, gp.player_id, gp.player_name, 1,
      case when gp.player_id is not distinct from v_winner_id then 1 else 0 end,
      case when gp.player_id is distinct from v_winner_id then 1 else 0 end,
      greatest(0, coalesce((g.config->>'start_dice')::integer, 6) - coalesce(gp.dice_count,0)),
      v_round_count, g.id, now()
    from public.pikken_game_players gp
    where gp.game_id = g.id and gp.player_id is not null
    on conflict (site_scope, player_id) do update set
      player_name = excluded.player_name,
      games_played = public.pikken_player_stats_v709.games_played + 1,
      wins = public.pikken_player_stats_v709.wins + excluded.wins,
      losses = public.pikken_player_stats_v709.losses + excluded.losses,
      dice_lost = public.pikken_player_stats_v709.dice_lost + excluded.dice_lost,
      rounds_played = public.pikken_player_stats_v709.rounds_played + excluded.rounds_played,
      last_game_id = excluded.last_game_id,
      last_played_at = now();

    v_elo := public._pikken_apply_elo_v714(g.id);
  end if;

  return jsonb_build_object('ok', true, 'saved', true, 'checkpoint', not v_finished, 'game_id', g.id, 'winner_player_id', v_winner_id, 'winner_name', v_winner_name, 'round_count', v_round_count, 'player_count', v_player_count, 'elo', v_elo);
end
$fn$;

-- 4) Web Push v3 wrappers used by the current frontend/runtime/dispatcher.
alter table if exists public.web_push_jobs
  add column if not exists claim_token uuid,
  add column if not exists claimed_by text,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists marked_at timestamptz,
  add column if not exists provider_message_id text,
  add column if not exists error_stage text,
  add column if not exists error_code text,
  add column if not exists error_text text,
  add column if not exists failed_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists attempt_count integer default 0;

drop function if exists public.register_web_push_subscription_v3(text,text,text,text,text,text,boolean,text,text,text,text);
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
language sql
security definer
set search_path to 'public'
as $fn$
  select public.register_web_push_subscription_v2(session_token_input, endpoint_input, p256dh_input, auth_input, page_path_input, permission_input, standalone_input, site_scope_input, platform_input, installation_mode_input, user_agent_input)
$fn$;

drop function if exists public.queue_nearby_verification_pushes_v3(text,bigint,text,integer);
create or replace function public.queue_nearby_verification_pushes_v3(
  request_kind_input text default null,
  request_id_input bigint default null,
  site_scope_input text default 'friends',
  cooldown_seconds_input integer default 600
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.queue_nearby_verification_pushes_v2(request_kind_input, request_id_input, cooldown_seconds_input)
$fn$;

drop function if exists public.claim_web_push_jobs_v3(integer);
create or replace function public.claim_web_push_jobs_v3(max_jobs_input integer default 25)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.claim_web_push_jobs_v2(max_jobs_input, 'dispatcher', gen_random_uuid())
$fn$;

drop function if exists public.requeue_stale_web_push_claims_v3(integer);
create or replace function public.requeue_stale_web_push_claims_v3(stale_minutes_input integer default 5)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_count integer := 0;
begin
  update public.web_push_jobs
     set status='queued', claim_token=null, claimed_by=null, claim_expires_at=null, updated_at=now()
   where status='claimed'
     and coalesce(claim_expires_at, claimed_at + make_interval(mins => greatest(stale_minutes_input,1))) < now();
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'requeued', v_count);
end
$fn$;

drop function if exists public.mark_web_push_job_sent_v3(bigint,text);
create or replace function public.mark_web_push_job_sent_v3(job_id_input bigint default null, provider_message_id_input text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  update public.web_push_jobs
     set status='sent', sent_at=now(), marked_at=now(), updated_at=now(), error_text=null, provider_message_id=provider_message_id_input
   where id=job_id_input;
  return jsonb_build_object('ok', true, 'job_id', job_id_input);
end
$fn$;

drop function if exists public.mark_web_push_job_failed_v3(bigint,text,text,text);
create or replace function public.mark_web_push_job_failed_v3(
  job_id_input bigint default null,
  error_stage_input text default null,
  error_code_input text default null,
  error_text_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  update public.web_push_jobs
     set status='failed', failed_at=now(), marked_at=now(), updated_at=now(), error_stage=left(coalesce(error_stage_input,''),80), error_code=left(coalesce(error_code_input,''),80), error_text=left(coalesce(error_text_input,''),2000)
   where id=job_id_input;
  return jsonb_build_object('ok', true, 'job_id', job_id_input);
end
$fn$;

drop function if exists public.mint_web_push_action_tokens_v3(text,bigint,bigint,text,text,bigint,integer);
drop function if exists public.consume_web_push_action_v3(text);
create table if not exists public.web_push_action_tokens_v714 (
  token text primary key,
  request_kind text not null,
  request_id bigint not null,
  action text not null,
  target_player_id bigint,
  trace_id text,
  site_scope text,
  job_id bigint,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.mint_web_push_action_tokens_v3(
  request_kind_input text default null,
  request_id_input bigint default null,
  target_player_id_input bigint default null,
  trace_id_input text default null,
  scope_input text default null,
  job_id_input bigint default null,
  expires_in_seconds_input integer default 900
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  with tokens as (
    select
      encode(gen_random_bytes(18), 'hex') as verify_token,
      encode(gen_random_bytes(18), 'hex') as reject_token,
      now() + make_interval(secs => greatest(coalesce(expires_in_seconds_input,900),60)) as exp
  ), ins as (
    insert into public.web_push_action_tokens_v714(token, request_kind, request_id, action, target_player_id, trace_id, site_scope, job_id, expires_at)
    select verify_token, lower(coalesce(request_kind_input,'')), request_id_input, 'verify', target_player_id_input, trace_id_input, scope_input, job_id_input, exp from tokens
    union all
    select reject_token, lower(coalesce(request_kind_input,'')), request_id_input, 'reject', target_player_id_input, trace_id_input, scope_input, job_id_input, exp from tokens
    returning token
  )
  select jsonb_build_object('ok', true, 'verify_action_token', (select verify_token from tokens), 'reject_action_token', (select reject_token from tokens), 'expires_at', (select exp from tokens))
$fn$;

create or replace function public.consume_web_push_action_v3(action_token_input text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  t public.web_push_action_tokens_v714%rowtype;
  v_status text;
  v_count integer := 0;
begin
  select * into t
  from public.web_push_action_tokens_v714
  where token = action_token_input
  for update;

  if t.token is null then
    return jsonb_build_object('ok', false, 'reason', 'token_not_found');
  end if;
  if t.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'token_already_used');
  end if;
  if t.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'token_expired');
  end if;

  update public.web_push_action_tokens_v714
     set used_at = now()
   where token = t.token;

  v_status := case when t.action = 'verify' then 'verified' else 'rejected' end;

  if t.request_kind = 'drink' and to_regclass('public.drink_events') is not null then
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='status') then
      execute 'update public.drink_events set status=$1 where id=$2 and coalesce(status,''pending'')=''pending''' using v_status, t.request_id;
      get diagnostics v_count = row_count;
    end if;
    if t.action = 'verify' and exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_at') then
      execute 'update public.drink_events set verified_at=coalesce(verified_at, now()) where id=$1' using t.request_id;
    end if;
  elsif t.request_kind = 'speed' and to_regclass('public.drink_speed_attempts') is not null then
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='status') then
      execute 'update public.drink_speed_attempts set status=$1 where id=$2 and coalesce(status,''pending'')=''pending''' using v_status, t.request_id;
      get diagnostics v_count = row_count;
    end if;
    if t.action = 'verify' and exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='verified_at') then
      execute 'update public.drink_speed_attempts set verified_at=coalesce(verified_at, now()) where id=$1' using t.request_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'action', t.action, 'request_kind', t.request_kind, 'request_id', t.request_id, 'updated_count', v_count);
end
$fn$;

grant execute on function public.start_paardenrace_room_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_countdown_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_countdown_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public._pikken_next_despinoza_lobby_code_v714(text) to anon, authenticated;
grant execute on function public.pikken_create_lobby_fast_v687(text,text,jsonb,text) to anon, authenticated;
grant execute on function public._pikken_apply_elo_v714(uuid) to anon, authenticated;
grant execute on function public.pikken_record_completed_match_v709(text,text,uuid,text) to anon, authenticated;
grant execute on function public.register_web_push_subscription_v3(text,text,text,text,text,text,boolean,text,text,text,text) to anon, authenticated;
grant execute on function public.queue_nearby_verification_pushes_v3(text,bigint,text,integer) to anon, authenticated;
grant execute on function public.claim_web_push_jobs_v3(integer) to anon, authenticated;
grant execute on function public.requeue_stale_web_push_claims_v3(integer) to anon, authenticated;
grant execute on function public.mark_web_push_job_sent_v3(bigint,text) to anon, authenticated;
grant execute on function public.mark_web_push_job_failed_v3(bigint,text,text,text) to anon, authenticated;
grant execute on function public.mint_web_push_action_tokens_v3(text,bigint,bigint,text,text,bigint,integer) to anon, authenticated;
grant execute on function public.consume_web_push_action_v3(text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
