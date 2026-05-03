-- GEJAST v725 Pikken + Paardenrace pipeline contract SQL
-- Fixes:
-- 1. Removes ambiguous Paardenrace fast-wrapper overloads and recreates one frontend-safe signature each.
-- 2. Removes Pikken's duplicate game_id state argument so Postgres cannot confuse the parameter with columns.
-- 3. Keeps Despinoza N lobby allocation and ready-field compatibility.

do $drop$
declare
  rec record;
begin
  for rec in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'pikken_get_state_scoped',
        'pikken_get_live_state_public',
        'pikken_create_lobby_fast_v687',
        'pikken_create_lobby_scoped',
        'pikken_join_lobby_fast_v687',
        'pikken_join_lobby_scoped',
        'pikken_start_game_scoped',
        'pikken_set_ready_scoped',
        'pikken_place_bid_scoped',
        'pikken_reject_bid_scoped',
        'pikken_cast_vote_scoped',
        'pikken_update_lobby_config_v715',
        'pikken_destroy_game_fast_v687',
        'pikken_destroy_game_scoped',
        'pikken_leave_game_scoped',
        'get_pikken_open_lobbies_fast_v687',
        'get_pikken_live_matches_fast_v687',
        'pikken_find_my_active_game_scoped',
        'cleanup_stale_pikken_rooms_v706',
        '_pikken_state_public_v720',
        '_pikken_state_public_v721',
        '_pikken_state_public_v722',
        '_pikken_state_public_v723',
        '_pikken_state_public_v724',
        '_pikken_state_public_v725',
        '_pikken_count_bid_hits',
        '_pikken_next_alive_seat_v725',
        '_pikken_round_no_v725',
        '_pikken_deal_round_v725',
        '_pikken_finish_vote_v725',
        'get_paardenrace_open_rooms_fast_v687',
        'get_paardenrace_open_rooms_public',
        'get_paardenrace_room_state_fast_v687',
        'get_paardenrace_room_state_safe',
        'join_paardenrace_room_fast_v687',
        'leave_paardenrace_room_fast_v687',
        'disband_paardenrace_room_fast_v687',
        'set_paardenrace_ready_safe',
        'start_paardenrace_room_safe',
        'start_paardenrace_countdown_safe',
        'create_paardenrace_room_safe',
        'create_paardenrace_room_fast_v687'
      )
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

create or replace function public._paardenrace_next_despinoza_room_code_v725()
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_n integer := 1;
  v_code text;
begin
  loop
    v_code := 'DESPINOZA ' || v_n::text;
    if not exists (
      select 1
      from public.paardenrace_rooms r
      where upper(trim(coalesce(r.room_code,''))) = upper(v_code)
    ) then
      return v_code;
    end if;
    v_n := v_n + 1;
    if v_n > 9999 then
      return 'DESPINOZA ' || floor(10000 + random() * 89999)::integer::text;
    end if;
  end loop;
end
$fn$;

