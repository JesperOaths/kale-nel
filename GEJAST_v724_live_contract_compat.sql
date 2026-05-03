-- GEJAST v724 live contract compatibility SQL
-- Fixes:
-- 1. Removes ambiguous Paardenrace fast-wrapper overloads and recreates one frontend-safe signature each.
-- 2. Removes Pikken's duplicate game_id state argument so Postgres cannot confuse the parameter with columns.
-- 3. Keeps Despinoza N lobby allocation and ready-field compatibility.

begin;

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
        '_pikken_state_public_v720',
        '_pikken_state_public_v721',
        '_pikken_state_public_v722',
        '_pikken_state_public_v723',
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

create or replace function public._paardenrace_next_despinoza_room_code_v724()
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
    v_code := public._paardenrace_next_despinoza_room_code_v724();
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
    v_code := public._paardenrace_next_despinoza_room_code_v724();
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

create or replace function public._pikken_state_public_v724(
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
  select public._pikken_state_public_v724(game_id_input, null, lobby_code_input, session_token, session_token_input, site_scope_input)
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
  select public._pikken_state_public_v724(coalesce(game_id_input, game_id), null, lobby_code_input, session_token, session_token_input, site_scope_input)
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
  select public._pikken_state_public_v724(game_id_input, client_match_id, lobby_code_input, session_token, session_token_input, site_scope_input)
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
  select public._pikken_state_public_v724(game_id_input, null, lobby_code_input, null, null, site_scope_input)
$fn$;

grant execute on function public._paardenrace_next_despinoza_room_code_v724() to anon, authenticated;
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
grant execute on function public._pikken_state_public_v724(uuid,uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_get_state_scoped(text,text,uuid,text,text) to anon, authenticated;
grant execute on function public.pikken_get_state_scoped(text,text,uuid,uuid,text,text) to anon, authenticated;
grant execute on function public.pikken_get_live_state_public(uuid,uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_get_live_state_public(uuid,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
