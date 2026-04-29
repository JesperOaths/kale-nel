-- GEJAST v695: Pikken dice/lobbies, Paardenrace conflict fix, Paardenrace Bakken -> drink verification, Beurs wallet default.
-- Run after v694. This patch avoids fake admin no-ops and only touches public game/runtime repair paths.

begin;

create extension if not exists pgcrypto;

create or replace function public._gejast_scope_norm_v695(site_scope_input text default 'friends')
returns text language sql stable as $fn$
  select case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end
$fn$;

create or replace function public._paardenrace_upsert_player(
  room_id_input bigint,
  player_name_input text,
  player_id_input bigint
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  update public.paardenrace_room_players
     set player_id = coalesce(player_id_input, player_id),
         updated_at = now()
   where room_id = room_id_input
     and lower(coalesce(player_name,'')) = lower(coalesce(player_name_input,''));

  if found then
    return;
  end if;

  begin
    insert into public.paardenrace_room_players(room_id, player_id, player_name)
    values (room_id_input, player_id_input, player_name_input);
  exception when unique_violation then
    update public.paardenrace_room_players
       set player_id = coalesce(player_id_input, player_id),
           updated_at = now()
     where room_id = room_id_input
       and lower(coalesce(player_name,'')) = lower(coalesce(player_name_input,''));
  end;
end
$fn$;

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
        'get_pikken_open_lobbies_fast_v687',
        'pikken_create_lobby_fast_v687',
        'pikken_join_lobby_fast_v687',
        'pikken_destroy_game_fast_v687',
        'pikken_get_state_scoped',
        'pikken_start_game_scoped'
      )
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

create or replace function public._pikken_random_lobby_code_v695()
returns text
language sql
volatile
as $fn$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
$fn$;

create or replace function public._pikken_build_state_v695(
  game_id_input uuid,
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
  v_scope text := public._gejast_scope_norm_v695(site_scope_input);
  v_round integer := 1;
  v_players jsonb := '[]'::jsonb;
  v_votes jsonb := '[]'::jsonb;
  v_my_hand integer[] := array[]::integer[];
  v_viewer jsonb := '{}'::jsonb;
  r record;
begin
  if session_token_input is not null and btrim(session_token_input) <> '' and to_regprocedure('public._gejast_player_from_session(text)') is not null then
    select * into p from public._gejast_player_from_session(session_token_input);
  end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
    and public._gejast_scope_norm_v695(site_scope) = v_scope
  limit 1;

  if g.id is null then
    raise exception 'Pikken game niet gevonden.';
  end if;

  v_round := greatest(1, coalesce(nullif(coalesce(g.state,'{}'::jsonb)->>'round_no','')::integer, 1));

  for r in
    select gp.*
    from public.pikken_game_players gp
    where gp.game_id = g.id
    order by gp.seat_index nulls last, gp.player_name
  loop
    v_players := v_players || jsonb_build_array(jsonb_build_object(
      'player_id', r.player_id,
      'seat', r.seat_index,
      'seat_index', r.seat_index,
      'name', r.player_name,
      'player_name', r.player_name,
      'is_host', r.player_id is not distinct from g.created_by_player_id,
      'is_ready', coalesce(r.ready,false),
      'ready', coalesce(r.ready,false),
      'dice_count', coalesce(r.dice_count, 0),
      'alive', r.eliminated_at is null
    ));

    if p.id is not null and r.player_id is not distinct from p.id then
      select coalesce(h.dice_values, array[]::integer[]) into v_my_hand
      from public.pikken_round_hands h
      where h.game_id = g.id
        and h.round_no = v_round
        and h.player_id = p.id
      order by h.created_at desc nulls last
      limit 1;

      v_viewer := jsonb_build_object(
        'player_id', r.player_id,
        'seat', r.seat_index,
        'seat_index', r.seat_index,
        'player_name', r.player_name,
        'name', r.player_name,
        'is_host', r.player_id is not distinct from g.created_by_player_id,
        'is_ready', coalesce(r.ready,false),
        'ready', coalesce(r.ready,false),
        'alive', r.eliminated_at is null,
        'my_hand', coalesce(to_jsonb(v_my_hand), '[]'::jsonb)
      );
    end if;
  end loop;

  for r in
    select gp.seat_index, gp.player_name, v.vote
    from public.pikken_game_players gp
    left join public.pikken_round_votes v
      on v.game_id = gp.game_id
     and v.round_no = v_round
     and v.player_id = gp.player_id
    where gp.game_id = g.id
    order by gp.seat_index nulls last
  loop
    v_votes := v_votes || jsonb_build_array(jsonb_build_object(
      'seat', r.seat_index,
      'seat_index', r.seat_index,
      'name', r.player_name,
      'player_name', r.player_name,
      'status', case when r.vote is true then 'approved' when r.vote is false then 'rejected' else 'waiting' end
    ));
  end loop;

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
      'state_version', g.state_version,
      'updated_at', g.updated_at,
      'finished_at', g.finished_at
    ),
    'players', v_players,
    'viewer', v_viewer,
    'my_hand', coalesce(to_jsonb(v_my_hand), '[]'::jsonb),
    'hands', case when lower(coalesce(g.status,'')) in ('finished','reveal') or lower(coalesce(g.state->>'phase','')) in ('reveal','finished')
      then coalesce((
        select jsonb_agg(jsonb_build_object('seat', gp.seat_index, 'player_name', gp.player_name, 'dice', h.dice_values) order by gp.seat_index)
        from public.pikken_round_hands h
        join public.pikken_game_players gp on gp.game_id = h.game_id and gp.player_id = h.player_id
        where h.game_id = g.id and h.round_no = v_round
      ), '[]'::jsonb)
      else '[]'::jsonb end,
    'votes', v_votes,
    'dice_totals', jsonb_build_object(
      'start_total', greatest(
        coalesce((
          select sum(coalesce(array_length(h.dice_values, 1), 0))
          from public.pikken_round_hands h
          where h.game_id = g.id and h.round_no = 1
        ), 0),
        coalesce((select count(*) * 6 from public.pikken_game_players gp where gp.game_id = g.id), 0)
      ),
      'current_total', coalesce((select sum(coalesce(gp.dice_count,0)) from public.pikken_game_players gp where gp.game_id = g.id and gp.eliminated_at is null), 0),
      'lost_total', greatest(
        greatest(
          coalesce((
            select sum(coalesce(array_length(h.dice_values, 1), 0))
            from public.pikken_round_hands h
            where h.game_id = g.id and h.round_no = 1
          ), 0),
          coalesce((select count(*) * 6 from public.pikken_game_players gp where gp.game_id = g.id), 0)
        ) - coalesce((select sum(coalesce(gp.dice_count,0)) from public.pikken_game_players gp where gp.game_id = g.id and gp.eliminated_at is null), 0),
        0
      )
    )
  );
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
  v_scope text := public._gejast_scope_norm_v695(site_scope_input);
