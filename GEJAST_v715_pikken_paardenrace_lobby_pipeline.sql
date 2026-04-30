-- GEJAST v715: Pikken in-lobby dice config + Paardenrace Despinoza room creation.
-- Run this whole file in Supabase SQL editor.

begin;

-- Pikken: host can choose start dice after lobby creation, before starting.
drop function if exists public.pikken_update_lobby_config_v715(text,text,uuid,jsonb,text);

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
  v_token text := coalesce(session_token_input, session_token);
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
  v_start_dice integer := greatest(1, least(coalesce(nullif(config_input->>'start_dice','')::integer, 6), 8));
  v_config jsonb := coalesce(config_input, '{}'::jsonb) || jsonb_build_object('start_dice', v_start_dice);
begin
  select * into p from public._gejast_player_from_session(v_token);
  if p.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
    and coalesce(site_scope,'friends') = v_scope
  for update;

  if g.id is null then
    raise exception 'Pikken lobby niet gevonden.';
  end if;
  if g.created_by_player_id is distinct from p.id then
    raise exception 'Alleen de host mag de lobby instellingen wijzigen.';
  end if;
  if lower(coalesce(g.status, g.state->>'phase', 'lobby')) not in ('lobby','open','waiting') then
    raise exception 'Deze Pikken match is al gestart.';
  end if;

  update public.pikken_games
     set config = coalesce(config,'{}'::jsonb) || v_config,
         state_version = coalesce(state_version,0) + 1,
         updated_at = now()
   where id = g.id;

  update public.pikken_game_players
     set dice_count = v_start_dice
   where game_id = g.id;

  return public.pikken_get_state_scoped(v_token, v_token, g.id, g.id, null, v_scope);
end
$fn$;

grant execute on function public.pikken_update_lobby_config_v715(text,text,uuid,jsonb,text) to anon, authenticated;

-- Paardenrace: standardized generated room names: Despinoza 1, Despinoza 2, ...
create or replace function public._paardenrace_next_despinoza_room_code_v715()
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
  v_code text := upper(trim(coalesce(room_code_input,'')));
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

  if v_code = '' then
    v_code := public._paardenrace_next_despinoza_room_code_v715();
  end if;

  loop
    v_attempts := v_attempts + 1;
    begin
      insert into public.paardenrace_rooms(room_code, host_player_id, host_name, stage, updated_at)
      values (v_code, v_player_id, v_name, 'lobby', now())
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_attempts > 6 then raise; end if;
      v_code := public._paardenrace_next_despinoza_room_code_v715();
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
begin
  return public.create_paardenrace_room_safe(
    session_token,
    session_token_input,
    coalesce(nullif(room_code_input,''), nullif(room_name_input,''))
  );
end
$fn$;

grant execute on function public._paardenrace_next_despinoza_room_code_v715() to anon, authenticated;
grant execute on function public.create_paardenrace_room_safe(text,text,text) to anon, authenticated;
grant execute on function public.create_paardenrace_room_fast_v687(text,text,text,text,text) to anon, authenticated;

commit;
