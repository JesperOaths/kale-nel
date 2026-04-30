-- GEJAST v717: forced Despinoza lobby names, Paardenrace start validation, Caute Coins top 5 baseline.
-- Run this whole file in Supabase SQL editor after v716.

begin;

create or replace function public._paardenrace_next_despinoza_room_code_v717()
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
        and coalesce(r.stage,'lobby') not in ('closed','deleted','archived')
        and coalesce(r.updated_at, r.created_at, now()) > now() - interval '15 minutes'
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

-- Paardenrace creation no longer accepts user-named lobbies. It always allocates Despinoza N.
drop function if exists public.create_paardenrace_room_fast_v687(text,text,text,text,text);
drop function if exists public.create_paardenrace_room_safe(text,text,text);

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
  v_code text := public._paardenrace_next_despinoza_room_code_v717();
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
    begin
      insert into public.paardenrace_rooms(room_code, host_player_id, host_name, stage, updated_at)
      values (v_code, v_player_id, v_name, 'lobby', now())
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_attempts > 6 then raise; end if;
      v_code := public._paardenrace_next_despinoza_room_code_v717();
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

-- Paardenrace start must have at least two players and at least two selected suits.
drop function if exists public.start_paardenrace_room_safe(text,text,text,text);

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

-- Caute Coins top 5: active players should default to 100 coins when no wallet ledger exists yet.
create or replace function public.get_caute_coin_top5_public(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb := '[]'::jsonb;
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
begin
  if to_regclass('public.despimarkt_caute_balance_view') is not null then
    execute $sql$
      select coalesce(jsonb_agg(jsonb_build_object('player_name', player_name, 'display_name', player_name, 'balance', greatest(100, coalesce(balance_cautes,0)), 'coins', greatest(100, coalesce(balance_cautes,0)), 'caute_coins', greatest(100, coalesce(balance_cautes,0))) order by greatest(100, coalesce(balance_cautes,0)) desc, lower(player_name)), '[]'::jsonb)
      from (
        select player_name, balance_cautes
        from public.despimarkt_caute_balance_view
        where coalesce(nullif(site_scope,''), 'friends') = $1
        order by greatest(100, coalesce(balance_cautes,0)) desc, lower(player_name)
        limit 5
      ) b
    $sql$ into v_rows using v_scope;
  end if;

  if jsonb_array_length(coalesce(v_rows,'[]'::jsonb)) = 0 and to_regprocedure('public._gejast_active_profile_rows_v693(text,integer)') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('player_name', x->>'display_name', 'display_name', x->>'display_name', 'balance', 100, 'coins', 100, 'caute_coins', 100) order by lower(x->>'display_name')), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(public._gejast_active_profile_rows_v693(v_scope, 5)) x;
  end if;

  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb), 'leaderboard', coalesce(v_rows, '[]'::jsonb));
end
$fn$;

grant execute on function public.create_paardenrace_room_safe(text,text,text) to anon, authenticated;
grant execute on function public._paardenrace_next_despinoza_room_code_v717() to anon, authenticated;
grant execute on function public.create_paardenrace_room_fast_v687(text,text,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_room_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_countdown_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.get_caute_coin_top5_public(text) to anon, authenticated;

commit;