begin
  if to_regclass('public.pikken_games') is null then
    return jsonb_build_object('ok', true, 'lobbies', '[]'::jsonb, 'items', '[]'::jsonb, 'rows', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc nulls last), '[]'::jsonb)
  into v_rows
  from (
    select
      g.id,
      g.id::text as game_id,
      g.lobby_code,
      g.lobby_code as code,
      g.site_scope,
      g.status,
      coalesce(g.updated_at, g.created_at, now()) as updated_at,
      coalesce((select count(*) from public.pikken_game_players gp where gp.game_id = g.id), 0) as player_count,
      coalesce((select count(*) from public.pikken_game_players gp where gp.game_id = g.id and coalesce(gp.ready,false)), 0) as ready_count,
      coalesce(g.created_by_player_name, (select gp.player_name from public.pikken_game_players gp where gp.game_id = g.id order by gp.seat_index nulls last limit 1), 'Host') as host_name
    from public.pikken_games g
    where public._gejast_scope_norm_v695(g.site_scope) = v_scope
      and lower(coalesce(g.status,'')) in ('lobby','open','waiting')
      and coalesce(g.updated_at, g.created_at, now()) >= now() - interval '12 hours'
    order by coalesce(g.updated_at, g.created_at, now()) desc
    limit greatest(1, least(coalesce(limit_input,30),50))
  ) x;

  return jsonb_build_object('ok', true, 'lobbies', v_rows, 'items', v_rows, 'rows', v_rows);
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
  v_scope text := public._gejast_scope_norm_v695(site_scope_input);
  v_code text;
  v_game_id uuid;
  v_start_dice integer := greatest(1, least(coalesce((config_input->>'start_dice')::integer, 6), 10));
  i integer := 0;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  loop
    i := i + 1;
    v_code := public._pikken_random_lobby_code_v695();
    begin
      insert into public.pikken_games(lobby_code, site_scope, status, config, state, created_by_player_id, created_by_player_name, updated_at)
      values (v_code, v_scope, 'lobby', coalesce(config_input,'{}'::jsonb), jsonb_build_object('phase','lobby','round_no',0), p.id, coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', 'Speler'), now())
      returning id into v_game_id;
      exit;
    exception when unique_violation then
      if i > 8 then raise; end if;
    end;
  end loop;

  insert into public.pikken_game_players(game_id, player_id, player_name, seat_index, ready, dice_count)
  values (v_game_id, p.id, coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', 'Speler'), 1, false, v_start_dice);

  return jsonb_build_object('ok', true, 'game_id', v_game_id, 'id', v_game_id, 'lobby_code', v_code, 'code', v_code);
end
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
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  select * into g
  from public.pikken_games
  where upper(coalesce(lobby_code,'')) = upper(trim(coalesce(lobby_code_input,'')))
    and public._gejast_scope_norm_v695(site_scope) = public._gejast_scope_norm_v695(site_scope_input)
    and lower(coalesce(status,'')) in ('lobby','open','waiting')
  order by updated_at desc nulls last
  limit 1
  for update;

  if g.id is null then raise exception 'Lobby niet gevonden.'; end if;

  update public.pikken_game_players
     set player_name = coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', player_name),
         ready = false
   where game_id = g.id and player_id = p.id;

  if not found then
    select coalesce(max(seat_index),0) + 1 into v_seat
    from public.pikken_game_players
    where game_id = g.id;

    insert into public.pikken_game_players(game_id, player_id, player_name, seat_index, ready, dice_count)
    values (g.id, p.id, coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', 'Speler'), v_seat, false, greatest(1, least(coalesce((g.config->>'start_dice')::integer, 6), 10)));
  end if;

  update public.pikken_games
     set updated_at = now(),
         state_version = coalesce(state_version,0) + 1
   where id = g.id;

  return jsonb_build_object('ok', true, 'game_id', g.id, 'id', g.id, 'lobby_code', g.lobby_code, 'code', g.lobby_code);
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
  r record;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
    and public._gejast_scope_norm_v695(site_scope) = public._gejast_scope_norm_v695(site_scope_input)
  for update;

  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;
  if g.created_by_player_id is distinct from p.id then raise exception 'Alleen de host mag starten.'; end if;
  if lower(coalesce(g.status,'')) not in ('lobby','open','waiting') then return public._pikken_build_state_v695(g.id, coalesce(session_token_input,session_token), site_scope_input); end if;

  v_start_dice := greatest(1, least(coalesce((g.config->>'start_dice')::integer, 6), 10));

  delete from public.pikken_round_hands where game_id = g.id and round_no = 1;

  for r in
    select gp.player_id
    from public.pikken_game_players gp
    where gp.game_id = g.id
    order by gp.seat_index nulls last
  loop
    update public.pikken_game_players
       set dice_count = v_start_dice,
           eliminated_at = null,
           ready = true
     where game_id = g.id and player_id = r.player_id;

    insert into public.pikken_round_hands(game_id, round_no, player_id, dice_values, created_at)
    values (
      g.id,
      1,
      r.player_id,
      array(select (1 + floor(random() * 6))::integer from generate_series(1, v_start_dice)),
      now()
    );
  end loop;

  update public.pikken_games
     set status = 'live',
         state = jsonb_build_object(
           'phase','bidding',
           'round_no',1,
           'current_turn_seat',(select min(seat_index) from public.pikken_game_players where game_id = g.id),
           'bid', null,
           'started_at', now()
         ),
         state_version = coalesce(state_version,0) + 1,
         updated_at = now()
   where id = g.id;

  return public._pikken_build_state_v695(g.id, coalesce(session_token_input,session_token), site_scope_input);
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
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_game_id uuid := coalesce(game_id_input, game_id);
begin
  if v_game_id is null and nullif(trim(coalesce(lobby_code_input,'')),'') is not null then
    select g.id into v_game_id
    from public.pikken_games g
    where upper(coalesce(g.lobby_code,'')) = upper(trim(lobby_code_input))
      and public._gejast_scope_norm_v695(g.site_scope) = public._gejast_scope_norm_v695(site_scope_input)
    order by g.updated_at desc nulls last
    limit 1;
  end if;
  return public._pikken_build_state_v695(v_game_id, coalesce(session_token_input,session_token), site_scope_input);
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

  select * into g
  from public.pikken_games
  where id = game_id_input
    and public._gejast_scope_norm_v695(site_scope) = public._gejast_scope_norm_v695(site_scope_input)
  for update;

  if g.id is null then return jsonb_build_object('ok', true, 'destroyed', true, 'already_missing', true); end if;
  if g.created_by_player_id is distinct from p.id then raise exception 'Alleen de host mag verwijderen.'; end if;

  delete from public.pikken_round_votes where game_id = g.id;
  delete from public.pikken_round_hands where game_id = g.id;
  delete from public.pikken_game_players where game_id = g.id;
  delete from public.pikken_games where id = g.id;

  return jsonb_build_object('ok', true, 'destroyed', true, 'game_id', game_id_input);
end
$fn$;

create or replace function public._gejast_create_bak_drink_request_v695(
  player_name_input text,
  amount_input numeric,
  source_kind_input text default 'paardenrace',
  source_ref_input text default null,
  metadata_input jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_cols text[] := array[]::text[];
  v_vals text[] := array[]::text[];
  v_sql text;
  v_id bigint;
  v_amount numeric := greatest(1, coalesce(amount_input, 1));
  v_player_id bigint;
  v_event_type_id bigint;
  v_event_type_label text := 'Bak';
  v_unit_value numeric := 1;
begin
  if to_regclass('public.drink_events') is null then return null; end if;

  begin
    execute 'select id from public.players where lower(coalesce(display_name,name,email,'''')) = lower($1) limit 1'
      into v_player_id using player_name_input;
  exception when others then
    v_player_id := null;
  end;

  begin
    select id, coalesce(label, key, 'Bak'), coalesce(unit_value, 1)
      into v_event_type_id, v_event_type_label, v_unit_value
    from public.drink_event_types
    where lower(key) in ('bak','bakken','beer','bier')
    order by case lower(key) when 'bak' then 1 when 'bakken' then 2 when 'bier' then 3 else 4 end
    limit 1;
  exception when others then
    v_event_type_id := null;
    v_event_type_label := 'Bak';
    v_unit_value := 1;
  end;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='player_id') and v_player_id is not null then
    v_cols := array_append(v_cols, 'player_id'); v_vals := array_append(v_vals, v_player_id::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='player_name') then
    v_cols := array_append(v_cols, 'player_name'); v_vals := array_append(v_vals, quote_literal(player_name_input));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='event_type_id') and v_event_type_id is not null then
    v_cols := array_append(v_cols, 'event_type_id'); v_vals := array_append(v_vals, v_event_type_id::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='event_type_key') then
    v_cols := array_append(v_cols, 'event_type_key'); v_vals := array_append(v_vals, quote_literal('bak'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='event_type_label') then
    v_cols := array_append(v_cols, 'event_type_label'); v_vals := array_append(v_vals, quote_literal(v_event_type_label));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='quantity') then
    v_cols := array_append(v_cols, 'quantity'); v_vals := array_append(v_vals, v_amount::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='total_units') then
    v_cols := array_append(v_cols, 'total_units'); v_vals := array_append(v_vals, round(v_unit_value * v_amount, 2)::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='status') then
    v_cols := array_append(v_cols, 'status'); v_vals := array_append(v_vals, quote_literal('pending'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='source_kind') then
    v_cols := array_append(v_cols, 'source_kind'); v_vals := array_append(v_vals, quote_literal(source_kind_input));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='metadata') then
    v_cols := array_append(v_cols, 'metadata'); v_vals := array_append(v_vals, quote_literal(coalesce(metadata_input,'{}'::jsonb)::text) || '::jsonb');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='created_at') then
    v_cols := array_append(v_cols, 'created_at'); v_vals := array_append(v_vals, 'now()');
  end if;

  if array_length(v_cols,1) is null then return null; end if;

  v_sql := format('insert into public.drink_events (%s) values (%s) returning id', array_to_string(v_cols, ', '), array_to_string(v_vals, ', '));
  execute v_sql into v_id;
  return v_id;
exception when unique_violation then
  return null;
end
$fn$;

create or replace function public._gejast_paardenrace_obligation_drink_trigger_v695()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if coalesce(new.amount_bakken,0) > 0 then
    perform public._gejast_create_bak_drink_request_v695(
      new.player_name,
      new.amount_bakken,
      coalesce(new.source_kind,'paardenrace'),
      'paardenrace:' || coalesce(new.match_ref::text, new.room_id::text) || ':' || new.id::text,
      coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('source_game','paardenrace','obligation_id',new.id,'room_id',new.room_id,'match_ref',new.match_ref)
    );
  end if;
  return new;
end
$fn$;

drop trigger if exists gejast_paardenrace_obligation_drink_v695 on public.paardenrace_obligations;
create trigger gejast_paardenrace_obligation_drink_v695
after insert on public.paardenrace_obligations
for each row execute function public._gejast_paardenrace_obligation_drink_trigger_v695();

do $coins$
begin
  if to_regclass('public.despimarkt_wallets') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='despimarkt_wallets' and column_name='balance') then
    execute 'update public.despimarkt_wallets set balance = 100 where balance = 1000 and not exists (select 1 from public.despimarkt_ledger l where l.player_id = despimarkt_wallets.player_id)';
  end if;
exception when others then
  null;
end
$coins$;

grant execute on function public.get_pikken_open_lobbies_fast_v687(text,integer) to anon, authenticated;
grant execute on function public.pikken_create_lobby_fast_v687(text,text,jsonb,text) to anon, authenticated;
grant execute on function public.pikken_join_lobby_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_start_game_scoped(text,text,uuid,text) to anon, authenticated;
grant execute on function public.pikken_get_state_scoped(text,text,uuid,uuid,text,text) to anon, authenticated;
grant execute on function public.pikken_destroy_game_fast_v687(text,text,uuid,text) to anon, authenticated;
grant execute on function public._gejast_create_bak_drink_request_v695(text,numeric,text,text,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