create or replace function public.create_paardenrace_room_safe(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name text;
  v_player_id bigint;
  v_code text;
  v_room_id bigint;
  v_attempts integer := 0;
begin
  if to_regprocedure('public._paardenrace_require_name(text,text)') is null
     or to_regprocedure('public._paardenrace_player_id(text,text)') is null
     or to_regprocedure('public._paardenrace_upsert_player(bigint,text,bigint)') is null
     or to_regprocedure('public._paardenrace_build_room_state(text,text,text)') is null then
    raise exception 'paardenrace_backend_missing';
  end if;

  v_name := public._paardenrace_require_name(session_token, session_token_input);
  v_player_id := public._paardenrace_player_id(session_token, session_token_input);

  loop
    v_attempts := v_attempts + 1;
    v_code := public._paardenrace_next_despinoza_room_code_v725();
    begin
      insert into public.paardenrace_rooms(room_code, host_player_id, host_name, stage, updated_at)
      values (v_code, v_player_id, v_name, 'lobby', now())
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_attempts >= 20 then
        raise exception 'Kon geen vrije Despinoza-roomcode reserveren.';
      end if;
    end;
  end loop;

  perform public._paardenrace_upsert_player(v_room_id, v_name, v_player_id);
  return public._paardenrace_build_room_state(v_code, session_token, session_token_input);
end
$fn$;

create or replace function public.create_paardenrace_room_fast_v687(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  room_name_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name text;
  v_player_id bigint;
  v_code text;
  v_room_id bigint;
  v_attempts integer := 0;
begin
  v_name := public._paardenrace_require_name(session_token, session_token_input);
  v_player_id := public._paardenrace_player_id(session_token, session_token_input);

  loop
    v_attempts := v_attempts + 1;
    v_code := public._paardenrace_next_despinoza_room_code_v725();
    begin
      insert into public.paardenrace_rooms(room_code, host_player_id, host_name, stage, updated_at)
      values (v_code, v_player_id, v_name, 'lobby', now())
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_attempts >= 20 then
        raise exception 'Kon geen vrije Despinoza-roomcode reserveren.';
      end if;
    end;
  end loop;

  perform public._paardenrace_upsert_player(v_room_id, v_name, v_player_id);
  return public._paardenrace_build_room_state(v_code, session_token, session_token_input);
end
$fn$;

create or replace function public.join_paardenrace_room_fast_v687(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name text := public._paardenrace_require_name(session_token, session_token_input);
  v_player_id bigint := public._paardenrace_player_id(session_token, session_token_input);
  v_room public.paardenrace_rooms%rowtype;
begin
  select * into v_room
  from public.paardenrace_rooms
  where upper(trim(coalesce(room_code,''))) = upper(trim(coalesce(room_code_input,'')))
    and coalesce(stage,'lobby') not in ('closed','deleted','archived')
  order by updated_at desc nulls last, id desc
  limit 1
  for update;

  if v_room.id is null then
    raise exception 'Room niet gevonden.';
  end if;

  perform public._paardenrace_upsert_player(v_room.id, v_name, v_player_id);
  update public.paardenrace_rooms set updated_at = now() where id = v_room.id;
  return public._paardenrace_build_room_state(v_room.room_code, session_token, session_token_input);
end
$fn$;

create or replace function public.leave_paardenrace_room_fast_v687(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
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
  order by updated_at desc nulls last, id desc
  limit 1
  for update;

  if v_room.id is null then
    return jsonb_build_object('ok', true, 'left', true, 'room', null);
  end if;

  delete from public.paardenrace_room_players
  where room_id = v_room.id
    and lower(coalesce(player_name,'')) = lower(coalesce(v_name,''));

  if lower(coalesce(v_room.host_name,'')) = lower(coalesce(v_name,'')) then
    update public.paardenrace_rooms set stage = 'closed', updated_at = now(), finished_at = coalesce(finished_at, now()) where id = v_room.id;
    return jsonb_build_object('ok', true, 'left', true, 'disbanded', true, 'room', null);
  end if;

  update public.paardenrace_rooms set updated_at = now() where id = v_room.id;
  return public._paardenrace_build_room_state(v_room.room_code, session_token, session_token_input);
end
$fn$;

create or replace function public.disband_paardenrace_room_fast_v687(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
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
  order by updated_at desc nulls last, id desc
  limit 1
  for update;

  if v_room.id is null then
    return jsonb_build_object('ok', true, 'destroyed', false, 'room', null);
  end if;
  if lower(coalesce(v_room.host_name,'')) <> lower(coalesce(v_name,'')) then
    raise exception 'Alleen de host mag de room opheffen.';
  end if;

  update public.paardenrace_rooms set stage = 'closed', updated_at = now(), finished_at = coalesce(finished_at, now()) where id = v_room.id;
  return jsonb_build_object('ok', true, 'destroyed', true, 'room', null);
end
$fn$;

create or replace function public.get_paardenrace_room_state_fast_v687(
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
  return public._paardenrace_build_room_state(room_code_input, session_token, session_token_input);
end
$fn$;

create or replace function public.get_paardenrace_room_state_safe(
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
  return public._paardenrace_build_room_state(room_code_input, session_token, session_token_input);
end
$fn$;

create or replace function public.set_paardenrace_ready_safe(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  ready_input boolean default false,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := coalesce(session_token_input, session_token);
  v_name text;
  v_room public.paardenrace_rooms%rowtype;
begin
  v_name := public._paardenrace_require_name(session_token, session_token_input);

  select * into v_room
  from public.paardenrace_rooms
  where upper(trim(coalesce(room_code,''))) = upper(trim(coalesce(room_code_input,'')))
    and coalesce(stage,'lobby') not in ('closed','deleted','archived')
  order by updated_at desc nulls last, id desc
  limit 1
  for update;

  if v_room.id is null then raise exception 'Room niet gevonden.'; end if;

  update public.paardenrace_room_players
     set is_ready = coalesce(ready_input,false),
         updated_at = now()
   where room_id = v_room.id
     and lower(coalesce(player_name,'')) = lower(coalesce(v_name,''));

  if not found then
    perform public._paardenrace_upsert_player(v_room.id, v_name, public._paardenrace_player_id(session_token, session_token_input));
    update public.paardenrace_room_players
       set is_ready = coalesce(ready_input,false),
           updated_at = now()
     where room_id = v_room.id
       and lower(coalesce(player_name,'')) = lower(coalesce(v_name,''));
  end if;

  update public.paardenrace_rooms set updated_at = now() where id = v_room.id;
  return public._paardenrace_build_room_state(v_room.room_code, session_token, session_token_input);
end
$fn$;

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
  v_player_count integer := 0;
  v_ready_count integer := 0;
  v_suit_count integer := 0;
begin
  select * into v_room
  from public.paardenrace_rooms
  where upper(trim(coalesce(room_code,''))) = upper(trim(coalesce(room_code_input,'')))
    and coalesce(stage,'lobby') not in ('closed','deleted','archived')
  order by updated_at desc nulls last, id desc
  limit 1
  for update;

  if v_room.id is null then raise exception 'Room niet gevonden.'; end if;
  if lower(coalesce(v_room.host_name,'')) <> lower(coalesce(v_name,'')) then raise exception 'Alleen de host mag starten.'; end if;

  select count(*)::integer,
         count(*) filter (where coalesce(is_ready,false))::integer,
         count(distinct nullif(trim(coalesce(selected_suit,'')),''))::integer
    into v_player_count, v_ready_count, v_suit_count
  from public.paardenrace_room_players
  where room_id = v_room.id;

  if v_player_count < 2 then raise exception 'Paardenrace kan niet starten met minder dan 2 spelers.'; end if;
  if v_suit_count < 2 then raise exception 'Paardenrace heeft minstens 2 verschillende paarden nodig.'; end if;
  if v_ready_count < v_player_count then raise exception 'Nog niet iedereen is ready.'; end if;

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
language sql
security definer
set search_path to 'public'
as $fn$
  select public.start_paardenrace_room_safe(room_code_input, session_token, session_token_input, site_scope_input)
$fn$;

create or replace function public.get_paardenrace_open_rooms_fast_v687(
  site_scope_input text default 'friends',
  limit_input integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb := '[]'::jsonb;
  v_scope text := lower(trim(coalesce(site_scope_input, 'friends')));
begin
  if to_regprocedure('public.cleanup_stale_paardenrace_rooms_v718(text)') is not null then
    perform public.cleanup_stale_paardenrace_rooms_v718(site_scope_input);
  elsif to_regprocedure('public.paardenrace_cleanup_idle_lobbies_v495()') is not null then
    perform public.paardenrace_cleanup_idle_lobbies_v495();
  end if;

  if to_regclass('public.paardenrace_rooms') is null then
    return '[]'::jsonb;
  end if;

  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='site_scope') then
    execute $sql$
      select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc nulls last), '[]'::jsonb)
      from (
        select
          r.id,
          r.room_code,
          r.room_code as code,
          coalesce(r.site_scope, 'friends') as site_scope,
          coalesce(r.stage, 'lobby') as stage,
          coalesce(r.stage, 'lobby') as stage_label,
          coalesce(r.host_name, 'Host') as host_name,
          coalesce(r.updated_at, r.created_at, now()) as updated_at,
          coalesce((select count(*) from public.paardenrace_room_players rp where rp.room_id = r.id), 0) as player_count,
          coalesce((select count(*) from public.paardenrace_room_players rp where rp.room_id = r.id and coalesce(rp.is_ready, false)), 0) as ready_count,
          coalesce((select sum(coalesce(rp.wager_bakken,0)) from public.paardenrace_room_players rp where rp.room_id = r.id), 0) as total_wager_bakken
        from public.paardenrace_rooms r
        where lower(trim(coalesce(r.site_scope,'friends'))) = $1
          and lower(coalesce(r.stage,'lobby')) in ('lobby','open','waiting','countdown','race','nominations')
          and coalesce(r.updated_at, r.created_at, now()) >= now() - interval '15 minutes'
        order by coalesce(r.updated_at, r.created_at, now()) desc
        limit $2
      ) x
    $sql$ into v_rows using v_scope, greatest(1, least(coalesce(limit_input,30),50));
  else
    execute $sql$
      select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc nulls last), '[]'::jsonb)
      from (
        select
          r.id,
          r.room_code,
          r.room_code as code,
          'friends' as site_scope,
          coalesce(r.stage, 'lobby') as stage,
          coalesce(r.stage, 'lobby') as stage_label,
          coalesce(r.host_name, 'Host') as host_name,
          coalesce(r.updated_at, r.created_at, now()) as updated_at,
          coalesce((select count(*) from public.paardenrace_room_players rp where rp.room_id = r.id), 0) as player_count,
          coalesce((select count(*) from public.paardenrace_room_players rp where rp.room_id = r.id and coalesce(rp.is_ready, false)), 0) as ready_count,
          coalesce((select sum(coalesce(rp.wager_bakken,0)) from public.paardenrace_room_players rp where rp.room_id = r.id), 0) as total_wager_bakken
        from public.paardenrace_rooms r
        where lower(coalesce(r.stage,'lobby')) in ('lobby','open','waiting','countdown','race','nominations')
          and coalesce(r.updated_at, r.created_at, now()) >= now() - interval '15 minutes'
        order by coalesce(r.updated_at, r.created_at, now()) desc
        limit $1
      ) x
    $sql$ into v_rows using greatest(1, least(coalesce(limit_input,30),50));
  end if;

  return v_rows;
end
$fn$;

create or replace function public.get_paardenrace_open_rooms_public(
  site_scope_input text default 'friends',
  limit_input integer default 30
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.get_paardenrace_open_rooms_fast_v687(site_scope_input, limit_input)
$fn$;

create or replace function public._pikken_state_public_v725(
  game_id_input uuid default null,
  client_match_id uuid default null,
  lobby_code_input text default null,
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
  p public.players%rowtype;
  g public.pikken_games%rowtype;
  v_game_uuid uuid := coalesce(game_id_input, client_match_id);
  v_token text := coalesce(session_token_input, session_token);
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
  v_players jsonb := '[]'::jsonb;
  v_votes jsonb := '[]'::jsonb;
  v_hands jsonb := '[]'::jsonb;
  v_viewer jsonb := '{}'::jsonb;
  v_round integer := 0;
  r record;
begin
  if to_regclass('public.pikken_games') is null then
    raise exception 'pikken_games_missing';
  end if;

  begin
    select * into p from public._gejast_player_from_session(v_token);
  exception when others then
    null;
  end;

  if v_game_uuid is not null then
    select * into g
    from public.pikken_games
    where id = v_game_uuid
      and lower(coalesce(site_scope,'friends')) = lower(v_scope)
    order by updated_at desc nulls last
    limit 1;
  elsif nullif(trim(coalesce(lobby_code_input,'')), '') is not null then
    select * into g
    from public.pikken_games
    where upper(trim(coalesce(lobby_code,''))) = upper(trim(lobby_code_input))
      and lower(coalesce(site_scope,'friends')) = lower(v_scope)
    order by updated_at desc nulls last
    limit 1;
  end if;

  if g.id is null then
    raise exception 'Pikken game niet gevonden.';
  end if;

  v_round := coalesce(nullif(coalesce(g.state,'{}'::jsonb)->>'round_no','')::integer, 0);

  for r in
    select gp.*
    from public.pikken_game_players gp
    where gp.game_id = g.id
    order by gp.seat_index
  loop
    v_players := v_players || jsonb_build_array(jsonb_build_object(
      'player_id', r.player_id,
      'id', r.player_id,
      'player_name', r.player_name,
      'name', r.player_name,
      'seat', r.seat_index,
      'seat_index', r.seat_index,
      'is_ready', coalesce(nullif(to_jsonb(r)->>'is_ready','')::boolean, nullif(to_jsonb(r)->>'ready','')::boolean, false),
      'ready', coalesce(nullif(to_jsonb(r)->>'is_ready','')::boolean, nullif(to_jsonb(r)->>'ready','')::boolean, false),
      'dice_count', coalesce(r.dice_count,0),
      'alive', r.eliminated_at is null,
      'is_host', r.player_id is not distinct from g.created_by_player_id
    ));

    if p.id is not null and r.player_id is not distinct from p.id then
      v_viewer := jsonb_build_object(
        'player_id', r.player_id,
        'id', r.player_id,
        'player_name', r.player_name,
        'name', r.player_name,
        'seat', r.seat_index,
        'seat_index', r.seat_index,
        'is_ready', coalesce(nullif(to_jsonb(r)->>'is_ready','')::boolean, nullif(to_jsonb(r)->>'ready','')::boolean, false),
        'ready', coalesce(nullif(to_jsonb(r)->>'is_ready','')::boolean, nullif(to_jsonb(r)->>'ready','')::boolean, false),
        'dice_count', coalesce(r.dice_count,0),
        'alive', r.eliminated_at is null,
        'is_host', r.player_id is not distinct from g.created_by_player_id
      );
    end if;
  end loop;

  if to_regclass('public.pikken_round_hands') is not null and v_round > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'player_id', h.player_id,
      'dice_values', h.dice_values,
      'dice', h.dice_values,
      'hand', h.dice_values
    )), '[]'::jsonb)
    into v_hands
    from public.pikken_round_hands h
    where h.game_id = g.id
      and h.round_no = v_round
      and (
        p.id is not null and h.player_id is not distinct from p.id
      );
  end if;

  if to_regclass('public.pikken_round_votes') is not null and v_round > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'player_id', gp.player_id,
      'seat', gp.seat_index,
      'seat_index', gp.seat_index,
      'player_name', gp.player_name,
      'name', gp.player_name,
      'status', case when v.vote is true then 'approved' when v.vote is false then 'rejected' else 'waiting' end
    ) order by gp.seat_index), '[]'::jsonb)
    into v_votes
    from public.pikken_game_players gp
    left join public.pikken_round_votes v
      on v.game_id = gp.game_id
     and v.round_no = v_round
     and v.player_id = gp.player_id
    where gp.game_id = g.id
      and gp.eliminated_at is null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'game', jsonb_build_object(
      'id', g.id,
      'game_id', g.id,
      'lobby_code', g.lobby_code,
      'code', g.lobby_code,
      'site_scope', g.site_scope,
      'status', g.status,
      'config', coalesce(g.config, '{}'::jsonb),
      'state', coalesce(g.state, '{}'::jsonb),
      'state_version', coalesce(g.state_version, 0),
      'updated_at', g.updated_at,
      'finished_at', g.finished_at,
      'last_reveal', coalesce(g.state->'last_reveal', 'null'::jsonb)
    ),
    'viewer', v_viewer,
    'players', v_players,
    'hands', v_hands,
    'round_hands', v_hands,
    'votes', v_votes,
    'dice_totals', jsonb_build_object(
      'start_total', coalesce((select sum(coalesce(g2.config->>'start_dice','6')::integer) from public.pikken_games g2 where g2.id = g.id), 0),
      'current_total', (select coalesce(sum(coalesce(dice_count,0)),0) from public.pikken_game_players where game_id = g.id),
      'lost_total', 0
    )
  );
