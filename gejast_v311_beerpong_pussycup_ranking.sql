begin;

drop function if exists public.get_beerpong_pussycup_ranking_public();
create or replace function public.get_beerpong_pussycup_ranking_public()
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
with matches_base as (
  select
    m.*,
    coalesce((m.payload->>'team_a_pussycup')::boolean, false) as team_a_pussycup,
    coalesce((m.payload->>'team_b_pussycup')::boolean, false) as team_b_pussycup,
    coalesce(m.payload->'team_a_player_names', m.payload->'team_a_names', '[]'::jsonb) as team_a_names_json,
    coalesce(m.payload->'team_b_player_names', m.payload->'team_b_names', '[]'::jsonb) as team_b_names_json,
    lower(coalesce(m.payload->>'winner_team','')) as winner_team_payload
  from public.beerpong_matches m
  where coalesce(m.match_status, 'finished') = 'finished'
    and coalesce(nullif(to_jsonb(m)->>'deleted_at','')::timestamptz is null, true)
), exploded as (
  select
    lower(trim(n.value)) as player_key,
    trim(n.value) as player_name,
    team_a_pussycup as pussycup,
    winner_team_payload in ('a','team_a') as won
  from matches_base mb,
       lateral jsonb_array_elements_text(mb.team_a_names_json) as n(value)
  union all
  select
    lower(trim(n.value)) as player_key,
    trim(n.value) as player_name,
    team_b_pussycup as pussycup,
    winner_team_payload in ('b','team_b') as won
  from matches_base mb,
       lateral jsonb_array_elements_text(mb.team_b_names_json) as n(value)
), grouped as (
  select
    player_key,
    min(player_name) as player_name,
    count(*)::int as matches,
    count(*) filter (where pussycup)::int as pussycup_hits,
    count(*) filter (where won)::int as wins,
    round(case when count(*)=0 then 0 else 100.0*count(*) filter (where pussycup)/count(*) end, 1) as pussycup_pct
  from exploded
  where player_key <> ''
  group by player_key
), ranking as (
  select * from grouped
  where matches > 0
  order by pussycup_pct desc, pussycup_hits desc, matches desc, lower(player_name) asc
), summary as (
  select
    count(*)::int as players,
    coalesce(sum(matches),0)::int as matches,
    round(coalesce(avg(pussycup_pct),0),1) as avg_pct,
    coalesce(max(pussycup_pct),0)::numeric as best_pct
  from ranking
)
select jsonb_build_object(
  'summary', jsonb_build_object(
    'players', coalesce((select players from summary),0),
    'matches', coalesce((select matches from summary),0),
    'avg_pct', coalesce((select avg_pct from summary),0),
    'best_pct', coalesce((select best_pct from summary),0)
  ),
  'ranking', coalesce((select jsonb_agg(jsonb_build_object(
    'player_name', player_name,
    'matches', matches,
    'pussycup_hits', pussycup_hits,
    'wins', wins,
    'pussycup_pct', pussycup_pct
  )) from ranking), '[]'::jsonb)
);
$fn$;

grant execute on function public.get_beerpong_pussycup_ranking_public() to anon, authenticated;

commit;
