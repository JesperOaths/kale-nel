-- GEJAST v721 repair SQL
-- Fixes:
-- 1. Pikken state RPC exists with the exact argument names the current frontend sends.
-- 2. Paardenrace create RPC always allocates a unique Despinoza N room code and never inserts literal DESPINOZA.

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
        'get_paardenrace_room_state_fast_v687',
        'create_paardenrace_room_safe',
        'create_paardenrace_room_fast_v687'
      )
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

create or replace function public._paardenrace_next_despinoza_room_code_v721()
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
    v_code := public._paardenrace_next_despinoza_room_code_v721();
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
language sql
security definer
set search_path to 'public'
as $fn$
  select public.create_paardenrace_room_safe(session_token, session_token_input, null)
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
  select public.get_paardenrace_room_state_safe(session_token, session_token_input, room_code_input)
$fn$;

create or replace function public._pikken_state_public_v721(
  game_id_input uuid default null,
  game_id uuid default null,
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
  v_game_id uuid := coalesce(game_id_input, game_id, client_match_id);
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

  if v_game_id is not null then
    select * into g
    from public.pikken_games
    where id = v_game_id
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
      'start_total', (select coalesce(sum(coalesce(config->>'start_dice','6')::integer), 0) from public.pikken_games where id = g.id),
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
  game_id uuid default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public._pikken_state_public_v721(game_id_input, game_id, null, lobby_code_input, session_token, session_token_input, site_scope_input)
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
  select public._pikken_state_public_v721(game_id_input, null, client_match_id, lobby_code_input, session_token, session_token_input, site_scope_input)
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
  select public._pikken_state_public_v721(game_id_input, null, null, lobby_code_input, null, null, site_scope_input)
$fn$;

grant execute on function public._paardenrace_next_despinoza_room_code_v721() to anon, authenticated;
grant execute on function public.create_paardenrace_room_safe(text,text,text) to anon, authenticated;
grant execute on function public.create_paardenrace_room_fast_v687(text,text,text,text,text) to anon, authenticated;
grant execute on function public.get_paardenrace_room_state_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public._pikken_state_public_v721(uuid,uuid,uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_get_state_scoped(text,text,uuid,uuid,text,text) to anon, authenticated;
grant execute on function public.pikken_get_live_state_public(uuid,uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_get_live_state_public(uuid,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