end
$fn$;

create or replace function public.pikken_get_state_scoped(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public._pikken_state_public_v725(game_id_input, null, lobby_code_input, session_token, session_token_input, site_scope_input)
$fn$;

create or replace function public.pikken_get_state_scoped(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  game_id uuid default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public._pikken_state_public_v725(coalesce(game_id_input, game_id), null, lobby_code_input, session_token, session_token_input, site_scope_input)
$fn$;

create or replace function public.pikken_get_live_state_public(
  game_id_input uuid default null,
  client_match_id uuid default null,
  session_token text default null,
  session_token_input text default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public._pikken_state_public_v725(game_id_input, client_match_id, lobby_code_input, session_token, session_token_input, site_scope_input)
$fn$;

create or replace function public.pikken_get_live_state_public(
  game_id_input uuid default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public._pikken_state_public_v725(game_id_input, null, lobby_code_input, null, null, site_scope_input)
$fn$;

create extension if not exists pgcrypto;

create or replace function public._pikken_next_despinoza_lobby_code_v725(site_scope_input text default 'friends')
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_n integer := 1;
  v_code text;
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
begin
  loop
    v_code := 'DESPINOZA ' || v_n::text;
    if not exists (
      select 1 from public.pikken_games g
      where upper(trim(coalesce(g.lobby_code,''))) = upper(v_code)
        and lower(coalesce(g.site_scope,'friends')) = lower(v_scope)
        and lower(coalesce(g.status,'')) in ('lobby','open','waiting','live','bidding','voting','active')
        and coalesce(g.updated_at, g.created_at, now()) >= now() - interval '15 minutes'
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

create or replace function public.get_pikken_open_lobbies_fast_v687(
  site_scope_input text default 'friends',
  limit_input integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb := '[]'::jsonb;
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
begin
  if to_regclass('public.pikken_games') is null then
    return jsonb_build_object('ok', true, 'rows', '[]'::jsonb, 'items', '[]'::jsonb, 'lobbies', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc nulls last), '[]'::jsonb)
  into v_rows
  from (
    select
      g.id,
      g.id::text as game_id,
      g.lobby_code,
      g.lobby_code as code,
      coalesce(g.site_scope,'friends') as site_scope,
      coalesce(g.status,'lobby') as status,
      coalesce(g.updated_at, g.created_at, now()) as updated_at,
      coalesce((select count(*) from public.pikken_game_players gp where gp.game_id = g.id), 0) as player_count,
      coalesce((select count(*) from public.pikken_game_players gp where gp.game_id = g.id and coalesce(nullif(to_jsonb(gp)->>'ready','')::boolean, nullif(to_jsonb(gp)->>'is_ready','')::boolean, false)), 0) as ready_count,
      coalesce(g.created_by_player_name, (select gp.player_name from public.pikken_game_players gp where gp.game_id = g.id order by gp.seat_index nulls last limit 1), 'Host') as host_name
    from public.pikken_games g
    where lower(coalesce(g.site_scope,'friends')) = lower(v_scope)
      and lower(coalesce(g.status,'')) in ('lobby','open','waiting')
      and coalesce(g.updated_at, g.created_at, now()) >= now() - interval '15 minutes'
    order by coalesce(g.updated_at, g.created_at, now()) desc
    limit greatest(1, least(coalesce(limit_input,30),50))
  ) x;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'items', v_rows, 'lobbies', v_rows);
end
$fn$;

create or replace function public.get_pikken_live_matches_fast_v687(
  site_scope_input text default 'friends',
  limit_input integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb := '[]'::jsonb;
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
begin
  if to_regclass('public.pikken_games') is null then
    return jsonb_build_object('ok', true, 'rows', '[]'::jsonb, 'items', '[]'::jsonb, 'matches', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc nulls last), '[]'::jsonb)
  into v_rows
  from (
    select
      g.id,
      g.id::text as game_id,
      g.lobby_code,
      g.lobby_code as code,
      coalesce(g.site_scope,'friends') as site_scope,
      coalesce(g.status,'live') as status,
      coalesce(g.state->>'phase', g.status, 'live') as phase,
      coalesce(nullif(g.state->>'round_no','')::integer, 0) as round_no,
      coalesce((select count(*) from public.pikken_game_players gp where gp.game_id = g.id and gp.eliminated_at is null), 0) as player_count,
      coalesce(g.updated_at, g.created_at, now()) as updated_at
    from public.pikken_games g
    where lower(coalesce(g.site_scope,'friends')) = lower(v_scope)
      and lower(coalesce(g.status,'')) in ('live','bidding','voting','active')
      and coalesce(g.updated_at, g.created_at, now()) >= now() - interval '15 minutes'
    order by coalesce(g.updated_at, g.created_at, now()) desc
    limit greatest(1, least(coalesce(limit_input,30),50))
  ) x;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'items', v_rows, 'matches', v_rows);
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
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
  v_code text;
  v_game_id uuid;
  v_start_dice integer := greatest(1, least(coalesce(nullif(config_input->>'start_dice','')::integer, 6), 10));
  v_name text;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  v_name := coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', 'Speler');

  update public.pikken_games
     set lobby_code = concat(coalesce(lobby_code,'DESPINOZA'), ' ARCHIVED ', left(id::text, 8)),
         status = case when lower(coalesce(status,'')) in ('lobby','open','waiting') then 'finished' else status end,
         finished_at = coalesce(finished_at, now()),
         updated_at = now(),
         state = coalesce(state,'{}'::jsonb) || jsonb_build_object('phase','archived','archived_reason','stale_or_finished_code_reuse')
   where upper(trim(coalesce(lobby_code,''))) like 'DESPINOZA %'
     and upper(trim(coalesce(lobby_code,''))) not like '% ARCHIVED %'
     and (
       lower(coalesce(status,'')) not in ('lobby','open','waiting','live','bidding','voting','active')
       or coalesce(updated_at, created_at, now()) < now() - interval '15 minutes'
     );

  v_code := public._pikken_next_despinoza_lobby_code_v725(v_scope);

  insert into public.pikken_games(lobby_code, site_scope, status, config, state, created_by_player_id, created_by_player_name, updated_at)
  values (v_code, v_scope, 'lobby', coalesce(config_input,'{}'::jsonb) || jsonb_build_object('start_dice', v_start_dice), jsonb_build_object('phase','lobby','round_no',0), p.id, v_name, now())
  returning id into v_game_id;

  insert into public.pikken_game_players(game_id, player_id, player_name, seat_index, ready, dice_count)
  values (v_game_id, p.id, v_name, 1, false, v_start_dice);

  return jsonb_build_object('ok', true, 'game_id', v_game_id, 'id', v_game_id, 'lobby_code', v_code, 'code', v_code);
end
$fn$;

create or replace function public.pikken_create_lobby_scoped(
  session_token text default null,
  session_token_input text default null,
  config_input jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.pikken_create_lobby_fast_v687(session_token, session_token_input, config_input, site_scope_input)
$fn$;

create or replace function public.pikken_join_lobby_fast_v687(
  session_token text default null,
  session_token_input text default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  g public.pikken_games%rowtype;
  v_seat integer;
  v_name text;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  v_name := coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', 'Speler');

  select * into g
  from public.pikken_games
  where upper(trim(coalesce(lobby_code,''))) = upper(trim(coalesce(lobby_code_input,'')))
    and lower(coalesce(site_scope,'friends')) = lower(coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends'))
    and lower(coalesce(status,'')) in ('lobby','open','waiting')
  order by updated_at desc nulls last
  limit 1
  for update;

  if g.id is null then raise exception 'Lobby niet gevonden.'; end if;

  update public.pikken_game_players
     set player_name = v_name,
         ready = false
   where game_id = g.id and player_id = p.id;

  if not found then
    select coalesce(max(seat_index),0) + 1 into v_seat from public.pikken_game_players where game_id = g.id;
    insert into public.pikken_game_players(game_id, player_id, player_name, seat_index, ready, dice_count)
    values (g.id, p.id, v_name, v_seat, false, greatest(1, least(coalesce(nullif(g.config->>'start_dice','')::integer, 6), 10)));
  end if;

  update public.pikken_games set updated_at = now(), state_version = coalesce(state_version,0)+1 where id = g.id;
  return jsonb_build_object('ok', true, 'game_id', g.id, 'id', g.id, 'lobby_code', g.lobby_code, 'code', g.lobby_code);
end
$fn$;

create or replace function public.pikken_join_lobby_scoped(
  session_token text default null,
  session_token_input text default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.pikken_join_lobby_fast_v687(session_token, session_token_input, lobby_code_input, site_scope_input)
$fn$;

create or replace function public._pikken_count_bid_hits(dice_input integer[], face_input integer)
returns integer
language sql
immutable
as $fn$
  select coalesce(sum(case
    when d = coalesce(face_input,0) then 1
    when d = 1 and coalesce(face_input,0) between 2 and 6 then 1
    else 0
  end),0)::integer
  from unnest(coalesce(dice_input, array[]::integer[])) as d
$fn$;

create or replace function public._pikken_round_no_v725(g public.pikken_games)
returns integer
language sql
stable
as $fn$
  select greatest(1, coalesce(nullif(coalesce(g.state,'{}'::jsonb)->>'round_no','')::integer, 1))
$fn$;

create or replace function public._pikken_next_alive_seat_v725(game_id_input uuid, after_seat_input integer)
returns integer
language sql
stable
as $fn$
  with alive as (
    select gp.seat_index
    from public.pikken_game_players gp
    where gp.game_id = game_id_input
      and gp.eliminated_at is null
      and coalesce(gp.dice_count,0) > 0
  )
  select coalesce(
    (select min(seat_index) from alive where seat_index > coalesce(after_seat_input,0)),
    (select min(seat_index) from alive),
    1
  )
$fn$;

create or replace function public._pikken_deal_round_v725(game_id_input uuid, round_no_input integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r record;
begin
  delete from public.pikken_round_hands
  where game_id = game_id_input
    and round_no = round_no_input;

  delete from public.pikken_round_votes
  where game_id = game_id_input
    and round_no = round_no_input;

  for r in
    select player_id, greatest(0, coalesce(dice_count,0)) as dice_count
    from public.pikken_game_players
    where game_id = game_id_input
      and eliminated_at is null
      and coalesce(dice_count,0) > 0
    order by seat_index nulls last
  loop
    insert into public.pikken_round_hands(game_id, round_no, player_id, dice_values, created_at)
    values (
      game_id_input,
      round_no_input,
      r.player_id,
      array(select (1 + floor(random() * 6))::integer from generate_series(1, r.dice_count)),
      now()
    );
  end loop;
end
$fn$;

create or replace function public.pikken_set_ready_scoped(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  ready_input boolean default false,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  g public.pikken_games%rowtype;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  select * into g from public.pikken_games where id = game_id_input and lower(coalesce(site_scope,'friends')) = lower(coalesce(site_scope_input,'friends')) for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;

  update public.pikken_game_players set ready = coalesce(ready_input,false) where game_id = g.id and player_id = p.id;
  if not found then raise exception 'Je zit niet in deze Pikken lobby.'; end if;
  update public.pikken_games set updated_at = now(), state_version = coalesce(state_version,0)+1 where id = g.id;
  return public._pikken_state_public_v725(g.id, null, null, coalesce(session_token_input, session_token), coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public.pikken_update_lobby_config_v715(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
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
  g public.pikken_games%rowtype;
  v_start_dice integer := greatest(1, least(coalesce(nullif(config_input->>'start_dice','')::integer, 6), 10));
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  select * into g from public.pikken_games where id = game_id_input and lower(coalesce(site_scope,'friends')) = lower(coalesce(site_scope_input,'friends')) for update;
  if g.id is null then raise exception 'Pikken lobby niet gevonden.'; end if;
  if g.created_by_player_id is distinct from p.id then raise exception 'Alleen de host mag de lobby instellingen wijzigen.'; end if;
  if lower(coalesce(g.status,'lobby')) not in ('lobby','open','waiting') then raise exception 'Deze Pikken match is al gestart.'; end if;

  update public.pikken_games set config = coalesce(config,'{}'::jsonb) || jsonb_build_object('start_dice', v_start_dice), updated_at = now(), state_version = coalesce(state_version,0)+1 where id = g.id;
  update public.pikken_game_players set dice_count = v_start_dice where game_id = g.id;
  return public._pikken_state_public_v725(g.id, null, null, coalesce(session_token_input, session_token), coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public.pikken_start_game_scoped(
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
  p public.players%rowtype;
  g public.pikken_games%rowtype;
  v_start_dice integer;
  v_players integer;
  v_ready integer;
  r record;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  select * into g from public.pikken_games where id = game_id_input and lower(coalesce(site_scope,'friends')) = lower(coalesce(site_scope_input,'friends')) for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;
  if g.created_by_player_id is distinct from p.id then raise exception 'Alleen de host mag starten.'; end if;
  if lower(coalesce(g.status,'')) not in ('lobby','open','waiting') then
    return public._pikken_state_public_v725(g.id, null, null, coalesce(session_token_input, session_token), coalesce(session_token_input, session_token), site_scope_input);
  end if;

  select count(*), count(*) filter (where coalesce(nullif(to_jsonb(gp)->>'ready','')::boolean, nullif(to_jsonb(gp)->>'is_ready','')::boolean, false))
  into v_players, v_ready
  from public.pikken_game_players gp
  where gp.game_id = g.id;
  if v_players < 2 then raise exception 'Pikken kan niet starten met minder dan 2 spelers.'; end if;
  if v_ready < v_players then raise exception 'Nog niet iedereen is ready.'; end if;

  v_start_dice := greatest(1, least(coalesce(nullif(g.config->>'start_dice','')::integer, 6), 10));
  delete from public.pikken_round_votes where game_id = g.id;

  for r in select player_id from public.pikken_game_players where game_id = g.id order by seat_index nulls last loop
    update public.pikken_game_players set dice_count = v_start_dice, eliminated_at = null, ready = true where game_id = g.id and player_id = r.player_id;
  end loop;

  perform public._pikken_deal_round_v725(g.id, 1);

  update public.pikken_games
     set status = 'live',
         state = jsonb_build_object('phase','bidding','round_no',1,'current_turn_seat',(select min(seat_index) from public.pikken_game_players where game_id = g.id),'bid',null,'started_at',now()),
         state_version = coalesce(state_version,0)+1,
         updated_at = now()
   where id = g.id;

  return public._pikken_state_public_v725(g.id, null, null, coalesce(session_token_input, session_token), coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public.pikken_place_bid_scoped(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  bid_count_input integer default null,
  bid_face_input integer default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  gp public.pikken_game_players%rowtype;
  g public.pikken_games%rowtype;
  v_old_bid jsonb;
  v_count integer := greatest(1, coalesce(bid_count_input,0));
  v_face integer := coalesce(bid_face_input,0);
begin
  if v_face not between 1 and 6 then raise exception 'Ongeldige biedwaarde.'; end if;
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  select * into g from public.pikken_games where id = game_id_input and lower(coalesce(site_scope,'friends')) = lower(coalesce(site_scope_input,'friends')) for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;
  select * into gp from public.pikken_game_players where game_id = g.id and player_id = p.id and eliminated_at is null and coalesce(dice_count,0) > 0;
  if gp.player_id is null then raise exception 'Je bent niet actief in deze Pikken match.'; end if;
  if coalesce(nullif(g.state->>'current_turn_seat','')::integer, gp.seat_index) <> gp.seat_index then raise exception 'Je bent niet aan de beurt.'; end if;
  v_old_bid := g.state->'bid';
  if v_old_bid is not null and (v_count < coalesce(nullif(v_old_bid->>'count','')::integer,0) or (v_count = coalesce(nullif(v_old_bid->>'count','')::integer,0) and v_face <= coalesce(nullif(v_old_bid->>'face','')::integer,0))) then
    raise exception 'Je bod moet hoger zijn dan het huidige bod.';
  end if;

  update public.pikken_games
     set status = 'bidding',
         state = coalesce(state,'{}'::jsonb) || jsonb_build_object(
           'phase','bidding',
           'round_no',public._pikken_round_no_v725(g),
           'current_turn_seat',public._pikken_next_alive_seat_v725(g.id, gp.seat_index),
           'bid',jsonb_build_object('count',v_count,'face',v_face,'bidder_id',p.id,'bidder_name',gp.player_name,'bidder_seat',gp.seat_index)
         ),
         state_version = coalesce(state_version,0)+1,
         updated_at = now()
   where id = g.id;

  return public._pikken_state_public_v725(g.id, null, null, coalesce(session_token_input, session_token), coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public._pikken_finish_vote_v725(game_id_input uuid, session_token_input text, site_scope_input text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  g public.pikken_games%rowtype;
  v_round integer;
  v_alive integer;
  v_votes integer;
  v_bid jsonb;
  v_count integer;
  v_face integer;
  v_total integer;
  v_bid_true boolean;
  v_bidder_id bigint;
  v_loser_id bigint;
  v_winner_id bigint;
  v_next integer;
begin
  select * into g from public.pikken_games where id = game_id_input for update;
  if g.id is null then return jsonb_build_object('ok', false, 'error', 'Pikken game niet gevonden.'); end if;
  v_round := public._pikken_round_no_v725(g);
  select count(*) into v_alive from public.pikken_game_players where game_id = g.id and eliminated_at is null and coalesce(dice_count,0) > 0;
  select count(*) into v_votes from public.pikken_round_votes where game_id = g.id and round_no = v_round;

  v_bid := g.state->'bid';
  if v_bid is null then return public._pikken_state_public_v725(g.id, null, null, session_token_input, session_token_input, site_scope_input); end if;
  v_bidder_id := nullif(v_bid->>'bidder_id','')::bigint;
  if v_votes < greatest(1, v_alive - 1) then return public._pikken_state_public_v725(g.id, null, null, session_token_input, session_token_input, site_scope_input); end if;
  v_count := coalesce(nullif(v_bid->>'count','')::integer,0);
  v_face := coalesce(nullif(v_bid->>'face','')::integer,0);
  select coalesce(sum(public._pikken_count_bid_hits(h.dice_values, v_face)),0) into v_total from public.pikken_round_hands h where h.game_id = g.id and h.round_no = v_round;
  v_bid_true := v_total >= v_count;
  v_loser_id := case when v_bid_true then nullif(g.state->>'challenger_id','')::bigint else v_bidder_id end;

  if v_loser_id is not null then
    update public.pikken_game_players
       set dice_count = greatest(0, coalesce(dice_count,0)-1),
           eliminated_at = case when greatest(0, coalesce(dice_count,0)-1) <= 0 then now() else eliminated_at end
     where game_id = g.id and player_id = v_loser_id;
  end if;

  select count(*) into v_alive from public.pikken_game_players where game_id = g.id and eliminated_at is null and coalesce(dice_count,0) > 0;
  if v_alive <= 1 then
    select player_id into v_winner_id from public.pikken_game_players where game_id = g.id and eliminated_at is null and coalesce(dice_count,0) > 0 order by dice_count desc, seat_index nulls last limit 1;
    update public.pikken_games
       set status = 'finished',
           finished_at = coalesce(finished_at, now()),
           state = coalesce(state,'{}'::jsonb) || jsonb_build_object('phase','finished','winner_id',v_winner_id,'last_reveal',jsonb_build_object('bid',v_bid,'bid_true',v_bid_true,'counted_total',v_total,'loser_id',v_loser_id),'bid',null),
           state_version = coalesce(state_version,0)+1,
           updated_at = now()
     where id = g.id;
    return public._pikken_state_public_v725(g.id, null, null, session_token_input, session_token_input, site_scope_input);
  end if;

  select coalesce((select seat_index from public.pikken_game_players where game_id = g.id and player_id = v_loser_id and eliminated_at is null), min(seat_index)) into v_next
  from public.pikken_game_players where game_id = g.id and eliminated_at is null and coalesce(dice_count,0) > 0;
  perform public._pikken_deal_round_v725(g.id, v_round + 1);
  update public.pikken_games
     set status = 'bidding',
         state = coalesce(state,'{}'::jsonb) || jsonb_build_object('phase','bidding','round_no',v_round + 1,'current_turn_seat',coalesce(v_next,1),'last_reveal',jsonb_build_object('bid',v_bid,'bid_true',v_bid_true,'counted_total',v_total,'loser_id',v_loser_id),'bid',null),
         state_version = coalesce(state_version,0)+1,
         updated_at = now()
   where id = g.id;
  return public._pikken_state_public_v725(g.id, null, null, session_token_input, session_token_input, site_scope_input);
end
$fn$;

create or replace function public.pikken_reject_bid_scoped(session_token text default null, session_token_input text default null, game_id_input uuid default null, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  gp public.pikken_game_players%rowtype;
  g public.pikken_games%rowtype;
  v_round integer;
  v_bid jsonb;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  select * into g from public.pikken_games where id = game_id_input and lower(coalesce(site_scope,'friends')) = lower(coalesce(site_scope_input,'friends')) for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;
  select * into gp from public.pikken_game_players where game_id = g.id and player_id = p.id and eliminated_at is null and coalesce(dice_count,0) > 0;
  if gp.player_id is null then raise exception 'Je bent niet actief in deze Pikken match.'; end if;
  v_bid := g.state->'bid';
  if v_bid is null then raise exception 'Er is nog geen bod om af te keuren.'; end if;
  if nullif(v_bid->>'bidder_id','')::bigint = p.id then raise exception 'Je mag je eigen bod niet afkeuren.'; end if;
  v_round := public._pikken_round_no_v725(g);
  delete from public.pikken_round_votes where game_id = g.id and round_no = v_round;
  insert into public.pikken_round_votes(game_id, round_no, player_id, vote) values (g.id, v_round, p.id, true);
  update public.pikken_games set status='voting', state=coalesce(state,'{}'::jsonb)||jsonb_build_object('phase','voting','round_no',v_round,'challenger_id',p.id,'challenger_name',gp.player_name,'challenger_seat',gp.seat_index), state_version=coalesce(state_version,0)+1, updated_at=now() where id=g.id;
  return public._pikken_finish_vote_v725(g.id, coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public.pikken_cast_vote_scoped(session_token text default null, session_token_input text default null, game_id_input uuid default null, vote_input boolean default null, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  gp public.pikken_game_players%rowtype;
  g public.pikken_games%rowtype;
  v_round integer;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  select * into g from public.pikken_games where id = game_id_input and lower(coalesce(site_scope,'friends')) = lower(coalesce(site_scope_input,'friends')) for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;
  select * into gp from public.pikken_game_players where game_id = g.id and player_id = p.id and eliminated_at is null and coalesce(dice_count,0) > 0;
  if gp.player_id is null then raise exception 'Je bent niet actief in deze Pikken match.'; end if;
  v_round := public._pikken_round_no_v725(g);
  if nullif((g.state->'bid')->>'bidder_id','')::bigint = p.id then raise exception 'Je mag niet stemmen op je eigen bod.'; end if;
  delete from public.pikken_round_votes where game_id = g.id and round_no = v_round and player_id = p.id;
  insert into public.pikken_round_votes(game_id, round_no, player_id, vote) values (g.id, v_round, p.id, coalesce(vote_input,false));
  return public._pikken_finish_vote_v725(g.id, coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public.pikken_find_my_active_game_scoped(
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
  p public.players%rowtype;
  g public.pikken_games%rowtype;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then
    return jsonb_build_object('ok', true, 'game', null, 'game_id', null);
  end if;

  select g.* into g
  from public.pikken_games g
  join public.pikken_game_players gp on gp.game_id = g.id and gp.player_id = p.id
  where lower(coalesce(g.site_scope,'friends')) = lower(coalesce(site_scope_input,'friends'))
    and lower(coalesce(g.status,'')) in ('lobby','open','waiting','live','bidding','voting','active')
    and coalesce(g.updated_at, g.created_at, now()) >= now() - interval '15 minutes'
  order by coalesce(g.updated_at, g.created_at, now()) desc
  limit 1;

  if g.id is null then
    return jsonb_build_object('ok', true, 'game', null, 'game_id', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'game_id', g.id,
    'id', g.id,
    'lobby_code', g.lobby_code,
    'code', g.lobby_code,
    'status', g.status,
    'phase', coalesce(g.state->>'phase', g.status)
  );
end
$fn$;

create or replace function public.pikken_destroy_game_fast_v687(
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
  p public.players%rowtype;
  g public.pikken_games%rowtype;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  select * into g from public.pikken_games where id = game_id_input and lower(coalesce(site_scope,'friends')) = lower(coalesce(site_scope_input,'friends')) for update;
  if g.id is null then return jsonb_build_object('ok', true, 'destroyed', true, 'already_missing', true); end if;
  if g.created_by_player_id is distinct from p.id then raise exception 'Alleen de host mag verwijderen.'; end if;

  update public.pikken_games set status='finished', finished_at=coalesce(finished_at, now()), state=coalesce(state,'{}'::jsonb)||jsonb_build_object('phase','deleted','deleted_reason','host_destroyed'), updated_at=now(), state_version=coalesce(state_version,0)+1 where id=g.id;
  return jsonb_build_object('ok', true, 'destroyed', true, 'game_id', game_id_input);
end
$fn$;

create or replace function public.pikken_leave_game_scoped(
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
  p public.players%rowtype;
  g public.pikken_games%rowtype;
  v_remaining integer;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
    and lower(coalesce(site_scope,'friends')) = lower(coalesce(site_scope_input,'friends'))
  for update;

  if g.id is null then
    return jsonb_build_object('ok', true, 'left', true, 'already_missing', true);
  end if;

  delete from public.pikken_game_players
  where game_id = g.id
    and player_id = p.id;

  select count(*) into v_remaining
  from public.pikken_game_players
  where game_id = g.id
    and eliminated_at is null;

  if v_remaining <= 1 then
    update public.pikken_games
       set status = 'finished',
           finished_at = coalesce(finished_at, now()),
           updated_at = now(),
           state_version = coalesce(state_version,0)+1,
           state = coalesce(state,'{}'::jsonb) || jsonb_build_object('phase','finished','finished_reason','player_left_not_enough_players')
     where id = g.id;
  else
    update public.pikken_games
       set updated_at = now(),
           state_version = coalesce(state_version,0)+1
     where id = g.id;
  end if;

  return jsonb_build_object('ok', true, 'left', true, 'game_id', g.id, 'remaining_players', v_remaining);
end
$fn$;

create or replace function public.cleanup_stale_pikken_rooms_v706(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
  v_count integer := 0;
begin
  update public.pikken_games
     set lobby_code = case
           when upper(trim(coalesce(lobby_code,''))) like 'DESPINOZA %'
             and upper(trim(coalesce(lobby_code,''))) not like '% ARCHIVED %'
             then concat(coalesce(lobby_code,'DESPINOZA'), ' ARCHIVED ', left(id::text, 8))
           else lobby_code
         end,
         status = 'finished',
         finished_at = coalesce(finished_at, now()),
         updated_at = now(),
         state_version = coalesce(state_version,0)+1,
         state = coalesce(state,'{}'::jsonb) || jsonb_build_object('phase','archived','archived_reason','stale_15_minutes')
   where lower(coalesce(site_scope,'friends')) = lower(v_scope)
     and lower(coalesce(status,'')) in ('lobby','open','waiting','live','bidding','voting','active')
     and coalesce(updated_at, created_at, now()) < now() - interval '15 minutes';

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'closed', v_count, 'archived', v_count);
end
$fn$;

create or replace function public.pikken_destroy_game_scoped(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.pikken_destroy_game_fast_v687(session_token, session_token_input, game_id_input, site_scope_input)
$fn$;

grant execute on function public._paardenrace_next_despinoza_room_code_v725() to anon, authenticated;
grant execute on function public.create_paardenrace_room_safe(text,text,text) to anon, authenticated;
grant execute on function public.create_paardenrace_room_fast_v687(text,text,text,text,text) to anon, authenticated;
grant execute on function public.get_paardenrace_room_state_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.get_paardenrace_room_state_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.join_paardenrace_room_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.leave_paardenrace_room_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.disband_paardenrace_room_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.set_paardenrace_ready_safe(text,text,text,boolean,text) to anon, authenticated;
grant execute on function public.start_paardenrace_room_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_countdown_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.get_paardenrace_open_rooms_fast_v687(text,integer) to anon, authenticated;
grant execute on function public.get_paardenrace_open_rooms_public(text,integer) to anon, authenticated;
grant execute on function public._pikken_state_public_v725(uuid,uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_get_state_scoped(text,text,uuid,text,text) to anon, authenticated;
grant execute on function public.pikken_get_state_scoped(text,text,uuid,uuid,text,text) to anon, authenticated;
grant execute on function public.pikken_get_live_state_public(uuid,uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_get_live_state_public(uuid,text,text) to anon, authenticated;
grant execute on function public._pikken_next_despinoza_lobby_code_v725(text) to anon, authenticated;
grant execute on function public.get_pikken_open_lobbies_fast_v687(text,integer) to anon, authenticated;
grant execute on function public.get_pikken_live_matches_fast_v687(text,integer) to anon, authenticated;
grant execute on function public.pikken_create_lobby_fast_v687(text,text,jsonb,text) to anon, authenticated;
grant execute on function public.pikken_create_lobby_scoped(text,text,jsonb,text) to anon, authenticated;
grant execute on function public.pikken_join_lobby_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_join_lobby_scoped(text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_set_ready_scoped(text,text,uuid,boolean,text) to anon, authenticated;
grant execute on function public.pikken_update_lobby_config_v715(text,text,uuid,jsonb,text) to anon, authenticated;
grant execute on function public.pikken_start_game_scoped(text,text,uuid,text) to anon, authenticated;
grant execute on function public._pikken_count_bid_hits(integer[],integer) to anon, authenticated;
grant execute on function public._pikken_next_alive_seat_v725(uuid,integer) to anon, authenticated;
grant execute on function public._pikken_deal_round_v725(uuid,integer) to anon, authenticated;
grant execute on function public._pikken_finish_vote_v725(uuid,text,text) to anon, authenticated;
grant execute on function public.pikken_place_bid_scoped(text,text,uuid,integer,integer,text) to anon, authenticated;
grant execute on function public.pikken_reject_bid_scoped(text,text,uuid,text) to anon, authenticated;
grant execute on function public.pikken_cast_vote_scoped(text,text,uuid,boolean,text) to anon, authenticated;
grant execute on function public.pikken_find_my_active_game_scoped(text,text,text) to anon, authenticated;
grant execute on function public.pikken_destroy_game_fast_v687(text,text,uuid,text) to anon, authenticated;
grant execute on function public.pikken_destroy_game_scoped(text,text,uuid,text) to anon, authenticated;
grant execute on function public.pikken_leave_game_scoped(text,text,uuid,text) to anon, authenticated;
grant execute on function public.cleanup_stale_pikken_rooms_v706(text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
