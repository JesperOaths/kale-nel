-- GEJAST v699: public Paardenrace lobby visibility and robust Pikken live login alias.

begin;

drop function if exists public._gejast_scope_norm_v699(text);

create or replace function public._gejast_scope_norm_v699(site_scope_input text default 'friends')
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
      and p.proname in ('get_paardenrace_open_rooms_fast_v687','get_paardenrace_open_rooms_public','pikken_get_live_state_public')
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

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
  v_scope text := public._gejast_scope_norm_v699(site_scope_input);
begin
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
        where public._gejast_scope_norm_v699(coalesce(r.site_scope,'friends')) = $1
          and lower(coalesce(r.stage,'lobby')) in ('lobby','open','waiting','countdown','race','nominations','finished')
          and coalesce(r.updated_at, r.created_at, now()) >= now() - interval '12 hours'
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
        where lower(coalesce(r.stage,'lobby')) in ('lobby','open','waiting','countdown','race','nominations','finished')
          and coalesce(r.updated_at, r.created_at, now()) >= now() - interval '12 hours'
        order by coalesce(r.updated_at, r.created_at, now()) desc
        limit $1
      ) x
    $sql$ into v_rows using greatest(1, least(coalesce(limit_input,30),50));
  end if;

  return v_rows;
end
$fn$;

create or replace function public.get_paardenrace_open_rooms_public(
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.get_paardenrace_open_rooms_fast_v687(site_scope_input, 30)
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

grant execute on function public.get_paardenrace_open_rooms_fast_v687(text,integer) to anon, authenticated;
grant execute on function public.get_paardenrace_open_rooms_public(text) to anon, authenticated;
grant execute on function public.pikken_get_live_state_public(uuid,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
