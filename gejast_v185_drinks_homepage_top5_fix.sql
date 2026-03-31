-- Gejast v185
-- Fixes homepage drinks Top 5 RPC to avoid referencing non-existent p.name.
-- Uses players.display_name and players.username, plus any drink-event-level player_name fallback.

create or replace function public.get_drinks_homepage_top5_public()
returns jsonb
language sql
security definer
set search_path = public
as $$
with verified_events as (
  select
    de.id,
    de.player_id,
    coalesce(
      nullif(trim(de.player_name), ''),
      nullif(trim(p.display_name), ''),
      nullif(trim(p.username), ''),
      'Onbekend'
    ) as player_name,
    coalesce(
      nullif(trim(p.display_name), ''),
      nullif(trim(p.username), ''),
      nullif(trim(de.player_name), ''),
      'Onbekend'
    ) as display_name,
    coalesce(de.total_units, 0)::numeric as total_units,
    coalesce(de.verified_at, de.created_at) as event_ts
  from public.drink_events de
  left join public.players p on p.id = de.player_id
  where de.status = 'verified'
),
session_window as (
  select public._drink_session_start(now()) as session_start
),
session_top as (
  select
    ve.player_name,
    max(ve.display_name) as display_name,
    round(sum(ve.total_units)::numeric, 1) as total_units
  from verified_events ve
  cross join session_window sw
  where ve.event_ts >= sw.session_start
  group by ve.player_name
  order by sum(ve.total_units) desc, ve.player_name asc
  limit 5
),
all_time_top as (
  select
    ve.player_name,
    max(ve.display_name) as display_name,
    round(sum(ve.total_units)::numeric, 1) as total_units
  from verified_events ve
  group by ve.player_name
  order by sum(ve.total_units) desc, ve.player_name asc
  limit 5
)
select jsonb_build_object(
  'session_top5', coalesce((select jsonb_agg(to_jsonb(session_top) order by total_units desc, player_name asc) from session_top), '[]'::jsonb),
  'all_time_top5', coalesce((select jsonb_agg(to_jsonb(all_time_top) order by total_units desc, player_name asc) from all_time_top), '[]'::jsonb)
);
$$;

grant execute on function public.get_drinks_homepage_top5_public() to anon, authenticated;
