-- GEJAST v698: hard-delete Paardenrace rooms and restore Pikken live-state alias.

begin;

create extension if not exists pgcrypto;

create or replace function public._gejast_scope_norm_v698(site_scope_input text default 'friends')
returns text
language sql
stable
as $fn$
  select case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end
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
        'disband_paardenrace_room_fast_v687',
        'disband_paardenrace_room_safe',
        'destroy_paardenrace_room_safe',
        'close_paardenrace_room_safe',
        'pikken_get_live_state_public'
      )
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

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
  v_code text := upper(trim(coalesce(room_code_input, '')));
  v_scope text := public._gejast_scope_norm_v698(site_scope_input);
  v_room_id bigint;
  v_deleted integer := 0;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'destroyed', false, 'message', 'room_code ontbreekt');
  end if;

  select r.id into v_room_id
  from public.paardenrace_rooms r
  where upper(trim(coalesce(r.room_code, ''))) = v_code
  order by r.updated_at desc nulls last, r.id desc
  limit 1;

  if v_room_id is null then
    return jsonb_build_object('ok', true, 'destroyed', false, 'room_code', v_code, 'message', 'Room was al weg.');
  end if;

  -- Explicit child cleanup keeps this working even when old schema copies lack ON DELETE CASCADE.
  delete from public.paardenrace_room_players where room_id = v_room_id;

  if to_regclass('public.paardenrace_room_events') is not null and exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'paardenrace_room_events' and column_name = 'room_id'
  ) then
    execute 'delete from public.paardenrace_room_events where room_id = $1' using v_room_id;
  end if;
  if to_regclass('public.paardenrace_wager_verifications') is not null and exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'paardenrace_wager_verifications' and column_name = 'room_id'
  ) then
    execute 'delete from public.paardenrace_wager_verifications where room_id = $1' using v_room_id;
  end if;
  if to_regclass('public.paardenrace_room_drink_requests') is not null and exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'paardenrace_room_drink_requests' and column_name = 'room_id'
  ) then
    execute 'delete from public.paardenrace_room_drink_requests where room_id = $1' using v_room_id;
  end if;

  delete from public.paardenrace_rooms where id = v_room_id;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ok', true, 'destroyed', v_deleted > 0, 'room_code', v_code, 'room_id', v_room_id);
end
$fn$;

create or replace function public.destroy_paardenrace_room_safe(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.disband_paardenrace_room_fast_v687(session_token, session_token_input, room_code_input, site_scope_input)
$fn$;

create or replace function public.close_paardenrace_room_safe(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.disband_paardenrace_room_fast_v687(session_token, session_token_input, room_code_input, site_scope_input)
$fn$;

create or replace function public.disband_paardenrace_room_safe(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.disband_paardenrace_room_fast_v687(session_token, session_token_input, room_code_input, site_scope_input)
$fn$;

create or replace function public.pikken_get_live_state_public(
  game_id_input uuid default null,
  session_token text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if to_regprocedure('public.pikken_get_state_scoped(text,text,uuid,uuid,text,text)') is null then
    raise exception 'pikken_get_state_scoped_missing';
  end if;
  return public.pikken_get_state_scoped(session_token, session_token, game_id_input, game_id_input, null, site_scope_input);
end
$fn$;

grant execute on function public.disband_paardenrace_room_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.destroy_paardenrace_room_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.close_paardenrace_room_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.disband_paardenrace_room_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_get_live_state_public(uuid,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
