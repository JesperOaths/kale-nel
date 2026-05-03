-- GEJAST v725a SURGICAL RPC WRAPPER REPAIR
--
-- Purpose:
--   Repair current Supabase RPC lookup/overload errors without replacing the full
--   Pikken or Paardenrace gameplay pipelines.
--
-- Important:
--   Prefer this over GEJAST_v725_pikken_paardenrace_pipeline_contract.sql.
--   v725 was too broad. This file intentionally does less.
--
-- What this file does:
--   1. Removes ambiguous frontend-facing wrapper overloads for Paardenrace only.
--   2. Recreates one exact frontend-safe signature for the common Paardenrace calls.
--   3. Adds one Pikken state compatibility wrapper if the old build-state owner exists.
--   4. Does not rewrite bid/vote/draw/gameplay internals.
--
-- Run after the latest accepted production SQL (at least v716/v717 lineage).
-- This file is intentionally not wrapped in begin/commit so a late failure does not
-- undo earlier wrapper repairs.

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
        'get_paardenrace_room_state_safe',
        'get_paardenrace_room_state_fast_v687',
        'join_paardenrace_room_fast_v687',
        'set_paardenrace_ready_safe',
        'start_paardenrace_room_safe',
        'start_paardenrace_countdown_safe',
        'pikken_get_state_scoped'
      )
  loop
    execute format('drop function if exists %I.%I(%s)', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

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
  if to_regprocedure('public._paardenrace_build_room_state(text,text,text)') is null then
    raise exception 'paardenrace_backend_missing';
  end if;

  return public._paardenrace_build_room_state(room_code_input, session_token, session_token_input);
end
$fn$;

create or replace function public.get_paardenrace_room_state_fast_v687(
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
  select public.get_paardenrace_room_state_safe(room_code_input, session_token, session_token_input, site_scope_input)
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
  v_name text;
  v_player_id bigint;
  v_room public.paardenrace_rooms%rowtype;
begin
  if to_regprocedure('public._paardenrace_require_name(text,text)') is null
     or to_regprocedure('public._paardenrace_player_id(text,text)') is null
     or to_regprocedure('public._paardenrace_upsert_player(bigint,text,bigint)') is null
     or to_regprocedure('public._paardenrace_build_room_state(text,text,text)') is null then
    raise exception 'paardenrace_backend_missing';
  end if;

  v_name := public._paardenrace_require_name(session_token, session_token_input);
  v_player_id := public._paardenrace_player_id(session_token, session_token_input);

  select * into v_room
  from public.paardenrace_rooms
  where upper(trim(coalesce(room_code,''))) = upper(trim(coalesce(room_code_input,'')))
    and coalesce(stage,'lobby') not in ('closed','deleted','archived')
    and coalesce(updated_at, created_at, now()) > now() - interval '15 minutes'
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

create or replace function public.set_paardenrace_ready_safe(
  room_code_input text default null,
  ready_input boolean default false,
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
  v_name text;
  v_room public.paardenrace_rooms%rowtype;
begin
  if to_regprocedure('public._paardenrace_require_name(text,text)') is null
     or to_regprocedure('public._paardenrace_build_room_state(text,text,text)') is null then
    raise exception 'paardenrace_backend_missing';
  end if;

  v_name := public._paardenrace_require_name(session_token, session_token_input);

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

  update public.paardenrace_room_players
     set is_ready = coalesce(ready_input,false),
         updated_at = now()
   where room_id = v_room.id
     and lower(coalesce(player_name,'')) = lower(coalesce(v_name,''));

  if not found then
    raise exception 'Je zit niet in deze room.';
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
  v_name text;
  v_room public.paardenrace_rooms%rowtype;
  v_player_count integer := 0;
  v_ready_count integer := 0;
  v_suit_count integer := 0;
begin
  if to_regprocedure('public._paardenrace_require_name(text,text)') is null
     or to_regprocedure('public._paardenrace_build_room_state(text,text,text)') is null then
    raise exception 'paardenrace_backend_missing';
  end if;

  v_name := public._paardenrace_require_name(session_token, session_token_input);

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
  if v_ready_count < v_player_count then raise exception 'Nog niet iedereen is ready.'; end if;
  if v_suit_count < 2 then raise exception 'Paardenrace heeft minstens 2 verschillende paarden nodig.'; end if;

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

create or replace function public.pikken_get_state_scoped(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_game_id uuid := game_id_input;
begin
  if v_game_id is null and nullif(trim(coalesce(lobby_code_input,'')),'') is not null then
    select g.id into v_game_id
    from public.pikken_games g
    where upper(trim(coalesce(g.lobby_code,''))) = upper(trim(lobby_code_input))
      and coalesce(g.site_scope,'friends') = coalesce(nullif(trim(coalesce(site_scope_input,'')),''),'friends')
      and lower(coalesce(g.status, g.state->>'phase','')) not in ('deleted','closed','abandoned')
    order by updated_at desc nulls last, created_at desc nulls last
    limit 1;
  end if;

  if to_regprocedure('public._pikken_build_state_v695(uuid,text,text)') is not null then
    return public._pikken_build_state_v695(v_game_id, coalesce(session_token_input, session_token), site_scope_input);
  end if;

  raise exception 'pikken_state_backend_missing';
end
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
  select public.pikken_get_state_scoped(session_token, session_token_input, coalesce(game_id_input, game_id), lobby_code_input, site_scope_input)
$fn$;

grant execute on function public.get_paardenrace_room_state_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.get_paardenrace_room_state_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.join_paardenrace_room_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.set_paardenrace_ready_safe(text,boolean,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_room_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_countdown_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_get_state_scoped(text,text,uuid,text,text) to anon, authenticated;
grant execute on function public.pikken_get_state_scoped(text,text,uuid,uuid,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
