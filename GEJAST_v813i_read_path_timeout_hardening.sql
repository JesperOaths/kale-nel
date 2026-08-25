begin;

create or replace function public.get_paardenrace_open_rooms_fast_v687(
  site_scope_input text default 'friends'::text,
  limit_input integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows jsonb := '[]'::jsonb;
  v_scope text := lower(trim(coalesce(site_scope_input, 'friends')));
  v_limit integer := greatest(1, least(coalesce(limit_input,30),50));
begin
  -- Browser reads must stay read-only. Stale-room mutation is intentionally
  -- handled outside this hot path; the same stale states are filtered here.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc nulls last), '[]'::jsonb)
    into v_rows
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
      count(rp.*) as player_count,
      count(*) filter (where coalesce(rp.is_ready, false)) as ready_count,
      coalesce(sum(coalesce(rp.wager_bakken,0)), 0) as total_wager_bakken
    from public.paardenrace_rooms r
    left join public.paardenrace_room_players rp on rp.room_id = r.id
    where lower(trim(coalesce(r.site_scope,'friends'))) = v_scope
      and lower(coalesce(r.stage,'lobby')) in ('lobby','open','waiting','countdown','race','nominations')
      and coalesce(r.updated_at, r.created_at, now()) >= now() - interval '15 minutes'
    group by r.id
    having not (
      lower(coalesce(r.stage,'lobby')) in ('countdown','race','nominations')
      and count(rp.*) < 2
    )
    and not (
      lower(coalesce(r.stage,'lobby')) = 'lobby'
      and coalesce(r.updated_at, r.created_at, now()) < now() - interval '8 minutes'
      and count(rp.*) < 2
    )
    order by coalesce(r.updated_at, r.created_at, now()) desc
    limit v_limit
  ) x;

  return coalesce(v_rows, '[]'::jsonb);
end
$function$;

create or replace function public._gejast_active_profile_rows_v697(
  site_scope_input text default 'friends'::text,
  limit_input integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_scope text := public._gejast_scope_norm_v697(site_scope_input);
  v_limit integer := greatest(1, least(coalesce(limit_input,200),500));
  v_rows jsonb := '[]'::jsonb;
begin
  -- The v813 schema contract for players is now stable. Avoid repeated
  -- information_schema probes and dynamic SQL on every browser request.
  select coalesce(jsonb_agg(to_jsonb(x) order by lower(x.display_name)), '[]'::jsonb)
    into v_rows
  from (
    select distinct on (lower(p.display_name))
      p.display_name::text as display_name,
      p.display_name::text as name,
      p.display_name::text as player_name,
      p.id as player_id,
      coalesce(nullif(p.site_scope,''),'friends')::text as site_scope,
      true as active,
      true as login_active,
      true as has_pin,
      0 as total_matches,
      0 as total_wins,
      1000 as best_rating
    from public.players p
    where coalesce(nullif(p.site_scope,''),'friends') = v_scope
      and coalesce(p.active,true) = true
      and coalesce(p.approved,true) = true
      and nullif(btrim(p.display_name),'') is not null
    order by lower(p.display_name), p.last_login_at desc nulls last, p.display_name asc
    limit v_limit
  ) x;

  return coalesce(v_rows, '[]'::jsonb);
end
$function$;

notify pgrst, 'reload schema';
commit;
