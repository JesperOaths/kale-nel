-- GEJAST v718 repair SQL
-- Purpose:
-- 1. Hide/close Paardenrace rooms that have not changed for 15 minutes.
-- 2. Stop "finished" and day-old rooms from showing as live/open lobbies.
-- 3. Keep the public/open-room RPC shape that the static frontend already expects.

do $drop$
declare
  rec record;
begin
  for rec in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_paardenrace_open_rooms_fast_v687','get_paardenrace_open_rooms_public')
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

drop function if exists public.cleanup_stale_paardenrace_rooms_v718(text);

create or replace function public.cleanup_stale_paardenrace_rooms_v718(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_cutoff timestamptz := now() - interval '15 minutes';
  v_ids bigint[] := array[]::bigint[];
  v_scope_expr text := '''friends''';
  v_state_expr text := '''lobby''';
  v_count integer := 0;
begin
  if to_regclass('public.paardenrace_rooms') is null then
    return jsonb_build_object('ok', false, 'reason', 'paardenrace_rooms_missing', 'closed', 0);
  end if;

  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='site_scope') then
    v_scope_expr := 'coalesce(site_scope,''friends'')';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='stage') and exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='status') then
    v_state_expr := 'lower(coalesce(stage,status,''lobby''))';
  elsif exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='stage') then
    v_state_expr := 'lower(coalesce(stage,''lobby''))';
  elsif exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='status') then
    v_state_expr := 'lower(coalesce(status,''lobby''))';
  end if;

  execute format($sql$
    select coalesce(array_agg(id), array[]::bigint[])
    from public.paardenrace_rooms
    where coalesce(updated_at, created_at, now()) < $1
      and %s in ('lobby','open','waiting','countdown','race','nominations','finished')
      and lower(trim(%s)) = lower(trim($2))
  $sql$, v_state_expr, v_scope_expr)
  into v_ids
  using v_cutoff, coalesce(site_scope_input, 'friends');

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    return jsonb_build_object('ok', true, 'closed', 0, 'cutoff', v_cutoff);
  end if;

  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='stage') then
    execute 'update public.paardenrace_rooms set stage = ''closed'', updated_at = now() where id = any($1)' using v_ids;
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='status') then
    execute 'update public.paardenrace_rooms set status = ''closed'' where id = any($1)' using v_ids;
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='finished_at') then
    execute 'update public.paardenrace_rooms set finished_at = coalesce(finished_at, now()) where id = any($1)' using v_ids;
  end if;

  return jsonb_build_object('ok', true, 'closed', v_count, 'cutoff', v_cutoff);
end
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
  perform public.cleanup_stale_paardenrace_rooms_v718(site_scope_input);

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

create or replace function public.get_paardenrace_open_rooms_public(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.get_paardenrace_open_rooms_fast_v687(site_scope_input, 30)
$fn$;

grant execute on function public.cleanup_stale_paardenrace_rooms_v718(text) to anon, authenticated;
grant execute on function public.get_paardenrace_open_rooms_fast_v687(text, integer) to anon, authenticated;
grant execute on function public.get_paardenrace_open_rooms_public(text) to anon, authenticated;
