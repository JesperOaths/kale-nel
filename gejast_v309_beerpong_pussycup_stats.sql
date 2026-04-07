begin;

create or replace function public.get_beerpong_player_pussycup_public(player_name text)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
with target as (
  select id, display_name
  from public.players
  where lower(display_name) = lower(trim(player_name))
  limit 1
), finished_matches as (
  select m.*,
         coalesce((m.payload->>'team_a_pussycup')::boolean, false) as team_a_pussycup,
         coalesce((m.payload->>'team_b_pussycup')::boolean, false) as team_b_pussycup,
         case
           when exists (select 1 from target t where t.id = any(coalesce(m.team_a_player_ids, '{}'::bigint[]))) then 'a'
           when exists (select 1 from target t where t.id = any(coalesce(m.team_b_player_ids, '{}'::bigint[]))) then 'b'
           else null
         end as side
  from public.beerpong_matches m
  where coalesce(m.deleted_at is null, true)
    and coalesce(m.match_status, 'finished') = 'finished'
), relevant as (
  select *
  from finished_matches
  where side is not null
), summary as (
  select
    count(*)::int as matches,
    count(*) filter (where (side = 'a' and team_a_pussycup) or (side = 'b' and team_b_pussycup))::int as pussycup_hits,
    count(*) filter (where winner_team = side)::int as wins,
    round(
      case when count(*) = 0 then 0
      else 100.0 * count(*) filter (where (side = 'a' and team_a_pussycup) or (side = 'b' and team_b_pussycup)) / count(*)
      end
    , 1) as pussycup_pct
  from relevant
), recent as (
  select jsonb_agg(
    jsonb_build_object(
      'finished_at', coalesce(finished_at, created_at),
      'side', side,
      'pussycup', case when side = 'a' then team_a_pussycup else team_b_pussycup end,
      'won', winner_team = side,
      'teammates', case when side = 'a' then coalesce(payload->'team_a_player_names', '[]'::jsonb) else coalesce(payload->'team_b_player_names', '[]'::jsonb) end,
      'opponents', case when side = 'a' then coalesce(payload->'team_b_player_names', '[]'::jsonb) else coalesce(payload->'team_a_player_names', '[]'::jsonb) end
    )
    order by coalesce(finished_at, created_at) desc
  ) as items
  from (select * from relevant order by coalesce(finished_at, created_at) desc limit 8) r
)
select jsonb_build_object(
  'player_name', coalesce((select display_name from target), trim(player_name)),
  'summary', jsonb_build_object(
    'matches', coalesce((select matches from summary), 0),
    'wins', coalesce((select wins from summary), 0),
    'pussycup_hits', coalesce((select pussycup_hits from summary), 0),
    'pussycup_pct', coalesce((select pussycup_pct from summary), 0)
  ),
  'recent', coalesce((select items from recent), '[]'::jsonb)
);
$fn$;

grant execute on function public.get_beerpong_player_pussycup_public(text) to anon, authenticated;

commit;
