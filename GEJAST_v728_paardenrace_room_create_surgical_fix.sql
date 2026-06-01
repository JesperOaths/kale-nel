-- GEJAST v728 Paardenrace room-create surgical fix
--
-- Purpose:
--   Repair the deployed Paardenrace create RPC when it repeatedly collides with
--   paardenrace_rooms_room_code_key even though no open rooms are visible.
--
-- What this changes:
--   - Uses caller supplied room_code_input when present.
--   - Otherwise reserves the first DESPINOZA N code that is absent from the full
--     paardenrace_rooms table, including closed/archived rooms.
--   - Retries on unique_violation with the next candidate instead of reusing the
--     same stale candidate.
--   - Leaves join/start/draw/gameplay internals untouched.

create or replace function public._paardenrace_next_despinoza_room_code_v728()
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
  v_requested text := upper(trim(coalesce(room_code_input,'')));
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

  if v_requested <> '' then
    if exists (
      select 1 from public.paardenrace_rooms r
      where upper(trim(coalesce(r.room_code,''))) = v_requested
    ) then
      raise exception 'Roomcode bestaat al.';
    end if;
    v_code := v_requested;
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_code is null then
      v_code := public._paardenrace_next_despinoza_room_code_v728();
    end if;
    begin
      insert into public.paardenrace_rooms(room_code, host_player_id, host_name, stage, updated_at)
      values (v_code, v_player_id, v_name, 'lobby', now())
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_requested <> '' then
        raise exception 'Roomcode bestaat al.';
      end if;
      if v_attempts >= 40 then
        raise exception 'Kon geen vrije Despinoza-roomcode reserveren.';
      end if;
      v_code := null;
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
  return public.create_paardenrace_room_safe(session_token, session_token_input, room_code_input);
end
$fn$;

grant execute on function public._paardenrace_next_despinoza_room_code_v728() to anon, authenticated;
grant execute on function public.create_paardenrace_room_safe(text,text,text) to anon, authenticated;
grant execute on function public.create_paardenrace_room_fast_v687(text,text,text,text,text) to anon, authenticated;
